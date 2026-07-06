use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::Mutex;
use std::sync::Arc;
use rand::Rng;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XUserToken {
    pub user_id: String,
    pub x_user_id: String,
    pub x_handle: String,
    pub access_token: String,
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
        urlencoding(redirect_uri),
        state,
        code_challenge
    )
}

fn urlencoding(s: &str) -> String {
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
    let expires_at = body.get("expires_in").and_then(|v| v.as_i64()).map(|secs| {
        chrono::Utc::now() + chrono::Duration::seconds(secs)
    }).map(|d| d.to_rfc3339());

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
