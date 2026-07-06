//! Durable goal execution foundation.
//!
//! This module gives Pulse the API shape the Temporal worker will own in Phase 2:
//! start a natural-language goal, persist the plan/progress, and expose status.
//! The current runner is a demo-mode executor that checkpoints every transition
//! to Postgres so the frontend and product flow can move before the full worker.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::agents::AgentScope;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct GoalExecution {
    pub id: Uuid,
    pub brand_id: String,
    pub goal: String,
    pub status: String,
    pub current_step: Option<String>,
    pub plan: serde_json::Value,
    pub steps: serde_json::Value,
    pub cost_meta: serde_json::Value,
    pub result: serde_json::Value,
    pub approval_required: bool,
    pub temporal_workflow_id: Option<String>,
    #[serde(skip_serializing)]
    pub owner_user_id: String,
    #[serde(skip_serializing)]
    pub owner_org_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartGoalRequest {
    pub brand_id: Option<String>,
    pub goal: String,
    pub approval_required: Option<bool>,
}

#[derive(Clone)]
pub struct GoalStore {
    pool: PgPool,
}

impl GoalStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn ensure_schema(&self) -> anyhow::Result<()> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS goal_executions (
                id UUID PRIMARY KEY,
                brand_id TEXT NOT NULL,
                goal TEXT NOT NULL,
                status TEXT NOT NULL,
                current_step TEXT,
                plan JSONB NOT NULL DEFAULT '{}'::jsonb,
                steps JSONB NOT NULL DEFAULT '[]'::jsonb,
                cost_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
                result JSONB NOT NULL DEFAULT '{}'::jsonb,
                approval_required BOOLEAN NOT NULL DEFAULT true,
                temporal_workflow_id TEXT,
                owner_user_id TEXT NOT NULL DEFAULT 'demo-user',
                owner_org_id TEXT,
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now()
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_goal_executions_owner_updated ON goal_executions(owner_org_id, owner_user_id, updated_at DESC)",
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn create(
        &self,
        scope: &AgentScope,
        brand_id: String,
        goal: String,
        approval_required: bool,
    ) -> anyhow::Result<GoalExecution> {
        let id = Uuid::new_v4();
        let workflow_id = format!("goal-{id}");
        let steps = default_steps();
        let plan = json!({
            "goal": goal,
            "brandId": brand_id,
            "workflow": "GoalDecomposeAndExecute",
            "runtime": "temporal-ready-demo",
            "note": "This persisted contract is ready for the Phase 2 Temporal worker.",
        });

        sqlx::query_as::<_, GoalExecution>(
            r#"
            INSERT INTO goal_executions (
                id, brand_id, goal, status, current_step, plan, steps, cost_meta,
                result, approval_required, temporal_workflow_id, owner_user_id, owner_org_id
            )
            VALUES ($1, $2, $3, 'queued', NULL, $4, $5, '{}'::jsonb, '{}'::jsonb, $6, $7, $8, $9)
            RETURNING id, brand_id, goal, status, current_step, plan, steps, cost_meta,
                result, approval_required, temporal_workflow_id, owner_user_id, owner_org_id, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(&brand_id)
        .bind(&goal)
        .bind(plan)
        .bind(steps)
        .bind(approval_required)
        .bind(workflow_id)
        .bind(&scope.user_id)
        .bind(&scope.org_id)
        .fetch_one(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn get(&self, scope: &AgentScope, id: Uuid) -> Option<GoalExecution> {
        sqlx::query_as::<_, GoalExecution>(
            r#"
            SELECT id, brand_id, goal, status, current_step, plan, steps, cost_meta,
                result, approval_required, temporal_workflow_id, owner_user_id, owner_org_id, created_at, updated_at
            FROM goal_executions
            WHERE id = $1
              AND owner_user_id = $2
              AND owner_org_id IS NOT DISTINCT FROM $3
            "#,
        )
        .bind(id)
        .bind(&scope.user_id)
        .bind(&scope.org_id)
        .fetch_optional(&self.pool)
        .await
        .unwrap_or(None)
    }

    pub async fn get_any(&self, id: Uuid) -> Option<GoalExecution> {
        sqlx::query_as::<_, GoalExecution>(
            r#"
            SELECT id, brand_id, goal, status, current_step, plan, steps, cost_meta,
                result, approval_required, temporal_workflow_id, owner_user_id, owner_org_id, created_at, updated_at
            FROM goal_executions
            WHERE id = $1
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .unwrap_or(None)
    }

    pub async fn list_recent(&self, scope: &AgentScope, limit: i64) -> Vec<GoalExecution> {
        sqlx::query_as::<_, GoalExecution>(
            r#"
            SELECT id, brand_id, goal, status, current_step, plan, steps, cost_meta,
                result, approval_required, temporal_workflow_id, owner_user_id, owner_org_id, created_at, updated_at
            FROM goal_executions
            WHERE owner_user_id = $1
              AND owner_org_id IS NOT DISTINCT FROM $2
            ORDER BY updated_at DESC
            LIMIT $3
            "#,
        )
        .bind(&scope.user_id)
        .bind(&scope.org_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .unwrap_or_default()
    }

    pub async fn checkpoint(
        &self,
        id: Uuid,
        status: &str,
        current_step: Option<&str>,
        steps: serde_json::Value,
        cost_meta: serde_json::Value,
        result: serde_json::Value,
    ) -> anyhow::Result<()> {
        sqlx::query(
            r#"
            UPDATE goal_executions
            SET status = $2,
                current_step = $3,
                steps = $4,
                cost_meta = $5,
                result = $6,
                updated_at = now()
            WHERE id = $1
            "#,
        )
        .bind(id)
        .bind(status)
        .bind(current_step)
        .bind(steps)
        .bind(cost_meta)
        .bind(result)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

pub fn default_steps() -> serde_json::Value {
    json!([
        {
            "id": "research",
            "type": "intel",
            "status": "pending",
            "description": "Research using cached X intelligence",
            "costEstimate": 0.001
        },
        {
            "id": "plan-content",
            "type": "generate",
            "status": "pending",
            "description": "Generate a draft based on research"
        },
        {
            "id": "approval",
            "type": "approval",
            "status": "pending",
            "description": "Hold for human approval before any X write"
        },
        {
            "id": "monitor",
            "type": "monitor",
            "status": "pending",
            "description": "Monitor engagement for the next 24 hours"
        }
    ])
}
