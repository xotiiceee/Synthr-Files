use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use anyhow::Context;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonaCore {
    pub brand_name: String,
    pub niche: String,
    pub description: String,
    pub website: String,
    pub tone: String,
    pub topics: Vec<String>,
    pub competitors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceRule {
    pub rule: String,
    pub source: String, // "profile_clone", "user_input", "engagement_feedback"
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonaExemplar {
    pub id: String,
    pub text: String,
    pub context: String,
    pub score: f64,
    pub source: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonaEvolution {
    pub input: String,
    pub applied_at: String,
    pub source: String,
    pub what_changed: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Persona {
    pub agent_id: String,
    pub core: PersonaCore,
    pub voice: Vec<VoiceRule>,
    pub exemplars: Vec<PersonaExemplar>,
    pub evolution: Vec<PersonaEvolution>,
    pub anti_ai_tells: Vec<String>,
    pub metadata: serde_json::Value,
    pub updated_at: String,
}

impl Persona {
    pub fn empty(agent_id: &str) -> Self {
        Self {
            agent_id: agent_id.to_string(),
            core: PersonaCore {
                brand_name: String::new(),
                niche: String::new(),
                description: String::new(),
                website: String::new(),
                tone: String::new(),
                topics: vec![],
                competitors: vec![],
            },
            voice: vec![],
            exemplars: vec![],
            evolution: vec![],
            anti_ai_tells: vec![
                "avoid 'in today's digital landscape'".to_string(),
                "avoid 'game-changer' and 'revolutionary'".to_string(),
                "avoid overused emoji patterns".to_string(),
                "avoid generic LinkedIn-style openings".to_string(),
            ],
            metadata: serde_json::json!({"confidence": 0.0, "last_cloned": null, "exemplar_count": 0}),
            updated_at: chrono::Utc::now().to_rfc3339(),
        }
    }

    pub fn build_injection_prompt(&self, max_exemplars: usize) -> String {
        let mut parts = Vec::new();

        if !self.core.brand_name.is_empty() {
            parts.push(format!("You are posting as: {}", self.core.brand_name));
        }
        if !self.core.niche.is_empty() {
            parts.push(format!("Industry/niche: {}", self.core.niche));
        }
        if !self.core.tone.is_empty() {
            parts.push(format!("Tone: {}", self.core.tone));
        }
        if !self.core.description.is_empty() {
            parts.push(format!("Brand description: {}", self.core.description));
        }

        if !self.voice.is_empty() {
            let rules: Vec<String> = self.voice.iter()
                .map(|r| format!("- {}", r.rule))
                .collect();
            parts.push(format!("Voice rules:\n{}", rules.join("\n")));
        }

        if !self.anti_ai_tells.is_empty() {
            let tells: Vec<String> = self.anti_ai_tells.iter()
                .map(|t| format!("- {}", t))
                .collect();
            parts.push(format!("Anti-AI-tell rules (MUST follow):\n{}", tells.join("\n")));
        }

        if !self.exemplars.is_empty() {
            let count = self.exemplars.len().min(max_exemplars);
            let examples: Vec<String> = self.exemplars.iter()
                .take(count)
                .map(|e| format!("Example post: \"{}\"", e.text))
                .collect();
            parts.push(format!("Here are real examples of how this brand sounds. Match this style exactly:\n{}", examples.join("\n")));
        }

        parts.join("\n\n")
    }

    pub fn merge_instructions(&mut self, instructions: &str, source: &str) {
        self.evolution.push(PersonaEvolution {
            input: instructions.to_string(),
            applied_at: chrono::Utc::now().to_rfc3339(),
            source: source.to_string(),
            what_changed: "Merged user instructions into persona".to_string(),
        });
        self.updated_at = chrono::Utc::now().to_rfc3339();
    }
}

pub struct PersonaStore {
    pool: PgPool,
}

impl PersonaStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn ensure_schema(&self) -> anyhow::Result<()> {
        sqlx::query(
            r#"
            ALTER TABLE agents ADD COLUMN IF NOT EXISTS persona_core JSONB DEFAULT '{}'::jsonb
            "#
        ).execute(&self.pool).await?;

        sqlx::query(
            r#"
            ALTER TABLE agents ADD COLUMN IF NOT EXISTS persona_voice JSONB DEFAULT '[]'::jsonb
            "#
        ).execute(&self.pool).await?;

        sqlx::query(
            r#"
            ALTER TABLE agents ADD COLUMN IF NOT EXISTS persona_anti_ai_tells JSONB DEFAULT '[]'::jsonb
            "#
        ).execute(&self.pool).await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS persona_exemplars (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                agent_id TEXT NOT NULL,
                text TEXT NOT NULL,
                context TEXT DEFAULT '',
                score DOUBLE PRECISION DEFAULT 0.5,
                source TEXT DEFAULT 'manual',
                created_at TIMESTAMPTZ DEFAULT now()
            )
            "#
        ).execute(&self.pool).await?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_persona_exemplars_agent ON persona_exemplars(agent_id, score DESC)"
        ).execute(&self.pool).await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS persona_evolution (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                agent_id TEXT NOT NULL,
                input TEXT NOT NULL,
                source TEXT DEFAULT 'manual',
                what_changed TEXT DEFAULT '',
                applied_at TIMESTAMPTZ DEFAULT now()
            )
            "#
        ).execute(&self.pool).await?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_persona_evolution_agent ON persona_evolution(agent_id, applied_at DESC)"
        ).execute(&self.pool).await?;

        Ok(())
    }

    pub async fn get_persona(&self, agent_id: &str) -> anyhow::Result<Persona> {
        let row = sqlx::query_as::<_, (Option<serde_json::Value>, Option<serde_json::Value>, Option<serde_json::Value>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<Vec<String>>, Option<Vec<String>>)>(
            "SELECT persona_core, persona_voice, persona_anti_ai_tells, name, brand_name, niche, tone, website, topics, competitors FROM agents WHERE id = $1"
        )
        .bind(agent_id)
        .fetch_optional(&self.pool)
        .await?;

        let exemplars: Vec<PersonaExemplar> = sqlx::query_as::<_, (uuid::Uuid, String, String, f64, String, chrono::DateTime<chrono::Utc>)>(
            "SELECT id, text, context, score, source, created_at FROM persona_exemplars WHERE agent_id = $1 ORDER BY score DESC"
        )
        .bind(agent_id)
        .fetch_all(&self.pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|(id, text, context, score, source, created_at)| PersonaExemplar {
            id: id.to_string(),
            text,
            context,
            score,
            source,
            created_at: created_at.to_rfc3339(),
        })
        .collect();

        let evolution = sqlx::query_as::<_, (String, String, String, String, chrono::DateTime<chrono::Utc>)>(
            "SELECT input, source, what_changed, ''::text, applied_at FROM persona_evolution WHERE agent_id = $1 ORDER BY applied_at DESC"
        )
        .bind(agent_id)
        .fetch_all(&self.pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|(input, source, what_changed, _id, applied_at)| PersonaEvolution {
            input,
            source,
            what_changed,
            applied_at: applied_at.to_rfc3339(),
        })
        .collect();

        match row {
            Some((core_json, voice_json, tells_json, _name, brand_name, niche, tone, website, topics, competitors)) => {
                let core = core_json.and_then(|v| serde_json::from_value::<PersonaCore>(v).ok())
                    .unwrap_or_else(|| PersonaCore {
                        brand_name: brand_name.unwrap_or_default(),
                        niche: niche.unwrap_or_default(),
                        description: String::new(),
                        website: website.unwrap_or_default(),
                        tone: tone.unwrap_or_default(),
                        topics: topics.unwrap_or_default(),
                        competitors: competitors.unwrap_or_default(),
                    });
                let voice: Vec<VoiceRule> = voice_json
                    .and_then(|v| serde_json::from_value(v).ok())
                    .unwrap_or_default();
                let anti_ai_tells: Vec<String> = tells_json
                    .and_then(|v| serde_json::from_value(v).ok())
                    .unwrap_or_else(|| vec![
                        "avoid 'in today's digital landscape'".to_string(),
                        "avoid 'game-changer' and 'revolutionary'".to_string(),
                    ]);

                let meta = serde_json::json!({
                    "confidence": if exemplars.is_empty() { 0.0 } else { 0.5 + (exemplars.len() as f64 * 0.05).min(0.45) },
                    "exemplar_count": exemplars.len(),
                    "voice_rule_count": voice.len(),
                });

                Ok(Persona {
                    agent_id: agent_id.to_string(),
                    core,
                    voice,
                    exemplars,
                    evolution,
                    anti_ai_tells,
                    metadata: meta,
                    updated_at: chrono::Utc::now().to_rfc3339(),
                })
            }
            None => Ok(Persona::empty(agent_id)),
        }
    }

    pub async fn save_persona(&self, persona: &Persona) -> anyhow::Result<()> {
        let core_json = serde_json::to_value(&persona.core)?;
        let voice_json = serde_json::to_value(&persona.voice)?;
        let tells_json = serde_json::to_value(&persona.anti_ai_tells)?;

        sqlx::query(
            "UPDATE agents SET persona_core = $1, persona_voice = $2, persona_anti_ai_tells = $3 WHERE id = $4"
        )
        .bind(&core_json)
        .bind(&voice_json)
        .bind(&tells_json)
        .bind(&persona.agent_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn add_exemplar(&self, agent_id: &str, exemplar: &PersonaExemplar) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO persona_exemplars (agent_id, text, context, score, source) VALUES ($1, $2, $3, $4, $5)"
        )
        .bind(agent_id)
        .bind(&exemplar.text)
        .bind(&exemplar.context)
        .bind(exemplar.score)
        .bind(&exemplar.source)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn add_evolution(&self, agent_id: &str, ev: &PersonaEvolution) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO persona_evolution (agent_id, input, source, what_changed) VALUES ($1, $2, $3, $4)"
        )
        .bind(agent_id)
        .bind(&ev.input)
        .bind(&ev.source)
        .bind(&ev.what_changed)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn boost_exemplar(&self, exemplar_id: &str, delta: f64) -> anyhow::Result<()> {
        sqlx::query("UPDATE persona_exemplars SET score = GREATEST(0.1, LEAST(1.0, score + $1)) WHERE id::text = $2")
            .bind(delta)
            .bind(exemplar_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

pub async fn analyze_profile_for_persona(
    handle: &str,
    tweets: &[String],
    instructions: &str,
    api_key: &str,
) -> anyhow::Result<PersonaAnalysis> {
    let tweets_text = tweets.iter()
        .enumerate()
        .map(|(i, t)| format!("{}. {}", i + 1, t))
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = format!(
        r#"You are a world-class brand voice analyst. Analyze these tweets from @{} and extract a detailed persona profile.

TWEETS (most recent first):
{}

USER INSTRUCTIONS: {}

Return a JSON object with these fields:
- brand_name: A 1-3 word brand descriptor
- niche: The industry/niche they operate in
- tone: Overall tone (e.g. "casual and witty", "professional and insightful")
- description: 1-2 sentence brand description
- topics: Array of 3-5 main content themes
- voice_rules: Array of 5-10 specific writing rules observed (e.g. "uses short punchy sentences", "ends with a question", "no hashtags")
- exemplars: Array of 3-5 of the BEST tweets that exemplify the voice (copy exact text, select high-quality ones)
- anti_ai_tells: Array of 2-4 phrases or patterns this person would NEVER use

Return ONLY valid JSON. No markdown, no explanation."#,
        handle, tweets_text, if instructions.is_empty() { "None" } else { instructions }
    );

    let client = reqwest::Client::new();
    let res = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "model": "openai/gpt-4o-mini",
            "temperature": 0.3,
            "max_tokens": 2000,
            "messages": [{"role": "user", "content": prompt}],
            "response_format": {"type": "json_object"}
        }))
        .send()
        .await
        .context("Failed to analyze profile")?;

    let body: serde_json::Value = res.json().await?;
    let content = body["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("{}");

    let analysis: PersonaAnalysis = serde_json::from_str(content)
        .context("Failed to parse persona analysis")?;

    Ok(analysis)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonaAnalysis {
    pub brand_name: String,
    pub niche: String,
    pub tone: String,
    pub description: String,
    pub topics: Vec<String>,
    pub voice_rules: Vec<VoiceRule>,
    pub exemplars: Vec<PersonaExemplar>,
    pub anti_ai_tells: Vec<String>,
}

pub fn merge_persona(persona: &mut Persona, analysis: &PersonaAnalysis, instructions: &str, source: &str) {
    if !analysis.brand_name.is_empty() {
        persona.core.brand_name = analysis.brand_name.clone();
    }
    if !analysis.niche.is_empty() {
        persona.core.niche = analysis.niche.clone();
    }
    if !analysis.tone.is_empty() {
        persona.core.tone = analysis.tone.clone();
    }
    if !analysis.description.is_empty() {
        persona.core.description = analysis.description.clone();
    }
    if !analysis.topics.is_empty() {
        persona.core.topics = analysis.topics.clone();
    }
    if !analysis.voice_rules.is_empty() {
        for rule in &analysis.voice_rules {
            if !persona.voice.iter().any(|r| r.rule == rule.rule) {
                persona.voice.push(rule.clone());
            }
        }
    }
    if !analysis.anti_ai_tells.is_empty() {
        for tell in &analysis.anti_ai_tells {
            if !persona.anti_ai_tells.contains(tell) {
                persona.anti_ai_tells.push(tell.clone());
            }
        }
    }
    if !analysis.exemplars.is_empty() {
        for ex in &analysis.exemplars {
            if !persona.exemplars.iter().any(|e| e.text == ex.text) {
                persona.exemplars.push(ex.clone());
            }
        }
    }

    persona.merge_instructions(instructions, source);
    persona.metadata = serde_json::json!({
        "confidence": 0.7,
        "last_cloned": chrono::Utc::now().to_rfc3339(),
        "exemplar_count": persona.exemplars.len(),
        "voice_rule_count": persona.voice.len(),
    });
}
