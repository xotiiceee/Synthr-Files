//! Goal runtime handoff.
//!
//! Rust owns the public API, auth scope, and persisted goal contract. The full
//! Temporal worker can run in a separate process and claim executions through
//! this bridge. Local development keeps using the checkpointed demo runner.

use anyhow::anyhow;
use reqwest::Client;
use serde::Serialize;
use uuid::Uuid;

use crate::goals::GoalExecution;

#[derive(Debug, Clone)]
pub struct GoalRuntime {
    client: Client,
    worker_url: Option<String>,
    worker_token: Option<String>,
    fallback_to_demo: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "mode")]
pub enum GoalRuntimeDispatch {
    TemporalWorker {
        workflow_id: String,
        worker_url: String,
    },
    DemoRunner {
        reason: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartWorkflowPayload<'a> {
    id: Uuid,
    workflow_id: &'a str,
    brand_id: &'a str,
    goal: &'a str,
    approval_required: bool,
}

impl GoalRuntime {
    pub fn from_env() -> Self {
        let worker_url = std::env::var("PULSE_GOAL_WORKER_URL")
            .ok()
            .map(|value| value.trim().trim_end_matches('/').to_string())
            .filter(|value| !value.is_empty());
        let worker_token = std::env::var("PULSE_GOAL_WORKER_TOKEN")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let fallback_to_demo = std::env::var("PULSE_GOAL_WORKER_FALLBACK_DEMO")
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
            .unwrap_or(true);

        Self {
            client: Client::new(),
            worker_url,
            worker_token,
            fallback_to_demo,
        }
    }

    pub async fn dispatch_goal(
        &self,
        execution: &GoalExecution,
    ) -> anyhow::Result<GoalRuntimeDispatch> {
        let Some(worker_url) = &self.worker_url else {
            return Ok(GoalRuntimeDispatch::DemoRunner {
                reason: "PULSE_GOAL_WORKER_URL is not configured".to_string(),
            });
        };

        let workflow_id = execution
            .temporal_workflow_id
            .clone()
            .unwrap_or_else(|| format!("goal-{}", execution.id));
        let url = format!("{worker_url}/workflows/goal-decompose-and-execute");
        let payload = StartWorkflowPayload {
            id: execution.id,
            workflow_id: &workflow_id,
            brand_id: &execution.brand_id,
            goal: &execution.goal,
            approval_required: execution.approval_required,
        };

        let mut request = self.client.post(&url).json(&payload);
        if let Some(token) = &self.worker_token {
            request = request.bearer_auth(token);
        }

        let response = match request.send().await {
            Ok(response) => response,
            Err(err) if self.fallback_to_demo => {
                return Ok(GoalRuntimeDispatch::DemoRunner {
                    reason: format!("failed to contact goal worker at {url}: {err}"),
                })
            }
            Err(err) => return Err(anyhow!("failed to contact goal worker at {url}: {err}")),
        };

        if response.status().is_success() {
            return Ok(GoalRuntimeDispatch::TemporalWorker {
                workflow_id,
                worker_url: worker_url.clone(),
            });
        }

        let status = response.status();
        let details = response.text().await.unwrap_or_default();
        let reason = format!("goal worker rejected dispatch with {status}: {details}");

        if self.fallback_to_demo {
            Ok(GoalRuntimeDispatch::DemoRunner { reason })
        } else {
            Err(anyhow!(reason))
        }
    }
}
