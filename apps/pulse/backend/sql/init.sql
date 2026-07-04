-- Phase 1 Data Foundations: Pulse app schema (Postgres + pgvector ready)
-- Run manually or via docker init for persistence.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    brand_name TEXT NOT NULL,
    niche TEXT,
    tone TEXT,
    website TEXT DEFAULT '',
    x_handle TEXT DEFAULT '',
    topics TEXT[] DEFAULT '{}',
    competitors TEXT[] DEFAULT '{}',
    running BOOLEAN DEFAULT false,
    owner_user_id TEXT NOT NULL DEFAULT 'demo-user',
    owner_org_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

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
);

CREATE TABLE IF NOT EXISTS knowledge (
    id TEXT PRIMARY KEY,
    brand_id TEXT,
    source TEXT,
    content TEXT,
    metadata JSONB,
    embedding vector(1536),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for vectors and filters (for pgvector)
CREATE INDEX IF NOT EXISTS idx_knowledge_embedding ON knowledge USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_knowledge_brand ON knowledge (brand_id);
CREATE INDEX IF NOT EXISTS idx_goal_executions_owner_updated ON goal_executions(owner_org_id, owner_user_id, updated_at DESC);

-- Usage / credits simple ledger
CREATE TABLE IF NOT EXISTS usage_events (
    id SERIAL PRIMARY KEY,
    brand_id TEXT,
    credits_delta INT,
    spend_usd NUMERIC,
    meta JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE agents IS 'Core brand/agent state. In-mem fallback in Phase 0 Rust; sqlx in Phase 1+.';
COMMENT ON TABLE goal_executions IS 'Temporal-ready persisted goal workflow state. Demo runner checkpoints here until Phase 2 worker owns execution.';
