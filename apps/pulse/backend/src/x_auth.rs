use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::Mutex;
use rand::Rng;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XUserToken {
    pub user_id: String,
    pub x_user_id: String,
    pub x_handle: String,
    pub access_token: String,
    pub access_token_secret: Option<String>,
    pub refresh_token: Option<String>,
    pub expires_at: Option<String>,
}

pub struct XAuthStore {
    tokens: Mutex<HashMap<String, XUserToken>>,
    states: Mutex<HashMap<String, (String, String)>>, // state -> (user_id, redirect_after)
}

impl XAuthStore {
    pub fn new() -> Self {
        Self {
            tokens: Mutex::new(HashMap::new()),
            states: Mutex::new(HashMap::new()),
        }
    }

    pub async fn store_state(&self, state: &str, user_id: &str, redirect_after: &str) {
        self.states.lock().await.insert(state.to_string(), (user_id.to_string(), redirect_after.to_string()));
    }

    pub async fn take_state(&self, state: &str) -> Option<(String, String)> {
        self.states.lock().await.remove(state)
    }

    pub async fn get_token(&self, user_id: &str) -> Option<XUserToken> {
        self.tokens.lock().await.get(user_id).cloned()
    }

    pub async fn store_token(&self, token: XUserToken) {
        self.tokens.lock().await.insert(token.user_id.clone(), token);
    }

    pub async fn remove_token(&self, user_id: &str) {
        self.tokens.lock().await.remove(user_id);
    }

    pub async fn all_tokens(&self) -> Vec<(String, XUserToken)> {
        self.tokens.lock().await.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    pub async fn restore_token(&self, user_id: &str, token: XUserToken) {
        self.tokens.lock().await.insert(user_id.to_string(), token);
    }
}

// ─── OAuth 1.0a ────────────────────────────────────────────────────────────────

fn url_encode(s: &str) -> String {
    let encoded: String = s.chars().map(|c| match c {
        'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
        _ => format!("%{:02X}", c as u8),
    }).collect();
    encoded
}

fn oauth_nonce() -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..16).map(|_| rng.gen()).collect();
    use base64::{engine::general_purpose::STANDARD, Engine};
    STANDARD.encode(&bytes).trim_end_matches('=').to_string()
}

fn oauth_sign(
    method: &str,
    base_url: &str,
    params: &HashMap<String, String>,
    consumer_secret: &str,
    token_secret: &str,
) -> String {
    let mut sorted: Vec<(&String, &String)> = params.iter().collect();
    sorted.sort_by(|a, b| a.0.cmp(b.0).then(a.1.cmp(b.1)));
    let param_str: String = sorted.iter()
        .map(|(k, v)| format!("{}={}", url_encode(k), url_encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    let base = format!("{}&{}&{}",
        method.to_uppercase(),
        url_encode(base_url),
        url_encode(&param_str),
    );

    let signing_key = format!("{}&{}", url_encode(consumer_secret), url_encode(token_secret));

    use hmac::{Hmac, Mac};
    use sha1::Sha1;
    type HmacSha1 = Hmac<Sha1>;
    let mut mac = HmacSha1::new_from_slice(signing_key.as_bytes()).expect("HMAC can take key of any size");
    mac.update(base.as_bytes());
    let result = mac.finalize();

    use base64::{engine::general_purpose::STANDARD, Engine};
    STANDARD.encode(&result.into_bytes())
}

fn oauth1_auth_header(
    consumer_key: &str,
    access_token: &str,
    access_secret: &str,
    consumer_secret: &str,
    method: &str,
    url: &str,
    extra_params: &HashMap<String, String>,
) -> String {
    let mut params = HashMap::new();
    params.insert("oauth_consumer_key".to_string(), consumer_key.to_string());
    params.insert("oauth_nonce".to_string(), oauth_nonce());
    params.insert("oauth_signature_method".to_string(), "HMAC-SHA1".to_string());
    params.insert("oauth_timestamp".to_string(), chrono::Utc::now().timestamp().to_string());
    params.insert("oauth_token".to_string(), access_token.to_string());
    params.insert("oauth_version".to_string(), "1.0".to_string());
    for (k, v) in extra_params {
        params.insert(k.clone(), v.clone());
    }

    let sig = oauth_sign(method, url, &params, consumer_secret, access_secret);

    let mut header = String::from("OAuth ");
    let oauth_keys = ["oauth_consumer_key", "oauth_nonce", "oauth_signature", "oauth_signature_method", "oauth_timestamp", "oauth_token", "oauth_version"];
    for (i, key) in oauth_keys.iter().enumerate() {
        if i > 0 { header.push_str(", "); }
        let val = if *key == "oauth_signature" { &sig } else { params.get(*key).map(|s| s.as_str()).unwrap_or("") };
        header.push_str(&format!("{}=\"{}\"", key, url_encode(val)));
    }
    for (k, v) in extra_params {
        header.push_str(&format!(", {}=\"{}\"", url_encode(k), url_encode(v)));
    }
    header
}

pub async fn oauth1_post(
    consumer_key: &str,
    consumer_secret: &str,
    access_token: &str,
    access_secret: &str,
    url: &str,
    form: &[(&str, &str)],
) -> anyhow::Result<String> {
    let mut extra = HashMap::new();
    for (k, v) in form {
        extra.insert(k.to_string(), v.to_string());
    }
    let auth = oauth1_auth_header(consumer_key, access_token, access_secret, consumer_secret, "POST", url, &extra);
    let client = Client::new();
    let res = client.post(url).header("Authorization", &auth).form(&form.iter().map(|(k,v)| (*k, *v)).collect::<Vec<_>>()).send().await?;
    Ok(res.text().await?)
}

// ─── OAuth 1.0a flow ───────────────────────────────────────────────────────────

pub async fn oauth1_request_token(
    consumer_key: &str,
    consumer_secret: &str,
    oauth_callback: &str,
) -> anyhow::Result<(String, String)> {
    let mut params = HashMap::new();
    params.insert("oauth_callback".to_string(), oauth_callback.to_string());
    let auth = oauth1_auth_header(consumer_key, "", "", consumer_secret, "POST",
        "https://api.twitter.com/oauth/request_token", &params);
    let client = Client::new();
    let res = client.post("https://api.twitter.com/oauth/request_token")
        .header("Authorization", &auth)
        .form(&[("oauth_callback", oauth_callback)])
        .send().await?;
    let body = res.text().await?;
    let mut parsed = HashMap::new();
    for pair in body.split('&') {
        let mut kv = pair.splitn(2, '=');
        if let (Some(k), Some(v)) = (kv.next(), kv.next()) {
            parsed.insert(k.to_string(), v.to_string());
        }
    }
    let token = parsed.get("oauth_token").cloned().ok_or_else(|| anyhow::anyhow!("oauth_token missing: {body}"))?;
    let secret = parsed.get("oauth_token_secret").cloned().ok_or_else(|| anyhow::anyhow!("oauth_token_secret missing: {body}"))?;
    Ok((token, secret))
}

pub fn oauth1_auth_url(request_token: &str) -> String {
    format!("https://api.twitter.com/oauth/authorize?oauth_token={}", request_token)
}

pub async fn oauth1_access_token(
    consumer_key: &str,
    consumer_secret: &str,
    request_token: &str,
    request_secret: &str,
    oauth_verifier: &str,
) -> anyhow::Result<(String, String, String, String)> {
    let mut params = HashMap::new();
    params.insert("oauth_verifier".to_string(), oauth_verifier.to_string());
    let auth = oauth1_auth_header(consumer_key, request_token, request_secret, consumer_secret, "POST",
        "https://api.twitter.com/oauth/access_token", &params);
    let client = Client::new();
    let res = client.post("https://api.twitter.com/oauth/access_token")
        .header("Authorization", &auth)
        .form(&[("oauth_verifier", oauth_verifier)])
        .send().await?;
    let body = res.text().await?;
    let mut parsed = HashMap::new();
    for pair in body.split('&') {
        let mut kv = pair.splitn(2, '=');
        if let (Some(k), Some(v)) = (kv.next(), kv.next()) {
            parsed.insert(k.to_string(), v.to_string());
        }
    }
    let access_token = parsed.get("oauth_token").cloned().ok_or_else(|| anyhow::anyhow!("oauth_token missing: {body}"))?;
    let access_secret = parsed.get("oauth_token_secret").cloned().ok_or_else(|| anyhow::anyhow!("token_secret missing: {body}"))?;
    let x_user_id = parsed.get("user_id").cloned().unwrap_or_default();
    let x_handle = parsed.get("screen_name").cloned().unwrap_or_default();
    Ok((access_token, access_secret, x_user_id, format!("@{x_handle}")))
}

// ─── OAuth 1.0a API calls ──────────────────────────────────────────────────────

pub async fn x_media_upload_oauth1(
    consumer_key: &str,
    consumer_secret: &str,
    access_token: &str,
    access_secret: &str,
    image_bytes: Vec<u8>,
    mime_type: &str,
) -> anyhow::Result<String> {
    let url = "https://upload.twitter.com/1.1/media/upload.json";
    let auth = oauth1_auth_header(consumer_key, access_token, access_secret, consumer_secret, "POST", url, &HashMap::new());

    let part = reqwest::multipart::Part::bytes(image_bytes).file_name("image.png").mime_str(mime_type)?;
    let form = reqwest::multipart::Form::new().part("media", part);

    let client = Client::new();
    let res = client.post(url)
        .header("Authorization", &auth)
        .multipart(form)
        .send().await?;
    let status = res.status();
    let body = res.text().await?;
    if !status.is_success() {
        return Err(anyhow::anyhow!("X media upload: HTTP {status} — {body}"));
    }
    let parsed: serde_json::Value = serde_json::from_str(&body)?;
    parsed["media_id_string"].as_str().map(|s| s.to_string())
        .ok_or_else(|| anyhow::anyhow!("No media_id_string in: {body}"))
}

pub async fn x_tweet_oauth1(
    consumer_key: &str,
    consumer_secret: &str,
    access_token: &str,
    access_secret: &str,
    text: &str,
    media_id: Option<&str>,
) -> anyhow::Result<String> {
    let url = "https://api.twitter.com/2/tweets";
    let tb = if let Some(mid) = media_id {
        serde_json::json!({"text": text, "media": {"media_ids": [mid]}})
    } else {
        serde_json::json!({"text": text})
    };

    let client = Client::new();
    let auth_header = format!("Bearer {}", access_token);
    let res = client.post(url)
        .header("Authorization", &auth_header)
        .json(&tb)
        .send().await?;
    let status = res.status();
    let body = res.text().await?;
    if !status.is_success() {
        return Err(anyhow::anyhow!("X tweet: HTTP {status} — {body}"));
    }
    let parsed: serde_json::Value = serde_json::from_str(&body)?;
    parsed["data"]["id"].as_str().map(|s| s.to_string())
        .ok_or_else(|| anyhow::anyhow!("No tweet id in: {body}"))
}

// ─── Legacy OAuth 2.0 (kept for reference) ─────────────────────────────────────

pub async fn generate_pkce() -> (String, String) {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..64).map(|_| rng.gen()).collect();
    let code_verifier = base64_url_encode(&bytes);

    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(code_verifier.as_bytes());
    let hash = hasher.finalize();
    let code_challenge = base64_url_encode(&hash);

    (code_verifier, code_challenge)
}

fn base64_url_encode(input: &[u8]) -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    URL_SAFE_NO_PAD.encode(input)
}

pub async fn exchange_code_for_token(
    client_id: &str,
    client_secret: &str,
    redirect_uri: &str,
    code: &str,
    code_verifier: &str,
) -> anyhow::Result<(String, Option<String>, String, String)> {
    let client = Client::new();
    let res = client
        .post("https://api.twitter.com/2/oauth2/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .basic_auth(client_id, Some(client_secret))
        .form(&[
            ("code", code),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri),
            ("code_verifier", code_verifier),
        ])
        .send()
        .await?;

    let body: serde_json::Value = res.json().await?;
    let access_token = body["access_token"].as_str()
        .ok_or_else(|| anyhow::anyhow!("Missing access_token"))?
        .to_string();
    let refresh_token = body["refresh_token"].as_str().map(|s| s.to_string());

    let me = client
        .get("https://api.twitter.com/2/users/me")
        .header("Authorization", format!("Bearer {access_token}"))
        .send()
        .await?;
    let me_body: serde_json::Value = me.json().await?;
    let x_user_id = me_body["data"]["id"].as_str().unwrap_or("unknown").to_string();
    let x_handle = me_body["data"]["username"].as_str().unwrap_or("unknown").to_string();

    Ok((access_token, refresh_token, x_user_id, format!("@{x_handle}")))
}

pub async fn post_tweet(access_token: &str, text: &str) -> anyhow::Result<serde_json::Value> {
    let client = Client::new();
    let res = client
        .post("https://api.twitter.com/2/tweets")
        .header("Authorization", format!("Bearer {access_token}"))
        .json(&serde_json::json!({"text": text}))
        .send()
        .await?;

    if !res.status().is_success() {
        let body: serde_json::Value = res.json().await.unwrap_or_default();
        let msg = body["detail"].as_str().unwrap_or("Unknown error");
        return Err(anyhow::anyhow!("X API error: {msg}"));
    }

    let body: serde_json::Value = res.json().await?;
    Ok(body)
}

pub async fn fetch_x_handle(access_token: &str) -> anyhow::Result<String> {
    let client = Client::new();
    let res = client
        .get("https://api.twitter.com/2/users/me")
        .header("Authorization", format!("Bearer {access_token}"))
        .send()
        .await?;
    let body: serde_json::Value = res.json().await?;
    Ok(body["data"]["username"].as_str().unwrap_or("unknown").to_string())
}
