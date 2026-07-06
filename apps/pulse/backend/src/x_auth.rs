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
    states: Mutex<HashMap<String, (String, String, String)>>, // state -> (user_id, code_verifier, redirect_after)
}

impl XAuthStore {
    pub fn new() -> Self {
        Self {
            tokens: Mutex::new(HashMap::new()),
            states: Mutex::new(HashMap::new()),
        }
    }

    pub async fn store_state(&self, state: &str, user_id: &str, code_verifier: &str, redirect_after: &str) {
        self.states.lock().await.insert(state.to_string(), (user_id.to_string(), code_verifier.to_string(), redirect_after.to_string()));
    }

    pub async fn take_state(&self, state: &str) -> Option<(String, String, String)> {
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

// ─── OAuth 1.0a (media upload only) ────────────────────────────────────────────

fn oauth_percent_encode(s: &str) -> String {
    s.chars().map(|c| match c {
        'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
        _ => format!("%{:02X}", c as u8),
    }).collect()
}

fn oauth1_sign(
    consumer_secret: &str,
    token_secret: &str,
    method: &str,
    url: &str,
    params: &[(&str, &str)],
) -> String {
    let mut sorted: Vec<_> = params.iter().collect();
    sorted.sort_by(|a, b| a.0.cmp(b.0).then(a.1.cmp(b.1)));

    let param_str = sorted.iter()
        .map(|(k, v)| format!("{}={}", oauth_percent_encode(k), oauth_percent_encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    let sig_base = format!("{}&{}&{}",
        method.to_uppercase(),
        oauth_percent_encode(url),
        oauth_percent_encode(&param_str),
    );

    let key = format!("{}&{}", oauth_percent_encode(consumer_secret), oauth_percent_encode(token_secret));

    use hmac::{Hmac, Mac};
    use sha1::Sha1;
    type HmacSha1 = Hmac<Sha1>;
    let mut mac = HmacSha1::new_from_slice(key.as_bytes()).unwrap();
    mac.update(sig_base.as_bytes());

    use base64::{engine::general_purpose::STANDARD, Engine};
    STANDARD.encode(&mac.finalize().into_bytes())
}

pub async fn x_media_upload(
    consumer_key: &str,
    consumer_secret: &str,
    access_token: &str,
    access_secret: &str,
    image_bytes: Vec<u8>,
    mime_type: &str,
) -> anyhow::Result<String> {
    let url = "https://upload.twitter.com/1.1/media/upload.json";
    let nonce: String = (0..32).map(|_| rand::thread_rng().sample(rand::distributions::Alphanumeric) as char).collect();
    let ts = chrono::Utc::now().timestamp().to_string();

    let params: Vec<(&str, &str)> = vec![
        ("oauth_consumer_key", consumer_key),
        ("oauth_nonce", &nonce),
        ("oauth_signature_method", "HMAC-SHA1"),
        ("oauth_timestamp", &ts),
        ("oauth_token", access_token),
        ("oauth_version", "1.0"),
    ];

    let sig = oauth1_sign(consumer_secret, access_secret, "POST", url, &params);

    let auth_header = format!(
        "OAuth oauth_consumer_key=\"{}\", oauth_nonce=\"{}\", oauth_signature=\"{}\", oauth_signature_method=\"HMAC-SHA1\", oauth_timestamp=\"{}\", oauth_token=\"{}\", oauth_version=\"1.0\"",
        oauth_percent_encode(consumer_key),
        oauth_percent_encode(&nonce),
        oauth_percent_encode(&sig),
        ts,
        oauth_percent_encode(access_token),
    );

    let part = reqwest::multipart::Part::bytes(image_bytes).file_name("image.png").mime_str(mime_type)?;
    let form = reqwest::multipart::Form::new().part("media", part);

    let client = Client::new();
    let res = client.post(url).header("Authorization", &auth_header).multipart(form).send().await?;
    let status = res.status();
    let body = res.text().await?;
    if !status.is_success() {
        return Err(anyhow::anyhow!("X media upload: HTTP {status} — {body}"));
    }
    let parsed: serde_json::Value = serde_json::from_str(&body)?;
    parsed["media_id_string"].as_str().map(|s| s.to_string())
        .ok_or_else(|| anyhow::anyhow!("No media_id_string in: {body}"))
}

// ─── OAuth 2.0 (login + tweet posting) ───────────────────────────────────────

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

pub fn x_auth_url(client_id: &str, redirect_uri: &str, state: &str, code_challenge: &str) -> String {
    format!(
        "https://twitter.com/i/oauth2/authorize?response_type=code&client_id={}&redirect_uri={}&scope=tweet.read%20tweet.write%20users.read%20media.write%20offline.access&state={}&code_challenge={}&code_challenge_method=S256",
        client_id,
        url_encode_rfc3986(redirect_uri),
        state,
        code_challenge
    )
}

fn url_encode_rfc3986(s: &str) -> String {
    s.chars().map(|c| match c {
        ':' => "%3A".to_string(),
        '/' => "%2F".to_string(),
        '?' => "%3F".to_string(),
        '&' => "%26".to_string(),
        '=' => "%3D".to_string(),
        '#' => "%23".to_string(),
        ' ' => "%20".to_string(),
        c if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' || c == '~' => c.to_string(),
        _ => format!("%{:02X}", c as u8),
    }).collect()
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
