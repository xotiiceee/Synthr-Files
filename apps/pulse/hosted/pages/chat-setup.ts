/**
 * Chat Setup — Conversational agent configuration + ongoing advisor.
 *
 * The chat is the PRIMARY interface. It can:
 * - Walk new users through brand setup conversationally
 * - Read and modify ANY setting (autopilot, model, topics, voice, etc.)
 * - Save/delete knowledge notes
 * - Explain costs, recommend settings, answer questions
 * - Execute actions via tag-based tools (parsed from LLM response)
 *
 * Tool pattern: LLM emits [ACTION_TAG: payload] in its response.
 * Server parses, executes, strips tool calls, returns clean reply + action results.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import YAML from "yaml";
import { recordAuditEvent, type Tenant } from "../db.js";
import { initTenantConfig } from "../tenant.js";
import {
  evaluateToolActionPolicy,
  type ChatToolPolicyContext,
  type ToolAction,
  isAllowedUpdateSettingPath,
  parseToolActions,
  stripToolTags,
} from "../chat-tools.js";
import { loadState, saveState } from "../../src/core/state.js";
import {
  askLLMWithSystem,
  askLLMWithSystemAndUsage,
  type LLMUsage,
} from "../../src/core/llm.js";
import { getCRM } from "../../src/crm/database.js";
import { updateHostedBrandRuntimeConfig } from "../brand-runtime-context.js";
import { currentHostedRuntimeAgentId } from "../runtime-agent.js";

/** Per-agent knowledge notes key */
function knowledgeKey(): string {
  const agentId = currentHostedRuntimeAgentId();
  return `knowledge-notes-${agentId}`;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatState {
  conversationId: string;
  messages: ChatMessage[];
  configDraft: Record<string, any>;
  complete: boolean;
}

// Max messages sent to LLM per call (sliding window)
const LLM_CONTEXT_WINDOW = 20;

// ─── SQLite-Backed Sessions ─────────────────────────────────────────────────

function getSession(tenantId: string): ChatState {
  const db = getCRM();
  const agentId = currentHostedRuntimeAgentId();

  // Find active conversation for this agent
  let convo = db
    .prepare(
      `SELECT id FROM chat_conversations WHERE status = 'active' AND agent_id = ? ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(agentId) as { id: string } | undefined;

  if (!convo) {
    // Create new conversation for this agent
    const id = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO chat_conversations (id, status, agent_id, created_at, updated_at) VALUES (?, 'active', ?, ?, ?)`,
    ).run(id, agentId, now, now);
    return {
      conversationId: id,
      messages: [],
      configDraft: {},
      complete: false,
    };
  }

  // Load messages
  const rows = db
    .prepare(
      `SELECT role, content FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC`,
    )
    .all(convo.id) as Array<{ role: string; content: string }>;

  // Strip any leaked tool tags from old messages (pre-fix data in DB)
  const tagClean = (s: string) =>
    s
      .replace(
        /\[(SAVE_KNOWLEDGE|UPDATE_NOTE|MERGE_NOTES|DELETE_NOTE|UPDATE_SETTING|ADD_TOPIC|SET_AUTOPILOT|SET_MODEL|READY_TO_CONFIGURE|EXPORT_PROFILE|GENERATE_IMAGE|LIST_IMAGES)(:\s*[\s\S]*?)?\]/g,
        "",
      )
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  return {
    conversationId: convo.id,
    messages: rows.map((r) => ({
      role: r.role as "user" | "assistant",
      content: r.role === "assistant" ? tagClean(r.content) : r.content,
    })),
    configDraft: {},
    complete: false,
  };
}

function saveMessage(
  conversationId: string,
  role: string,
  content: string,
): void {
  const db = getCRM();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO chat_messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)`,
  ).run(conversationId, role, content, now);
  db.prepare(`UPDATE chat_conversations SET updated_at = ? WHERE id = ?`).run(
    now,
    conversationId,
  );
}

// ─── System Prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Pulse — an AI marketing strategist that runs the user's X (Twitter) growth through an automated agent. You are their personal marketing person, not a chatbot.

YOUR IDENTITY: You are their marketing person. Not a chatbot, not a generic AI assistant. You know their brand, their niche, their numbers. You adapt to THEIR style — if they're aggressive, you match that energy. If they're subtle, you're subtle. If they're data-driven, you lead with numbers. Read the USER PREFERENCES in CURRENT CONTEXT to understand who this person is and how they work.

PLATFORM: Pulse's standalone launch product automates X (Twitter) growth. Non-X surfaces are not canonical for customer launch. If users ask about Reddit, Discord, LinkedIn, or other platforms, be honest that Pulse is X-only for launch and that LinkedIn can be treated as draft/manual strategy only when explicitly enabled.

ADAPTIVE BEHAVIOR — this is what makes you 10/10:

1. MIRROR THEIR STYLE — Read the USER PREFERENCES section in CURRENT CONTEXT. If they're terse, be terse. If they write paragraphs, you can too. If they use emoji, match it. If they're formal, be formal. If no preferences are learned yet, start neutral and adapt as you observe.

2. NO HARDCODED OPINIONS — You don't have a default marketing philosophy. The user's style IS the philosophy. If they want aggressive posting, help them do it well. If they want subtle community engagement, help with that. If they want to compliment competitors, great. If they want to ignore them, also great. Your job is to execute THEIR vision, not yours.

3. PROPOSE THEN CONFIRM — Never silently change settings. Suggest, then apply only if they agree. Exception: saving knowledge notes from info they just gave you — always save those immediately.

4. NOTICE GAPS — Look at the CURRENT CONTEXT. If there are no content themes, suggest some. If knowledge notes are messy, offer to clean up. If autopilot is off, ask if they want to enable it. But present observations, not prescriptions.

5. MATCH THE SCOPE — Read how they ask.
   - Short question → short answer
   - "Review my setup" → full picture
   - Big info dump → the server already auto-saved it as knowledge notes (check for SYSTEM NOTE in context). Just acknowledge and move on.

6. BE CONCISE — Max 3-4 short paragraphs. Don't repeat what they said. Don't give generic advice. Everything should be specific to THIS brand and actionable through Pulse. Match their message length.

7. LEARN FROM THEM — Every interaction teaches you something. If they reject a suggestion, that's a signal about their preferences. If they edit a draft, the edit IS the feedback. Adapt accordingly. Don't repeat approaches they've already dismissed.
   - Write like a human who's good at their job. Match the user's energy.

7. X PLATFORM SAFETY — When users want aggressive posting or following:
   - X rate-limits accounts that post too much or follow too fast. These limits change — don't cite specific numbers. Instead, advise caution and recommend starting conservative.
   - You CAN discuss follow farming, mass-following, aggressive tactics — but always explain the risks honestly and recommend Pulse's safer alternative (engage-first growth: interact with someone's content, then follow if relevant).
   - If they ask for aggressive mode, warn about the risk but don't refuse. Set it up if they insist, just make sure they understand the trade-off.
   - Frame it as protecting their account, not limiting them. "I'll set it up, but here's what I've seen happen to accounts that go too hard too fast..."

CAPABILITIES — you can:
1. Set up a new agent from scratch (brand, niche, voice, topics)
2. Read and modify any setting (autopilot mode, content model, posting frequency, etc.)
3. Save and manage knowledge notes (brand facts the agent always knows)
4. Explain plan usage and recommend the right AI model for their budget
5. Add/remove engagement topics and competitors
6. Adjust voice and tone settings
7. Help with content strategy for X
8. Export agent profile as a shareable file (use an export_profile tool call when they ask to export, share, or download their setup)
9. Link users to connect their X account — when setup is done or when they need to connect X, include this link in your message: [Connect your X account](/auth/x/authorize). The frontend will render it as a clickable link.

WHAT PULSE CAN DO — know this so you can answer feature questions accurately:
- Autopilot: semi-auto (drafts for review) or full-auto (posts autonomously within rules)
- Content generation: posts and threads for X, using the user's voice and knowledge notes
- Engagement: finds relevant conversations on X and replies in the brand's voice
- Growth: engagement-first follow system (engage with content, then follow if relevant)
- Content themes: auto-adapt based on engagement data — themes that perform well get used more
- Knowledge notes: brand facts the agent uses in every post. Bot-managed, user can lock notes.
- Voice matching: paste tweets and Pulse matches the writing style
- Approval queue: review and approve/reject posts before they go live
- Scheduling: configure posting frequency and active hours
- Analytics: activity feed with engagement stats, platform breakdown, theme performance
- Profile export/import: share agent setup as .pulse.json files
- Multiple AI models: low-cost, balanced, and premium quality options
- Standalone billing: subscription entitlements plus metered usage events

WHAT PULSE CANNOT DO (be honest if asked):
- Cannot post on Reddit, LinkedIn, Discord, or other platforms (X only)
- Cannot access X DMs or manage followers lists
- Cannot guarantee specific view/follower counts
- Cannot run paid ads or promotions
- Cannot access the user's X analytics dashboard (only tracks what Pulse posts)

If someone asks about a feature that doesn't exist, say so and mention they can submit a suggestion through the feedback button in the sidebar.

GATHERING INFO (for new users):
You need these pieces of info to configure the agent. DO NOT ask for info the user already provided — carefully read their messages and extract everything they've already told you before asking anything.

Needed info:
1. Brand name & what they do
2. Niche/industry
3. Website URL, X/Twitter handle
4. Ideal customer, problem solved, unique value
5. Preferred tone (professional/casual/witty/technical/friendly/authoritative)
6. Voice sample — "Paste 5-10 recent tweets and I'll match your style"
7. Topics/keywords to engage with
8. Competitors to watch
9. Posting frequency (conservative=3/day, moderate=5, active=8+)
10. Words/topics to AVOID

CRITICAL: If the user gives you a big info dump covering multiple items, acknowledge ALL of it, save what needs saving, then ONLY ask about what's still missing. Never re-ask for something they already told you. If they gave you 8 out of 10 items, just ask about the 2 remaining ones. After saving, proactively tell them what you'd recommend next — don't wait to be asked.

ONBOARDING FLOW (for new users, follow this order):
1. Gather brand info conversationally (name, niche, what they do)
2. Save knowledge notes as you learn facts
3. Check CURRENT CONTEXT for "X ACCOUNT: Connected" — if already connected, SKIP the connect prompt entirely. Only prompt to connect if the context says "NOT CONNECTED": "Now let's connect your X account so your agent can start posting: [Connect your X account](/auth/x/authorize)"
4. After X is connected, suggest enabling autopilot
Don't rush step 3 — get the brand right first. But don't wait too long either. The moment you have brand name + niche + a few rules saved, suggest connecting (only if not already connected).

FOR SECOND+ AGENTS: If X is already connected at the tenant level, ask: "Your X account is already connected from your other agent. Do you want this agent to use the same X account, or connect a different one?" If same, no action needed. If different, provide the connect link.

TOOLS — include typed tool calls in a fenced pulse-tools JSON block at the end of your response. You MUST use these whenever applicable — do not skip them.

Format:
\`\`\`pulse-tools
[
  {"type":"save_knowledge","payload":{"title":"short title","content":"the fact to remember","priority":2}}
]
\`\`\`

The user never sees this block. The server parses it, executes allowed actions, and strips it before saving or returning your visible reply. Do not use the old bracket-tag format in new replies.

Tool type: save_knowledge
Payload: {"title": "short title", "content": "the fact to remember", "priority": 2}
Save a brand fact as a knowledge note. The agent uses these notes in EVERY post and reply it generates. This is how you teach the agent about the brand.

Priority levels:
- 0 = background context (nice to have)
- 1 = normal (included in most prompts)
- 2 = important (included in all content generation)
- 3 = critical rule (included in EVERY LLM call — use for absolute rules like "never say X")

WHEN TO SAVE vs WHEN NOT TO SAVE — this is critical for being smart, not annoying:

SAVE knowledge notes when the user is GIVING YOU BRAND FACTS:
- Brand name, what they do, products, services
- Target audience, ideal customer, value proposition
- Website URL, X handle, social links
- Tone rules, voice preferences, words to avoid
- Competitors
- Industry facts, stats, claims ("We're SOC 2 compliant", "We have 500 users")
- Content rules ("never mention competitor X negatively")

SAVE IMMEDIATELY when the user pastes structured product info, brand descriptions, or product context documents. These ARE brand facts — treat them as the definitive source. Break them into organized knowledge notes (one per product/topic) and save without asking.

DO NOT SAVE when the user is:
- Asking for your opinion ("what do you think of this?") — RESPOND with analysis, don't save
- Pasting random tweets or articles for discussion — DISCUSS it, only save if they say to
- Brainstorming or exploring ideas — ENGAGE with the ideas, don't save half-formed thoughts
- Asking a question — ANSWER it
- Giving feedback on your suggestions — ADJUST, don't save the feedback as a note

The rule: if the content describes THEIR products, brand, or offerings — save it immediately as knowledge notes. If they're asking for analysis or showing someone else's content — discuss, don't save.

When you DO save, group related facts into RICH notes:
- Brand identity (name + niche + website + X handle) = ONE note
- Product descriptions = ONE note per product
- Tone & voice rules = ONE note
- Competitors = ONE note listing all with context

Each note: 2-5 sentences, rich enough for the agent to use. NOT "Acme has an API" (useless). YES "Acme Tools is a developer workflow platform for small engineering teams. It turns scattered build, deploy, and incident signals into one prioritized release queue, with GitHub integration, Slack alerts, and team-level approval rules. Target audience: founders and engineering leads who need calmer release operations."

IMPORTANT: Always use valid JSON in the pulse-tools block. Do not add comments, trailing commas, or prose inside the block.

Tool type: update_note
Payload: {"title": "existing title", "content": "updated content", "priority": 2}
Update an existing knowledge note's content and/or priority. Use this to improve, expand, or correct existing notes.

Tool type: merge_notes
Payload: {"titles": ["note 1", "note 2"], "newTitle": "combined title", "newContent": "merged content", "priority": 2}
Combine multiple small notes into one comprehensive note. Delete the originals and create the merged version.

Tool type: delete_note
Payload: "note-title"
Remove a knowledge note by its exact title.

NOTE MANAGEMENT — be a PROACTIVE knowledge manager:
When you see the user's existing knowledge notes in CURRENT CONTEXT:
- Look for duplicate or overlapping notes and MERGE them without asking (e.g., "Brand Name" + "Brand Information" → one rich note)
- If a note is tiny (1 sentence), merge it into a related note
- Update notes that are outdated or incomplete
- If the user gives you new info that contradicts an existing note, UPDATE the note
- If the user asks to "clean up" or "organize" notes, do a full sweep with MERGE_NOTES and UPDATE_NOTE
- NEVER modify a note marked [LOCKED] — tell the user it's locked if they ask you to change it
- When a note is important and the user confirmed it's correct, suggest they lock it: "Want me to suggest locking this note so it won't be changed accidentally?"
- Don't spam lock suggestions — only for critical rules or confirmed facts

Tool type: update_setting
Payload: {"path": "setting.path", "value": "new-value"}
Change a config setting. Common paths:
- "autopilot.mode" → "off", "semi", "full"
- "autopilot.postsPerDay" → number
- "autopilot.tone" → "professional", "casual", etc.
- "persona.brandName" → string
- "persona.niche" → string
- "persona.xHandle" → "@handle"
- "persona.website" → "https://..."
- "persona.tone" → "professional", etc.
- "persona.neverSay" → ["word1", "word2"]
- "account.contentModel" → "llama-3.3-70b", "gpt-4o-mini", "claude-haiku", "gpt-4o", "claude-sonnet"
- "autoFollow.enabled" → true/false
- "autoFollow.dailyCap" → number

Tool type: add_topic
Payload: {"query": "search keywords", "replies": ["template reply 1", "template reply 2"]}
Add a new engagement topic the agent should look for and reply to.

Tool type: set_autopilot
Payload: "off"|"semi"|"full"
Shortcut to change autopilot mode.

Tool type: set_model
Payload: "model-id"
Shortcut to change content AI model. IDs: llama-3.3-70b, gpt-4o-mini, claude-haiku, gpt-4o, claude-sonnet.

Tool type: generate_image
Payload: {"prompt": "what to generate", "tags": ["tag1", "tag2"]}
Generate an AI image and save it to the media library. Use descriptive prompts. Include tags so the bot knows when to auto-attach it. When the user asks for an image, meme, logo, or visual — use this.

Tool type: list_images
Payload: null
Show the user what images are in their media library.

Tool type: ready_to_configure
Payload: null
Signal that you have enough info for initial setup. Triggers config generation.

RULES:
- LATEST INFO WINS — if the user corrects something or pastes updated info that contradicts earlier messages in the conversation, the LATEST version is the truth. Update existing knowledge notes to match. Never cling to outdated info from earlier in the conversation.
- NEVER ask for info the user already gave you. Read their messages carefully. If they gave you brand name, niche, tone, competitors, and X handle in one message — acknowledge all of it and only ask about what's STILL missing.
- When a user gives you a large info dump, your response should be: (1) confirm what you captured, (2) save knowledge notes for important facts using save_knowledge tool calls — you MUST actually emit the tool calls, not just say you saved, (3) ask ONLY about the 1-2 things still needed.
- Ask ONE question at a time (for the remaining unknowns only)
- Be conversational, not form-like — react to what they say
- When the user wants to change something, DO IT with the appropriate tool call. Don't tell them to go to Settings.
- When you detect brand facts worth saving, save them with save_knowledge tool calls
- Always confirm what you changed: "Done — I've set your autopilot to semi-auto mode."
- If a user asks about costs, use the CURRENT CONTEXT to explain their model pricing
- Never expose internal implementation details (API keys, server architecture, etc.)
- If you don't know something, say so — don't make things up

ADAPTIVE THEMES:
Content themes are NOT locked to setup. They automatically evolve based on engagement data:
- Themes that get high engagement are used more often (weighted selection)
- After enough data (10+ posts), the system generates new theme variations from top performers
- Underperforming themes get retired automatically
- This runs weekly during the adaptation cycle
- Users can also trigger it manually or ask you to add/remove themes anytime
If a user asks "why do my posts keep covering the same topics?" — explain that themes adapt over time and they can add new ones via chat.

COST AWARENESS:
When the user asks about costs or you recommend a model change, explain clearly:

Content generation costs (per action):
- Llama 3.1 8B: cheapest, basic quality
- GPT-4o Mini: best value — cheap and smart (recommended default)
- Llama 3.3 70B: fast, good quality, mid-price
- Claude Haiku 4.5: high quality, costs more
- GPT-4o: very high quality, premium price
- Claude Sonnet: best quality, most expensive
Costs are fixed per model per action (shown in the model selector). 15% margin over API costs.

Chat costs (per message, this conversation):
- Llama 3.3 / 3.1: 0.5 cr/message
- GPT-4o Mini: 1 cr/message
- Claude Haiku: 4 cr/message
- GPT-4o: 10 cr/message
- Claude Sonnet: 14 cr/message

Other actions (flat, no model multiplier):
- Discovery: 3 cr, Search: 1 cr, Follow: 1 cr

All pricing is 15% over actual API cost — fair and transparent.

After initial setup (brand + niche + tone minimum), end your message with a ready_to_configure tool call.
When you see [GENERATE_CONFIG], respond with ONLY a JSON block:

\`\`\`json
{
  "persona": {
    "brandName": "...", "name": "...", "website": "...",
    "tagline": "one-line tagline", "niche": "...",
    "idealCustomer": "...", "problemSolved": "...", "uniqueValue": "...",
    "tone": "professional|casual|witty|technical|friendly|authoritative",
    "neverSay": ["word1"], "xHandle": "@..."
  },
  "voice": {
    "catchphrases": [], "emojiFrequency": "none|rare|moderate|heavy",
    "capStyle": "normal|mostly-lowercase|mixed-emphasis",
    "sentenceStyle": "short-punchy|flowing-complex|mixed",
    "humorStyle": "dry|self-deprecating|observational|none",
    "casualtyLevel": 0.0
  },
  "topics": [{"id": "topic-1", "query": "keyword", "replies": ["template"]}],
  "competitors": ["comp1"],
  "aggressiveness": "conservative|moderate|active",
  "contentThemes": ["theme1", "theme2"]
}
\`\`\`

If they didn't paste tweets, omit "voice" (defaults will be used).
Start by greeting the user and asking what they need help with.`;

// ─── Chat Context ───────────────────────────────────────────────────────────

interface KnowledgeSuggestion {
  title: string;
  content: string;
  priority: number;
}

export interface ChatContext {
  platforms: string[];
  agentName: string;
  brandName?: string;
  niche?: string;
  credits?: number;
  // Extended context for tools
  xConnected?: boolean;
  autopilotMode?: string;
  contentModel?: string;
  postsPerDay?: number;
  topics?: Array<{ id: string; query: string }>;
  contentThemes?: string[];
  competitors?: string[];
  knowledgeNotes?: Array<{ title: string; content: string; priority: number }>;
  tone?: string;
  /** Platform-level product context — auto-injected, operator-maintained */
  platformContext?: string;
}

function buildContextBlock(ctx: ChatContext): string {
  const parts: string[] = [];

  // Detect brand-new user: no brand name or default placeholder
  const isNewUser =
    !ctx.brandName ||
    ctx.brandName === "My Brand" ||
    ctx.brandName === "Default Agent";
  if (isNewUser) {
    parts.push(
      "STATUS: NEW USER — no brand configured yet. Start with friendly onboarding. Ask about their brand and what they do. Keep it conversational, not form-like. If they already have other agents (check AGENT field), skip the full intro — ask what this new agent is for and offer to copy settings from an existing one.",
    );
  }

  parts.push(
    `X ACCOUNT: ${ctx.xConnected ? "Connected" : "NOT CONNECTED — once brand info is gathered, prompt user to connect with: [Connect your X account](/auth/x/authorize)"}`,
  );
  parts.push(`AGENT: ${ctx.agentName}`);
  if (ctx.brandName && !isNewUser) parts.push(`BRAND: ${ctx.brandName}`);
  if (ctx.niche) parts.push(`NICHE: ${ctx.niche}`);
  if (ctx.tone) parts.push(`TONE: ${ctx.tone}`);
  if (ctx.credits != null) parts.push(`CREDITS: ${ctx.credits}`);
  if (ctx.contentModel) parts.push(`CONTENT MODEL: ${ctx.contentModel}`);
  if (ctx.autopilotMode) parts.push(`AUTOPILOT: ${ctx.autopilotMode}`);
  if (ctx.postsPerDay) parts.push(`POSTS/DAY: ${ctx.postsPerDay}`);
  if (ctx.topics?.length)
    parts.push(`TOPICS: ${ctx.topics.map((t) => t.query).join(", ")}`);
  if (ctx.contentThemes?.length)
    parts.push(`CONTENT THEMES: ${ctx.contentThemes.join(", ")}`);
  if (ctx.competitors?.length)
    parts.push(`COMPETITORS: ${ctx.competitors.join(", ")}`);
  // Platform-level product knowledge (operator-maintained, auto-injected)
  if (ctx.platformContext) {
    parts.push(
      `PLATFORM KNOWLEDGE (ground truth about our products — use this to answer product questions accurately):\n${ctx.platformContext}`,
    );
  }
  if (ctx.knowledgeNotes?.length) {
    parts.push(`KNOWLEDGE NOTES (${ctx.knowledgeNotes.length}):`);
    for (const n of ctx.knowledgeNotes.slice(0, 15)) {
      const lock = (n as any).locked ? " [LOCKED]" : "";
      parts.push(
        `  - [P${n.priority}]${lock} ${n.title}: ${n.content.slice(0, 100)}`,
      );
    }
  }
  // System-level notes from preference engine + smart import
  if ((ctx as any)._systemNotes) {
    parts.push((ctx as any)._systemNotes);
  }

  return `\n\nCURRENT CONTEXT:\n${parts.join("\n")}`;
}

// ─── Tool Action Parsing ────────────────────────────────────────────────────

export type { ToolAction } from "../chat-tools.js";
export { parseToolActions, stripToolTags } from "../chat-tools.js";

export interface ExecuteToolActionsOptions {
  dryRun?: boolean;
  confirmHighImpact?: boolean;
  policy?: ChatToolPolicyContext;
  audit?: {
    orgId?: string;
    workspaceId?: string;
    brandId?: string;
    agentId?: string;
    actorId?: string;
  };
}

// ─── Chat Handler ───────────────────────────────────────────────────────────

export interface ChatModelOptions {
  provider?: string;
  model?: string;
  maxTokens?: number;
}

export async function handleChatMessage(
  tenantId: string,
  userMessage: string,
  context?: ChatContext,
  modelOptions?: ChatModelOptions,
): Promise<{
  reply: string;
  configReady: boolean;
  config?: Record<string, any>;
  knowledge?: KnowledgeSuggestion;
  knowledgeNotes?: KnowledgeSuggestion[];
  actions?: ToolAction[];
  usage?: LLMUsage;
}> {
  const session = getSession(tenantId);

  // User wants to generate config
  if (
    userMessage === "__generate__" &&
    session.configDraft &&
    Object.keys(session.configDraft).length > 0
  ) {
    return {
      reply: "Configuration saved! Redirecting to dashboard...",
      configReady: true,
      config: session.configDraft,
    };
  }

  // Persist user message
  session.messages.push({ role: "user", content: userMessage });
  saveMessage(session.conversationId, "user", userMessage);

  // Build conversation for LLM — sliding window of last N messages
  const contextBlock = context ? buildContextBlock(context) : "";
  const fullSystemPrompt = SYSTEM_PROMPT + contextBlock;

  const recentMessages = session.messages.slice(-LLM_CONTEXT_WINDOW);
  const conversationPrompt = recentMessages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const llmResult = await askLLMWithSystemAndUsage(
    fullSystemPrompt,
    conversationPrompt,
    {
      maxTokens: modelOptions?.maxTokens ?? 1000,
      temperature: 0.7,
      timeout: 30_000,
      provider: modelOptions?.provider,
      model: modelOptions?.model,
    },
  );

  if (!llmResult) {
    return {
      reply: "Sorry, I'm having trouble connecting. Try again in a moment.",
      configReady: false,
    };
  }

  const rawReply = llmResult.text;
  const usage = llmResult.usage;

  // Parse all tool actions from the raw reply before stripping tool blocks.
  const actions = parseToolActions(rawReply);

  // Extract ALL knowledge notes (not just first)
  const knowledgeActions = actions.filter((a) => a.type === "save_knowledge");
  const knowledgeNotes: KnowledgeSuggestion[] = knowledgeActions.map(
    (a) => a.payload as KnowledgeSuggestion,
  );
  const knowledge = knowledgeNotes[0]; // backwards compat — first note

  // Check if config is ready
  const configReady = actions.some((a) => a.type === "ready_to_configure");

  // If ready, generate the JSON config
  if (configReady) {
    const configPrompt =
      session.messages
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n\n") + "\n\nUser: [GENERATE_CONFIG]";

    const configReply = await askLLMWithSystem(SYSTEM_PROMPT, configPrompt, {
      maxTokens: 1500,
      temperature: 0.3,
      timeout: 30_000,
    });

    if (configReply) {
      try {
        const jsonMatch =
          configReply.match(/```json\s*([\s\S]*?)```/) ||
          configReply.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const json = jsonMatch[1] || jsonMatch[0];
          session.configDraft = JSON.parse(json);
        }
      } catch {
        /* parse failed */
      }
    }
  }

  // Clean tool calls from the visible reply — save CLEAN version to DB
  const cleanReply = stripToolTags(rawReply, actions);
  session.messages.push({ role: "assistant", content: cleanReply });
  saveMessage(session.conversationId, "assistant", cleanReply);

  return {
    reply: cleanReply,
    configReady,
    config: configReady ? session.configDraft : undefined,
    knowledge,
    knowledgeNotes,
    actions: actions.filter(
      (a) => a.type !== "ready_to_configure" && a.type !== "save_knowledge",
    ),
    usage,
  };
}

export function resetChat(tenantId: string): void {
  // Archive the active conversation for this agent, don't delete it
  const db = getCRM();
  const agentId = currentHostedRuntimeAgentId();
  db.prepare(
    `UPDATE chat_conversations SET status = 'archived' WHERE status = 'active' AND agent_id = ?`,
  ).run(agentId);
}

// ─── Apply Config ───────────────────────────────────────────────────────────

export function applyChatConfig(
  tenantId: string,
  config: Record<string, any>,
): void {
  const persona = config.persona || {};

  initTenantConfig(tenantId, {
    brandName: persona.brandName || "",
    website: persona.website || "",
    niche: persona.niche || "",
    xHandle: persona.xHandle || "",
    tagline: persona.tagline || "",
    tone: persona.tone || "casual",
    agentRole: "",
  });

  try {
    const configPath = path.join(
      process.cwd(),
      "data",
      "tenants",
      tenantId,
      "pulse.yaml",
    );

    if (fs.existsSync(configPath)) {
      const existing = YAML.parse(fs.readFileSync(configPath, "utf-8")) || {};

      existing.persona = { ...existing.persona, ...persona };

      if (config.topics?.length) existing.topics = config.topics;
      if (config.competitors?.length) existing.competitors = config.competitors;

      if (config.aggressiveness) {
        existing.aggressiveness = config.aggressiveness;
        const postsMap: Record<string, number> = {
          conservative: 3,
          moderate: 5,
          active: 8,
        };
        if (!existing.schedule) existing.schedule = {};
        existing.schedule.contentPostsPerDay =
          postsMap[config.aggressiveness] || 5;
      }

      if (config.contentThemes?.length)
        existing.contentThemes = config.contentThemes;

      if (config.voice) {
        if (!existing.humanBehavior) existing.humanBehavior = {};
        existing.humanBehavior.voice = {
          ...(existing.humanBehavior.voice || {}),
          ...config.voice,
        };
      }

      fs.writeFileSync(
        configPath,
        YAML.stringify(existing, { lineWidth: 120 }),
        "utf-8",
      );
    }
  } catch (err) {
    console.error("[ChatSetup] Failed to apply config:", err);
  }
}

// ─── Execute Tool Actions ───────────────────────────────────────────────────

function getHighImpactConfirmationReason(action: ToolAction): string | null {
  if (action.type === "set_autopilot" && action.payload === "full") {
    return "enabling full autopilot requires explicit confirmation";
  }
  if (
    action.type === "update_setting" &&
    action.payload.path === "autopilot.mode" &&
    action.payload.value === "full"
  ) {
    return "enabling full autopilot requires explicit confirmation";
  }
  if (
    action.type === "update_setting" &&
    action.payload.path === "autoFollow.enabled" &&
    action.payload.value === true
  ) {
    return "enabling follow automation requires explicit confirmation";
  }
  return null;
}

/**
 * Execute parsed tool actions against the tenant's config.
 * Called by the server after handleChatMessage returns actions.
 */
export function executeToolActions(
  tenantId: string,
  actions: ToolAction[],
  options: ExecuteToolActionsOptions = {},
): string[] {
  const results: string[] = [];
  const dryRun = options.dryRun === true;

  for (const action of actions) {
    try {
      const policy = evaluateToolActionPolicy(action, options.policy);
      const confirmationReason = getHighImpactConfirmationReason(action);
      const confirmationAllowed =
        confirmationReason === null || options.confirmHighImpact === true;
      const allowed = policy.allowed && confirmationAllowed;
      if (policy.mutating && options.audit) {
        const actionLabel = action.type;
        const metadata: Record<string, unknown> = {
          outcome: allowed ? "accepted" : "rejected",
          actionType: action.type,
          impact: policy.impact,
        };
        if (policy.permission) metadata.permission = policy.permission;
        if (policy.targetType === "setting" && policy.targetId)
          metadata.path = policy.targetId;
        if (policy.targetType === "knowledge_note" && policy.targetId)
          metadata.title = policy.targetId;
        if (policy.targetType === "topic" && policy.targetId)
          metadata.query = policy.targetId;
        if (policy.targetType === "image_request" && policy.targetId)
          metadata.prompt = policy.targetId;
        if (dryRun) metadata.dryRun = true;
        if (!allowed) metadata.reason = policy.reason || confirmationReason;
        recordAuditEvent({
          tenantId,
          orgId: options.audit.orgId,
          workspaceId: options.audit.workspaceId,
          brandId: options.audit.brandId,
          agentId: options.audit.agentId,
          actorId: options.audit.actorId,
          action: `chat_tool.${actionLabel}`,
          targetType: policy.targetType,
          targetId: policy.targetId,
          metadata,
        });
      }
      if (!policy.allowed) {
        results.push(`Denied ${action.type}: ${policy.reason}`);
        continue;
      }
      if (!confirmationAllowed) {
        results.push(`Denied ${action.type}: ${confirmationReason}`);
        continue;
      }

      switch (action.type) {
        case "update_setting": {
          const { path: settingPath, value } = action.payload;
          if (!settingPath || value === undefined) break;
          if (!isAllowedUpdateSettingPath(settingPath)) {
            console.warn(
              `[Chat Tool] Ignored invalid UPDATE_SETTING path: ${settingPath}`,
            );
            break;
          }
          if (dryRun) {
            results.push(
              `Would update ${settingPath} = ${JSON.stringify(value)}`,
            );
            break;
          }
          updateNestedSetting(tenantId, settingPath, value);
          results.push(`Updated ${settingPath} = ${JSON.stringify(value)}`);
          break;
        }
        case "set_autopilot": {
          const mode = action.payload;
          if (["off", "semi", "full"].includes(mode)) {
            if (dryRun) {
              results.push(`Would set autopilot to ${mode}`);
              break;
            }
            updateNestedSetting(tenantId, "autopilot.mode", mode);
            results.push(`Autopilot set to ${mode}`);
          }
          break;
        }
        case "set_model": {
          const modelId = action.payload;
          const valid = [
            "llama-3.3-70b",
            "gpt-4o-mini",
            "claude-haiku",
            "gpt-4o",
            "claude-sonnet",
          ];
          if (valid.includes(modelId)) {
            if (dryRun) {
              results.push(`Would set content model to ${modelId}`);
              break;
            }
            updateNestedSetting(tenantId, "account.contentModel", modelId);
            results.push(`Content model set to ${modelId}`);
          }
          break;
        }
        case "add_topic": {
          const topic = action.payload;
          if (topic.query) {
            if (dryRun) {
              results.push(`Would add topic: ${topic.query}`);
              break;
            }
            addTopicToConfig(tenantId, topic);
            results.push(`Added topic: ${topic.query}`);
          }
          break;
        }
        case "delete_note": {
          const delNotes = loadState<any[]>(knowledgeKey(), []);
          const target = delNotes.find((n: any) => n.title === action.payload);
          if (target?.locked) {
            results.push(
              `Cannot delete "${action.payload}" — it's locked by the user.`,
            );
            break;
          }
          if (dryRun) {
            results.push(`Would delete note: ${action.payload}`);
            break;
          }
          const before = delNotes.length;
          const filtered = delNotes.filter(
            (n: any) => n.title !== action.payload,
          );
          if (filtered.length < before) {
            saveState(knowledgeKey(), filtered);
            results.push(`Deleted note: ${action.payload}`);
          }
          break;
        }
        case "update_note": {
          const { title, content, priority } = action.payload;
          if (!title) break;
          const updNotes = loadState<any[]>(knowledgeKey(), []);
          const note = updNotes.find((n: any) => n.title === title);
          if (note) {
            if (note.locked) {
              results.push(
                `Cannot update "${title}" — it's locked by the user.`,
              );
              break;
            }
            if (dryRun) {
              results.push(`Would update note: ${title}`);
              break;
            }
            if (content) note.content = content;
            if (priority != null)
              note.priority = Math.min(3, Math.max(0, priority));
            note.updatedAt = new Date().toISOString();
            note.editedBy = "bot";
            saveState(knowledgeKey(), updNotes);
            results.push(`Updated note: ${title}`);
          }
          break;
        }
        case "merge_notes": {
          const {
            titles,
            newTitle,
            newContent,
            priority: mergePriority,
          } = action.payload;
          if (!titles?.length || !newTitle || !newContent) break;
          const mrgNotes = loadState<any[]>(knowledgeKey(), []);
          // Check if any source notes are locked
          const lockedOnes = mrgNotes.filter(
            (n: any) => titles.includes(n.title) && n.locked,
          );
          if (lockedOnes.length > 0) {
            results.push(
              `Cannot merge — "${lockedOnes.map((n: any) => n.title).join('", "')}" locked by user.`,
            );
            break;
          }
          if (dryRun) {
            results.push(
              `Would merge ${titles.length} notes into: ${newTitle}`,
            );
            break;
          }
          // Remove originals
          const remaining = mrgNotes.filter(
            (n: any) => !titles.includes(n.title),
          );
          // Add merged note
          remaining.push({
            id: crypto.randomBytes(8).toString("hex"),
            title: newTitle,
            content: newContent,
            tags: ["from-chat", "merged"],
            priority: Math.min(3, Math.max(0, mergePriority ?? 2)),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            editedBy: "bot",
          });
          saveState(knowledgeKey(), remaining);
          results.push(`Merged ${titles.length} notes into: ${newTitle}`);
          break;
        }
      }
    } catch (err) {
      console.error(`[Chat Tool] Failed to execute ${action.type}:`, err);
    }
  }

  return results;
}

export function getExecutableToolActions(
  actions: ToolAction[],
  options: ExecuteToolActionsOptions = {},
): ToolAction[] {
  return actions.filter((action) => {
    const policy = evaluateToolActionPolicy(action, options.policy);
    if (!policy.allowed) return false;
    const confirmationReason = getHighImpactConfirmationReason(action);
    return confirmationReason === null || options.confirmHighImpact === true;
  });
}

function updateNestedSetting(
  tenantId: string,
  settingPath: string,
  value: unknown,
): void {
  if (!isAllowedUpdateSettingPath(settingPath)) return;

  const configPath = path.join(
    process.cwd(),
    "data",
    "tenants",
    tenantId,
    "pulse.yaml",
  );

  if (!fs.existsSync(configPath)) return;

  const config = YAML.parse(fs.readFileSync(configPath, "utf-8")) || {};
  const parts = settingPath.split(".");
  let obj = config;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!obj[parts[i]] || typeof obj[parts[i]] !== "object") obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
  obj[parts[parts.length - 1]] = value;

  fs.writeFileSync(
    configPath,
    YAML.stringify(config, { lineWidth: 120 }),
    "utf-8",
  );

  // Persist account/connections changes to hosted runtime config.
  const root = parts[0];
  if (root === "account" || root === "connections") {
    try {
      updateHostedBrandRuntimeConfig({
        tenantId,
        legacyAgentId: currentHostedRuntimeAgentId(),
        runtimeConfig: { [root]: config[root] },
      });
    } catch {}
  }
}

function addTopicToConfig(
  tenantId: string,
  topic: { query: string; replies?: string[] },
): void {
  const configPath = path.join(
    process.cwd(),
    "data",
    "tenants",
    tenantId,
    "pulse.yaml",
  );

  if (!fs.existsSync(configPath)) return;

  const config = YAML.parse(fs.readFileSync(configPath, "utf-8")) || {};
  if (!config.topics) config.topics = [];
  const id = `topic-${Date.now()}`;
  config.topics.push({
    id,
    query: topic.query,
    textMustMatch: [],
    replies: topic.replies || [],
  });

  fs.writeFileSync(
    configPath,
    YAML.stringify(config, { lineWidth: 120 }),
    "utf-8",
  );
}

// ─── Page Render (legacy HTML panel) ────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderPage(_params?: URLSearchParams): string {
  return `
<style>
  .chat-container { max-width: 680px; margin: 0 auto; display: flex; flex-direction: column; height: calc(100vh - 140px); }
  .chat-messages { flex: 1; overflow-y: auto; padding: 16px 0; display: flex; flex-direction: column; gap: 12px; }
  .chat-msg { max-width: 85%; padding: 12px 16px; border-radius: 12px; font-size: 0.9rem; line-height: 1.5; word-wrap: break-word; }
  .chat-msg.assistant { background: #161b22; border: 1px solid #30363d; color: #e6edf3; align-self: flex-start; border-bottom-left-radius: 4px; }
  .chat-msg.user { background: #1f6feb; color: #fff; align-self: flex-end; border-bottom-right-radius: 4px; }
  .chat-msg.system { background: #0d1117; border: 1px solid #238636; color: #3fb950; align-self: center; text-align: center; font-size: 0.82rem; }
  .chat-action { background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 8px 12px; margin-top: 6px; font-size: 0.78rem; color: #3fb950; display: flex; align-items: center; gap: 6px; }
  .chat-action::before { content: '✓'; font-weight: bold; }
  .chat-input-row { display: flex; gap: 8px; padding: 16px 0; border-top: 1px solid #21262d; }
  .chat-input { flex: 1; background: #0d1117; color: #e6edf3; border: 1px solid #30363d; border-radius: 8px; padding: 12px 16px; font-size: 0.9rem; font-family: inherit; outline: none; resize: none; min-height: 44px; max-height: 200px; overflow-y: auto; line-height: 1.5; }
  .chat-input:focus { border-color: #58a6ff; }
  .chat-send { background: #238636; color: #fff; border: none; border-radius: 8px; padding: 12px 20px; font-size: 0.9rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
  .chat-send:hover { background: #2ea043; }
  .chat-send:disabled { opacity: 0.5; cursor: not-allowed; }
  .chat-typing { color: #8b949e; font-size: 0.82rem; padding: 4px 0; min-height: 24px; }
  .knowledge-toast { display: flex; align-items: center; gap: 8px; background: #161b22; border: 1px solid #d29922; border-radius: 8px; padding: 10px 14px; margin-top: 8px; font-size: 0.82rem; }
  .knowledge-toast .kt-text { color: #d29922; flex: 1; }
  .knowledge-toast .kt-btn { background: #d29922; color: #0d1117; border: none; border-radius: 4px; padding: 4px 12px; font-size: 0.78rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
  .knowledge-toast .kt-btn:hover { background: #e3a62e; }
  .knowledge-toast .kt-saved { color: #3fb950; font-size: 0.78rem; font-weight: 600; }
</style>

<div class="chat-container">
  <div class="chat-messages" id="chatMessages">
    <div class="chat-msg assistant">Hey! I'm Pulse, your AI marketing assistant. I can set up your agent, adjust any settings, add knowledge, or help with strategy — all through conversation.<br><br>What would you like to do?</div>
  </div>
  <div class="chat-typing" id="chatTyping"></div>
  <div class="chat-input-row">
    <textarea class="chat-input" id="chatInput" placeholder="Type your message..." autocomplete="off" rows="1"
      oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,200)+'px';"
      onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChat();}"></textarea>
    <button class="chat-send" id="chatSend" onclick="sendChat()">Send</button>
  </div>
</div>

<script>
  const messagesEl = document.getElementById('chatMessages');
  const inputEl = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSend');
  const typingEl = document.getElementById('chatTyping');
  let configReady = false;
  let pendingConfig = null;

  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
  function addMessage(role, content) {
    const div = document.createElement('div');
    div.className = 'chat-msg ' + role;
    div.innerHTML = escHtml(content).replace(/\\n/g, '<br>');
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function showAction(text) {
    const div = document.createElement('div');
    div.className = 'chat-action';
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showConfigPreview(config) {
    // Auto-apply config immediately — no JSON review needed
    applyConfig();
  }

  async function sendChat() {
    const msg = inputEl.value.trim();
    if (!msg) return;

    inputEl.value = '';
    sendBtn.disabled = true;
    addMessage('user', msg);
    typingEl.textContent = 'Pulse is thinking...';

    try {
      const res = await fetch('/api/chat-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();

      if (data.reply) addMessage('assistant', data.reply);
      if (data.actionResults && data.actionResults.length > 0) {
        data.actionResults.forEach(function(r) { showAction(r); });
      }
      if (data.knowledge && data.knowledge.title) {
        showKnowledgeSuggestion(data.knowledge);
      }
      if (data.configReady && data.config && Object.keys(data.config).length > 0) {
        configReady = true;
        pendingConfig = data.config;
        showConfigPreview(data.config);
      }
    } catch (err) {
      addMessage('assistant', 'Something went wrong. Try again.');
    }

    typingEl.textContent = '';
    sendBtn.disabled = false;
    inputEl.focus();
  }

  async function applyConfig() {
    if (!pendingConfig) return;
    try {
      const res = await fetch('/api/chat-setup/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: pendingConfig }),
      });
      if (res.ok) {
        showAction('Configuration saved automatically.');
        pendingConfig = null;
        configReady = false;
      } else {
        addMessage('assistant', 'Failed to save config. Try again.');
      }
    } catch {
      addMessage('assistant', 'Network error. Try again.');
    }
  }

  async function resetAndRestart() {
    await fetch('/api/chat-setup/reset', { method: 'POST' });
    messagesEl.innerHTML = '';
    configReady = false;
    pendingConfig = null;
    addMessage('assistant', "Let's start fresh! What would you like to do?");
    inputEl.focus();
  }

  function showKnowledgeSuggestion(k) {
    const id = 'kt-' + Date.now();
    const div = document.createElement('div');
    div.className = 'knowledge-toast';
    div.id = id;
    div.innerHTML = '<span class="kt-text">Save to Knowledge: <strong>' +
      escHtml(k.title) + '</strong></span>' +
      '<button class="kt-btn" onclick="saveKnowledge(\\\'' + id + '\\\',' +
      JSON.stringify(k).replace(/'/g, "\\\\'").replace(/</g, '\\\\x3c') + ')">Save</button>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function saveKnowledge(toastId, k) {
    try {
      const res = await fetch('/api/chat-setup/save-knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(k),
      });
      const el = document.getElementById(toastId);
      if (res.ok && el) {
        el.innerHTML = '<span class="kt-text">Save to Knowledge: <strong>' +
          k.title.replace(/</g, '&lt;') + '</strong></span>' +
          '<span class="kt-saved">Saved</span>';
      }
    } catch {}
  }

  inputEl.focus();
</script>`;
}

export async function handlePost(
  _body: Record<string, string>,
): Promise<{ redirect: string }> {
  return { redirect: "/chat-setup" };
}
