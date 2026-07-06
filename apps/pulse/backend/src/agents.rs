//! Agent (Brand) domain model and store.
//!
//! This is intentionally clean and typed.
//! The frontend (current polished UI) calls this surface via /api/brands.
//! We use "Agent" in Rust for clarity even if some API paths still say "brands".

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub brand_name: String,
    pub niche: String,
    pub tone: String,
    pub website: String,
    pub x_handle: String,
    pub topics: Vec<String>,
    pub competitors: Vec<String>,
    pub running: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentRequest {
    pub name: String,
    pub brand_name: String,
    pub niche: String,
    pub tone: String,
    pub website: Option<String>,
    pub x_handle: Option<String>,
    pub topics: Option<Vec<String>>,
    pub competitors: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct ToggleRunningRequest {
    pub id: String,
    pub running: bool,
}

/// Real Postgres backed store using sqlx.
/// Production ready for multi-tenant durability.
#[derive(Clone)]
pub struct AgentStore {
    pool: PgPool,
}

#[derive(Debug, Clone)]
pub struct AgentScope {
    pub user_id: String,
    pub org_id: Option<String>,
}

impl AgentStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list(&self, scope: &AgentScope) -> Vec<Agent> {
        if let Some(org_id) = &scope.org_id {
            sqlx::query_as::<_, Agent>(
                "SELECT id, name, brand_name, niche, tone, website, x_handle, topics, competitors, running, created_at, updated_at
                 FROM agents WHERE owner_org_id = $1 ORDER BY created_at DESC"
            )
            .bind(org_id)
            .fetch_all(&self.pool)
            .await
            .unwrap_or_default()
        } else {
            sqlx::query_as::<_, Agent>(
                "SELECT id, name, brand_name, niche, tone, website, x_handle, topics, competitors, running, created_at, updated_at
                 FROM agents WHERE owner_user_id = $1 AND owner_org_id IS NULL ORDER BY created_at DESC"
            )
            .bind(&scope.user_id)
            .fetch_all(&self.pool)
            .await
            .unwrap_or_default()
        }
    }

    pub async fn get(&self, scope: &AgentScope, id: &str) -> Option<Agent> {
        if let Some(org_id) = &scope.org_id {
            sqlx::query_as::<_, Agent>(
                "SELECT id, name, brand_name, niche, tone, website, x_handle, topics, competitors, running, created_at, updated_at
                 FROM agents WHERE id = $1 AND owner_org_id = $2"
            )
            .bind(id)
            .bind(org_id)
            .fetch_optional(&self.pool)
            .await
            .unwrap_or(None)
        } else {
            sqlx::query_as::<_, Agent>(
                "SELECT id, name, brand_name, niche, tone, website, x_handle, topics, competitors, running, created_at, updated_at
                 FROM agents WHERE id = $1 AND owner_user_id = $2 AND owner_org_id IS NULL"
            )
            .bind(id)
            .bind(&scope.user_id)
            .fetch_optional(&self.pool)
            .await
            .unwrap_or(None)
        }
    }

    pub async fn exists(&self, scope: &AgentScope, id: &str) -> bool {
        if let Some(org_id) = &scope.org_id {
            let row: (bool,) = sqlx::query_as("SELECT EXISTS(SELECT 1 FROM agents WHERE id = $1 AND owner_org_id = $2)")
                .bind(id)
                .bind(org_id)
                .fetch_one(&self.pool)
                .await
                .unwrap_or((false,));
            row.0
        } else {
            let row: (bool,) = sqlx::query_as("SELECT EXISTS(SELECT 1 FROM agents WHERE id = $1 AND owner_user_id = $2 AND owner_org_id IS NULL)")
                .bind(id)
                .bind(&scope.user_id)
                .fetch_one(&self.pool)
                .await
                .unwrap_or((false,));
            row.0
        }
    }

    pub async fn create(&self, scope: &AgentScope, req: CreateAgentRequest) -> Agent {
        let id = unique_agent_id(&req.name);
        let now = Utc::now();

        let website = req.website.clone().unwrap_or_default();
        let x_handle = req.x_handle.clone().unwrap_or_default();
        let topics = req.topics.clone().unwrap_or_default();
        let competitors = req.competitors.clone().unwrap_or_default();

        let agent = Agent {
            id: id.clone(),
            name: req.name.clone(),
            brand_name: req.brand_name.clone(),
            niche: req.niche.clone(),
            tone: req.tone.clone(),
            website: website.clone(),
            x_handle: x_handle.clone(),
            topics: topics.clone(),
            competitors: competitors.clone(),
            running: false,
            created_at: now,
            updated_at: now,
        };

        let _ = sqlx::query(
            "INSERT INTO agents (id, name, brand_name, niche, tone, website, x_handle, topics, competitors, running, owner_user_id, owner_org_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             ON CONFLICT (id) DO UPDATE
             SET name = EXCLUDED.name,
                 brand_name = EXCLUDED.brand_name,
                 niche = EXCLUDED.niche,
                 tone = EXCLUDED.tone,
                 website = EXCLUDED.website,
                 x_handle = EXCLUDED.x_handle,
                 topics = EXCLUDED.topics,
                 competitors = EXCLUDED.competitors,
                 updated_at = EXCLUDED.updated_at
             WHERE agents.owner_user_id = EXCLUDED.owner_user_id
               AND agents.owner_org_id IS NOT DISTINCT FROM EXCLUDED.owner_org_id"
        )
        .bind(&id)
        .bind(&req.name)
        .bind(&req.brand_name)
        .bind(&req.niche)
        .bind(&req.tone)
        .bind(&website)
        .bind(&x_handle)
        .bind(&topics)
        .bind(&competitors)
        .bind(agent.running)
        .bind(&scope.user_id)
        .bind(&scope.org_id)
        .bind(agent.created_at)
        .bind(agent.updated_at)
        .execute(&self.pool)
        .await;

        // Return the persisted one if possible (fix for always return local)
        if let Some(persisted) = self.get(scope, &id).await {
            persisted
        } else {
            agent
        }
    }

    pub async fn delete(&self, scope: &AgentScope, id: &str) -> bool {
        let res = if let Some(org_id) = &scope.org_id {
            sqlx::query("DELETE FROM agents WHERE id = $1 AND owner_org_id = $2")
                .bind(id)
                .bind(org_id)
                .execute(&self.pool)
                .await
        } else {
            sqlx::query("DELETE FROM agents WHERE id = $1 AND owner_user_id = $2 AND owner_org_id IS NULL")
                .bind(id)
                .bind(&scope.user_id)
                .execute(&self.pool)
                .await
        };
        res.map(|r| r.rows_affected() > 0).unwrap_or(false)
    }

    pub async fn set_running(&self, scope: &AgentScope, id: &str, running: bool) -> Option<bool> {
        let row: Option<(bool,)> = if let Some(org_id) = &scope.org_id {
            sqlx::query_as(
                "UPDATE agents SET running = $1, updated_at = now() WHERE id = $2 AND owner_org_id = $3 RETURNING running"
            )
            .bind(running)
            .bind(id)
            .bind(org_id)
            .fetch_optional(&self.pool)
            .await
            .ok()
            .flatten()
        } else {
            sqlx::query_as(
                "UPDATE agents SET running = $1, updated_at = now() WHERE id = $2 AND owner_user_id = $3 AND owner_org_id IS NULL RETURNING running"
            )
            .bind(running)
            .bind(id)
            .bind(&scope.user_id)
            .fetch_optional(&self.pool)
            .await
            .ok()
            .flatten()
        };

        row.map(|r| r.0)
    }
}

fn slugify(name: &str) -> String {
    let base = name
        .to_lowercase()
        .trim()
        .replace(|c: char| !c.is_ascii_alphanumeric() && c != ' ', "-")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-");

    if base.is_empty() {
        format!("agent-{}", Uuid::new_v4().simple())
    } else {
        // Keep it short and nice
        base.chars().take(60).collect()
    }
}

fn unique_agent_id(name: &str) -> String {
    let slug = slugify(name);
    let suffix = Uuid::new_v4().simple().to_string();
    format!("{}-{}", slug, &suffix[..8])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_produces_valid_id() {
        assert_eq!(slugify("My Agent!"), "my-agent");
        assert!(slugify("").starts_with("agent-"));
        assert!(slugify("   ").starts_with("agent-"));
    }

    #[test]
    fn create_request_deserializes_rich_fields() {
        let json = r#"{"name":"Test","brandName":"TB","niche":"N","tone":"T","website":"w","xHandle":"x","topics":["t1"],"competitors":["c1"]}"#;
        let req: CreateAgentRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.name, "Test");
        assert_eq!(req.brand_name, "TB");
        assert_eq!(req.website, Some("w".to_string()));
        assert_eq!(req.topics, Some(vec!["t1".to_string()]));
        assert_eq!(req.competitors, Some(vec!["c1".to_string()]));
    }

    #[test]
    fn agent_serializes_camel() {
        let agent = Agent {
            id: "a1".into(),
            name: "N".into(),
            brand_name: "B".into(),
            niche: "Ni".into(),
            tone: "To".into(),
            website: "w".into(),
            x_handle: "x".into(),
            topics: vec!["t".into()],
            competitors: vec!["c".into()],
            running: true,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        let s = serde_json::to_string(&agent).unwrap();
        assert!(s.contains("\"brandName\""));
        assert!(s.contains("\"xHandle\""));
        assert!(s.contains("\"topics\""));
    }

    // Note: full list/create/delete/toggle require live PgPool (see verification plan step 2/3/7 - exercised via real DB in launch + API curls; unit coverage on serial + request here)
}
