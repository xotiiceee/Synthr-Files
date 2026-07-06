use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Memory {
    pub id: String,
    pub agent_id: String,
    pub content: String,
    pub source: String,
    pub importance: f64,
    pub created_at: String,
}

pub struct MemoryService {
    pool: sqlx::PgPool,
}

impl MemoryService {
    pub fn new(pool: sqlx::PgPool) -> Self {
        Self { pool }
    }

    pub async fn ensure_schema(&self) -> anyhow::Result<()> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS persona_memories (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                agent_id TEXT NOT NULL,
                content TEXT NOT NULL,
                source TEXT DEFAULT 'manual',
                importance DOUBLE PRECISION DEFAULT 0.5,
                created_at TIMESTAMPTZ DEFAULT now()
            )
            "#
        ).execute(&self.pool).await?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_persona_memories_agent ON persona_memories(agent_id, importance DESC, created_at DESC)"
        ).execute(&self.pool).await?;

        Ok(())
    }

    pub async fn add_memory(&self, agent_id: &str, content: &str, source: &str, importance: f64) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO persona_memories (agent_id, content, source, importance) VALUES ($1, $2, $3, $4)"
        )
        .bind(agent_id)
        .bind(content)
        .bind(source)
        .bind(importance)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_memories(&self, agent_id: &str, limit: i64) -> Vec<Memory> {
        sqlx::query_as::<_, (uuid::Uuid, String, String, String, f64, chrono::DateTime<chrono::Utc>)>(
            "SELECT id, agent_id, content, source, importance, created_at FROM persona_memories WHERE agent_id = $1 ORDER BY importance DESC, created_at DESC LIMIT $2"
        )
        .bind(agent_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|(id, agent_id, content, source, importance, created_at)| Memory {
            id: id.to_string(),
            agent_id,
            content,
            source,
            importance,
            created_at: created_at.to_rfc3339(),
        })
        .collect()
    }

    pub fn build_context(&self, memories: &[Memory], max_len: usize) -> String {
        if memories.is_empty() {
            return String::new();
        }
        let lines: Vec<String> = memories.iter()
            .map(|m| format!("- {}", m.content))
            .collect();
        let mut result = format!("Relevant context:\n{}", lines.join("\n"));
        if result.len() > max_len {
            result.truncate(max_len);
            result.push_str("...");
        }
        result
    }
}
