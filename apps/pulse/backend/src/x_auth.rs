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
    pub access_token_secret: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<String>,
}

pub struct XAuthStore {
    tokens: Mutex<HashMap<String, XUserToken>>,
    states: Mutex<HashMap<String, (String, String)>>, // oauth_token -> (user_id, token_secret)
}

impl XAuthStore {
    pub fn new() -> Self {
        Self {
            tokens: Mutex::new(HashMap::new()),
            states: Mutex::new(HashMap::new()),
        }
    }

    pub async fn store_oauth_state(&self, oauth_token: &str, user_id: &str, token_secret: &str) {
        self.states.lock().await.insert(oauth_token.to_string(), (user_id.to_string(), token_secret.to_string()));
    }

    pub async fn take_oauth_state(&self, oauth_token: &str) -> Option<(String, String)> {
        self.states.lock().await.remove(oauth_token)
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

// ─── OAuth 1.0a ───────────────────────────────────────────────────────────────

fn pct_encode(s: &str) -> String {
    s.bytes().map(|b| match b {
        b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => format!("{}", b as char),
        _ => format!("%{:02X}", b),
    }).collect()
}

fn oauth_nonce() -> String {
    use rand::distributions::Alphanumeric;
    rand::thread_rng().sample_iter(&Alphanumeric).take(32).map(char::from).collect()
}

fn oauth1_sign(
    method: &str,
    base_url: &str,
    params: &[(&str, &str)],
    consumer_secret: &str,
    token_secret: &str,
) -> String {
    let mut all: Vec<(&str, &str)> = params.to_vec();
    all.sort_by(|a, b| {
        let k = a.0.cmp(b.0);
        if k == std::cmp::Ordering::Equal { a.1.cmp(b.1) } else { k }
    });

    let param_str = all.iter()
        .map(|(k, v)| format!("{}={}", pct_encode(k), pct_encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    let base = format!("{}&{}&{}",
        method.to_uppercase(),
        pct_encode(base_url),
        pct_encode(&param_str),
    );

    let key = format!("{}&{}", pct_encode(consumer_secret), pct_encode(token_secret));

    use hmac::{Hmac, Mac};
    use sha1::Sha1;
    type HmacSha1 = Hmac<Sha1>;
    let mut mac = HmacSha1::new_from_slice(key.as_bytes()).unwrap();
    mac.update(base.as_bytes());

    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    B64.encode(&mac.finalize().into_bytes())
}

fn oauth1_auth_header(
    consumer_key: &str,
    token: &str,
    consumer_secret: &str,
    token_secret: &str,
    method: &str,
    base_url: &str,
    body_params: &[(&str, &str)],
) -> String {
    let nonce = oauth_nonce();
    let ts = chrono::Utc::now().timestamp().to_string();

    let mut params: Vec<(&str, &str)> = vec![
        ("oauth_consumer_key", consumer_key),
        ("oauth_nonce", &nonce),
        ("oauth_signature_method", "HMAC-SHA1"),
        ("oauth_timestamp", &ts),
        ("oauth_version", "1.0"),
    ];
    if !token.is_empty() {
        params.push(("oauth_token", token));
    }
    for (k, v) in body_params { params.push((k, v)); }

    let sig = oauth1_sign(method, base_url, &params, consumer_secret, token_secret);

    let mut parts: Vec<String> = Vec::new();
    parts.push(format!("oauth_consumer_key=\"{}\"", pct_encode(consumer_key)));
    parts.push(format!("oauth_nonce=\"{}\"", pct_encode(&nonce)));
    parts.push(format!("oauth_signature=\"{}\"", pct_encode(&sig)));
    parts.push("oauth_signature_method=\"HMAC-SHA1\"".to_string());
    parts.push(format!("oauth_timestamp=\"{}\"", ts));
    if !token.is_empty() {
        parts.push(format!("oauth_token=\"{}\"", pct_encode(token)));
    }
    parts.push("oauth_version=\"1.0\"".to_string());

    format!("OAuth {}", parts.join(", "))
}

// ─── OAuth 1.0a three-legged flow ─────────────────────────────────────────────

pub async fn oauth1_request_token(
    consumer_key: &str,
    consumer_secret: &str,
    callback: &str,
) -> anyhow::Result<(String, String)> {
    let url = "https://api.twitter.com/oauth/request_token";
    let body = [("oauth_callback", callback)];
    let auth = oauth1_auth_header(consumer_key, "", consumer_secret, "", "POST", url, &body);

    let client = Client::new();
    let res = client.post(url)
        .header("Authorization", &auth)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(format!("oauth_callback={}", pct_encode(callback)))
        .send().await?;

    let status = res.status();
    let text = res.text().await?;
    if !status.is_success() {
        return Err(anyhow::anyhow!("OAuth request token failed: HTTP {status} — {text}"));
    }

    let mut m = HashMap::new();
    for pair in text.split('&') {
        let mut kv = pair.splitn(2, '=');
        if let (Some(k), Some(v)) = (kv.next(), kv.next()) {
            m.insert(k.to_string(), v.to_string());
        }
    }
    let token = m.remove("oauth_token").ok_or_else(|| anyhow::anyhow!("missing oauth_token: {text}"))?;
    let secret = m.remove("oauth_token_secret").ok_or_else(|| anyhow::anyhow!("missing oauth_token_secret: {text}"))?;
    Ok((token, secret))
}

pub fn oauth1_authorize_url(request_token: &str) -> String {
    format!("https://api.twitter.com/oauth/authorize?oauth_token={}", request_token)
}

pub async fn oauth1_access_token(
    consumer_key: &str,
    consumer_secret: &str,
    request_token: &str,
    request_secret: &str,
    verifier: &str,
) -> anyhow::Result<(String, String, String, String)> {
    let url = "https://api.twitter.com/oauth/access_token";
    let body = [("oauth_verifier", verifier)];
    let auth = oauth1_auth_header(consumer_key, request_token, consumer_secret, request_secret, "POST", url, &body);

    let client = Client::new();
    let res = client.post(url)
        .header("Authorization", &auth)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(format!("oauth_verifier={}", verifier))
        .send().await?;

    let status = res.status();
    let text = res.text().await?;
    if !status.is_success() {
        return Err(anyhow::anyhow!("OAuth access token failed: HTTP {status} — {text}"));
    }

    let mut m = HashMap::new();
    for pair in text.split('&') {
        let mut kv = pair.splitn(2, '=');
        if let (Some(k), Some(v)) = (kv.next(), kv.next()) {
            m.insert(k.to_string(), v.to_string());
        }
    }
    let access_token = m.remove("oauth_token").ok_or_else(|| anyhow::anyhow!("missing oauth_token: {text}"))?;
    let access_secret = m.remove("oauth_token_secret").ok_or_else(|| anyhow::anyhow!("missing oauth_token_secret: {text}"))?;
    let user_id = m.remove("user_id").unwrap_or_default();
    let screen_name = m.remove("screen_name").unwrap_or_default();
    Ok((access_token, access_secret, user_id, format!("@{screen_name}")))
}

// ─── OAuth 1.0a API calls ─────────────────────────────────────────────────────

pub async fn x_media_upload(
    consumer_key: &str,
    consumer_secret: &str,
    access_token: &str,
    access_secret: &str,
    image_bytes: Vec<u8>,
    mime_type: &str,
) -> anyhow::Result<String> {
    let url = "https://upload.twitter.com/1.1/media/upload.json";
    let auth = oauth1_auth_header(consumer_key, access_token, consumer_secret, access_secret, "POST", url, &[]);

    let part = reqwest::multipart::Part::bytes(image_bytes).file_name("image.png").mime_str(mime_type)?;
    let form = reqwest::multipart::Form::new().part("media", part);

    let client = Client::new();
    let res = client.post(url).header("Authorization", &auth).multipart(form).send().await?;
    let status = res.status();
    let body = res.text().await?;
    if !status.is_success() {
        return Err(anyhow::anyhow!("X media upload: HTTP {status} — {body}"));
    }
    let parsed: serde_json::Value = serde_json::from_str(&body)?;
    parsed["media_id_string"].as_str().map(|s| s.to_string())
        .ok_or_else(|| anyhow::anyhow!("No media_id_string in: {body}"))
}

pub async fn x_tweet_with_media(
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
    let res = client.post(url)
        .header("Authorization", format!("Bearer {}", access_token))
        .json(&tb).send().await?;
    let status = res.status();
    let body = res.text().await?;
    if !status.is_success() {
        return Err(anyhow::anyhow!("X tweet: HTTP {status} — {body}"));
    }
    let parsed: serde_json::Value = serde_json::from_str(&body)?;
    parsed["data"]["id"].as_str().map(|s| s.to_string())
        .ok_or_else(|| anyhow::anyhow!("No tweet id in: {body}"))
}
