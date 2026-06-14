/**
 * Auto-Research — build deep brand context from minimal input.
 *
 * The customer gives: niche (required) + optionally brand name, website, X handle.
 * Pulse researches the niche, analyzes the community, and builds a complete
 * brand profile + domain knowledge — no manual knowledge notes needed.
 *
 * Runs once during onboarding, refreshes weekly for niche trends.
 *
 * Cost is metered through the configured search/listening and LLM providers.
 */

import { callEndpoint, isClawNetConfigured } from "../core/clawnet-client.js";
import { search } from "../core/search.js";
import { getListeningProvider } from "../core/listening.js";
import { askLLM } from "../core/llm.js";
import {
  loadBrandProfile,
  saveBrandProfile,
  type BrandProfile,
} from "./brand-profile.js";
import {
  loadRuntimeAgentState as loadAgentState,
  saveRuntimeAgentState as saveAgentState,
} from "../core/runtime-agent-state.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ResearchInput {
  /** Required — the only mandatory field */
  niche: string;
  /** Optional — brand name */
  brandName?: string;
  /** Optional — website URL to scrape */
  website?: string;
  /** Optional — X handle to analyze */
  xHandle?: string;
  /** Optional — competitor names or handles */
  competitors?: string[];
}

export interface ResearchResult {
  /** What the niche is talking about right now */
  nicheTopics: string[];
  /** Common pain points in the niche */
  painPoints: string[];
  /** Questions people commonly ask */
  commonQuestions: string[];
  /** How people in this niche talk (tone, slang, formality) */
  communityVoice: {
    tone: string;
    usesHashtags: boolean;
    usesEmoji: "none" | "minimal" | "moderate" | "heavy";
    commonPhrases: string[];
    formalityLevel: "casual" | "mixed" | "professional";
  };
  /** Key players / accounts worth watching */
  keyVoices: string[];
  /** Brand-specific details (if website/handle provided) */
  brandDetails?: {
    description: string;
    features: string[];
    keyNumbers: string[];
    existingVoice?: string;
  };
  /** Credits spent */
  creditsUsed: number;
  /** How long it took */
  durationMs: number;
}

interface DomainChunk {
  topic: string;
  content: string;
  tags: string[];
}

// ─── Niche Research (works with zero brand info) ────────────────────────────

/**
 * Research a niche using whatever is available.
 * Minimum: just the niche name. Each optional input enriches the result.
 */
export async function runAutoResearch(
  input: ResearchInput,
): Promise<ResearchResult> {
  const start = Date.now();
  let creditsUsed = 0;

  const rawData: string[] = [];
  const listening = getListeningProvider();

  // ── 1. Search the niche (always — this is the foundation) ─────────────
  console.log(`[Research] Searching niche: "${input.niche}"...`);

  // Search via Serper (free, always available)
  try {
    const webResults = await search(`${input.niche} site:x.com`, {
      num: 10,
      timeFilter: "qdr:w",
    });
    for (const r of webResults) {
      rawData.push(`[X Post] ${r.title}: ${r.snippet}`);
    }
  } catch {}

  // Search via ClawNet if available (real-time, higher quality)
  if (listening.canSearchXRealtime()) {
    try {
      const rtResults = await listening.searchXRealtimeWithUsage(input.niche, {
        limit: 20,
      });
      creditsUsed += rtResults.creditsUsed;
      for (const result of rtResults.results) {
        rawData.push(`[X Real-time] ${result.title}: ${result.snippet}`);
      }
    } catch {}

    // Search for pain points and questions specifically
    try {
      const painResults = await listening.searchXRealtimeWithUsage(
        `${input.niche} struggling OR frustrated OR "how do" OR "anyone know"`,
        { limit: 10 },
      );
      creditsUsed += painResults.creditsUsed;
      for (const result of painResults.results) {
        rawData.push(`[Pain/Question] ${result.title}: ${result.snippet}`);
      }
    } catch {}
  }

  // General web search for niche context
  try {
    const newsResults = await search(`${input.niche} trends 2026`, { num: 5 });
    for (const r of newsResults) {
      rawData.push(`[Web] ${r.title}: ${r.snippet}`);
    }
  } catch {}

  // ── 2. Website scrape (if provided) ───────────────────────────────────
  if (input.website && isClawNetConfigured()) {
    console.log(`[Research] Scraping website: ${input.website}...`);
    try {
      const scrape = await callEndpoint<{
        title?: string;
        content?: string;
        description?: string;
      }>("claw-web-scrape", { url: input.website });
      creditsUsed += scrape.creditsUsed;
      const site = scrape.data;
      if (site.content) {
        rawData.push(
          `[Website] ${site.title || ""}: ${site.content.slice(0, 2000)}`,
        );
      }
      if (site.description) {
        rawData.push(`[Website Meta] ${site.description}`);
      }
    } catch {}
  }

  // ── 3. X profile analysis (if provided) ───────────────────────────────
  if (input.xHandle && listening.canGetXUserProfile()) {
    console.log(`[Research] Analyzing X profile: @${input.xHandle}...`);
    try {
      const profile = await listening.getXUserProfile(input.xHandle);
      if (profile) {
        creditsUsed += profile.creditsUsed;
        rawData.push(
          `[Own Profile] @${input.xHandle}: ${profile.profile.bio || ""} (${profile.profile.followers} followers)`,
        );
      }
    } catch {}

    // Get their recent posts for voice analysis
    try {
      const timeline = await callEndpoint<{
        tweets?: Array<{ text: string; likes?: number }>;
      }>("twitsh-user-timeline", { userId: input.xHandle, count: 30 });
      creditsUsed += timeline.creditsUsed;
      const tweets = timeline.data.tweets ?? [];
      for (const t of tweets.slice(0, 20)) {
        rawData.push(
          `[Own Post${t.likes && t.likes > 5 ? ` (${t.likes} likes)` : ""}] ${t.text}`,
        );
      }
    } catch {}
  }

  // ── 4. Competitor research (if provided) ──────────────────────────────
  if (
    input.competitors &&
    input.competitors.length > 0 &&
    listening.canSearchXRealtime()
  ) {
    for (const comp of input.competitors.slice(0, 3)) {
      console.log(`[Research] Researching competitor: ${comp}...`);
      try {
        const compSearch = await listening.searchXRealtimeWithUsage(
          `from:${comp.replace("@", "")}`,
          { limit: 10 },
        );
        creditsUsed += compSearch.creditsUsed;
        for (const result of compSearch.results.slice(0, 5)) {
          rawData.push(`[Competitor @${comp}] ${result.snippet}`);
        }
      } catch {}
    }
  }

  // ── 5. LLM Synthesis ──────────────────────────────────────────────────
  console.log(`[Research] Synthesizing ${rawData.length} data points...`);

  const synthesisPrompt = `You are analyzing a niche to build a social media brand profile.

NICHE: ${input.niche}
${input.brandName ? `BRAND NAME: ${input.brandName}` : ""}
${input.website ? `WEBSITE: ${input.website}` : ""}
${input.xHandle ? `X HANDLE: @${input.xHandle}` : ""}

Here is raw data collected from the niche (X posts, web pages, profiles):

${rawData.slice(0, 50).join("\n\n")}

Analyze this data and return a JSON object with exactly this structure:
{
  "nicheTopics": ["top 5-8 topics people are actively discussing"],
  "painPoints": ["top 3-5 pain points or frustrations people express"],
  "commonQuestions": ["top 3-5 questions people ask"],
  "communityVoice": {
    "tone": "1-2 sentence description of how people in this niche talk",
    "usesHashtags": true/false,
    "usesEmoji": "none" | "minimal" | "moderate" | "heavy",
    "commonPhrases": ["3-5 common phrases or slang used in this niche"],
    "formalityLevel": "casual" | "mixed" | "professional"
  },
  "keyVoices": ["@handles of 3-5 influential accounts in this niche"]${
    input.website || input.xHandle
      ? `,
  "brandDetails": {
    "description": "1-2 sentence description of what this brand does",
    "features": ["key features or offerings"],
    "keyNumbers": ["important numbers mentioned (users, endpoints, pricing, etc.) — exact, never inflated"],
    "existingVoice": "description of how this brand currently sounds on X (if timeline data available)"
  }`
      : ""
  }
}

Return ONLY valid JSON, no markdown formatting.`;

  const synthesisResult = await askLLM(synthesisPrompt, {
    maxTokens: 1500,
    temperature: 0.3,
  });

  // Parse the synthesis
  let result: ResearchResult = {
    nicheTopics: [],
    painPoints: [],
    commonQuestions: [],
    communityVoice: {
      tone: "professional",
      usesHashtags: false,
      usesEmoji: "none",
      commonPhrases: [],
      formalityLevel: "mixed",
    },
    keyVoices: [],
    creditsUsed,
    durationMs: Date.now() - start,
  };

  if (synthesisResult) {
    try {
      // Strip markdown code fences if present
      const cleaned = synthesisResult
        .replace(/^```json?\s*/m, "")
        .replace(/\s*```$/m, "")
        .trim();
      const parsed = JSON.parse(cleaned);
      result = { ...result, ...parsed };
    } catch {
      console.error(
        "[Research] Failed to parse LLM synthesis — using defaults",
      );
    }
  }

  return result;
}

// ─── Apply Research to Brand Profile ────────────────────────────────────────

/**
 * Take research results and update the brand profile + create domain knowledge.
 *
 * Pass `agentId` to pin writes to a specific agent — required when called
 * from async callbacks where the global active agent may have changed.
 */
export async function applyResearchToProfile(
  input: ResearchInput,
  research: ResearchResult,
  agentId?: string,
): Promise<void> {
  const profile = loadBrandProfile(agentId);

  // Identity
  if (input.brandName) profile.identity.name = input.brandName;
  if (research.brandDetails?.description)
    profile.identity.description = research.brandDetails.description;
  if (research.brandDetails?.keyNumbers) {
    for (const num of research.brandDetails.keyNumbers) {
      // Add to key facts (semantic dedup handled by updateKeyFact)
      const existing = profile.identity.keyFacts;
      if (!existing.some((f) => f.toLowerCase() === num.toLowerCase())) {
        existing.push(num);
      }
    }
  }

  // Voice — adapt to niche community
  profile.voice.toneNotes = research.communityVoice.tone;
  if (research.communityVoice.commonPhrases.length > 0) {
    // Merge with existing signatures, don't overwrite
    const newPhrases = research.communityVoice.commonPhrases.filter(
      (p) => !profile.voice.signatures.includes(p),
    );
    profile.voice.signatures = [
      ...profile.voice.signatures,
      ...newPhrases,
    ].slice(0, 10);
  }
  if (research.brandDetails?.existingVoice) {
    profile.voice.toneNotes = research.brandDetails.existingVoice;
  }

  // Style rules — set from niche community analysis
  profile.styleRules.useHashtags = research.communityVoice.usesHashtags;
  profile.styleRules.emojiUsage = research.communityVoice.usesEmoji;
  // Casual niches tend to use story openers; professional niches don't
  profile.styleRules.useStoryOpeners =
    research.communityVoice.formalityLevel === "casual";

  saveBrandProfile(profile, agentId);

  // Save domain knowledge chunks (topic-tagged for context matching)
  const chunks: DomainChunk[] = [];

  if (research.nicheTopics.length > 0) {
    chunks.push({
      topic: "niche-trends",
      content: `Current topics in ${input.niche}: ${research.nicheTopics.join(", ")}`,
      tags: [input.niche, "trends"],
    });
  }

  if (research.painPoints.length > 0) {
    chunks.push({
      topic: "pain-points",
      content: `Common frustrations: ${research.painPoints.join(". ")}`,
      tags: [input.niche, "pain-points"],
    });
  }

  if (research.commonQuestions.length > 0) {
    chunks.push({
      topic: "common-questions",
      content: `Questions people ask: ${research.commonQuestions.join(". ")}`,
      tags: [input.niche, "questions"],
    });
  }

  if (research.keyVoices.length > 0) {
    chunks.push({
      topic: "key-voices",
      content: `Influential accounts in ${input.niche}: ${research.keyVoices.join(", ")}`,
      tags: [input.niche, "influencers"],
    });
  }

  // Save domain chunks
  saveAgentState(
    "domain-knowledge",
    { chunks, researchedAt: new Date().toISOString(), niche: input.niche },
    agentId,
  );

  // ── Auto-populate content themes from research (stored in brand profile) ──
  // Converts niche topics + pain points + questions into content themes.
  // Stored per-agent in the brand profile, not in shared pulse.yaml.
  if (profile.contentThemes.length <= 1) {
    const generatedThemes: string[] = [];

    for (const topic of research.nicheTopics.slice(0, 5)) {
      generatedThemes.push(topic);
    }
    for (const pain of research.painPoints.slice(0, 3)) {
      generatedThemes.push(`the problem with ${pain.toLowerCase()}`);
    }
    for (const q of research.commonQuestions.slice(0, 3)) {
      generatedThemes.push(q);
    }

    if (generatedThemes.length > 0) {
      profile.contentThemes = generatedThemes;
      saveBrandProfile(profile, agentId);
      console.log(
        `[Research] Seeded ${generatedThemes.length} content themes into brand profile`,
      );

      // Also save as angles in Content DNA for adaptive content generation
      try {
        const { setAngles } = await import("./content-dna.js");
        setAngles(generatedThemes, agentId);
      } catch {}
    }
  }

  console.log(
    `[Research] Applied to profile: ${chunks.length} domain chunks, style rules updated from niche analysis`,
  );
}

// ─── Niche Refresh (periodic, lighter than full research) ───────────────────

/**
 * Refresh niche trends without re-researching everything.
 * Designed to run weekly to keep domain knowledge current.
 * Cost: ~5 credits.
 */
export async function refreshNicheTrends(niche: string): Promise<void> {
  console.log(`[Research] Refreshing niche trends for: ${niche}`);

  const rawPosts: string[] = [];

  // Quick search for what's trending this week
  const listening = getListeningProvider();
  if (listening.canSearchXRealtime()) {
    try {
      const results = await listening.searchXRealtime(niche, { limit: 20 });
      for (const result of results) {
        rawPosts.push(`${result.title}: ${result.snippet}`);
      }
    } catch {}
  }

  try {
    const webResults = await search(`${niche} site:x.com`, {
      num: 10,
      timeFilter: "qdr:w",
    });
    for (const r of webResults) {
      rawPosts.push(`${r.title}: ${r.snippet}`);
    }
  } catch {}

  if (rawPosts.length < 3) {
    console.log("[Research] Not enough data for trend refresh");
    return;
  }

  const trendPrompt = `Analyze these recent posts from the "${niche}" niche and extract:
1. Top 5 topics being discussed this week
2. Any new pain points or questions
3. Any shift in community tone or language

Posts:
${rawPosts.slice(0, 30).join("\n")}

Return JSON: { "topics": [...], "painPoints": [...], "questions": [...], "toneShift": "string or null" }
Return ONLY valid JSON.`;

  const result = await askLLM(trendPrompt, {
    maxTokens: 500,
    temperature: 0.3,
  });
  if (!result) return;

  try {
    const cleaned = result
      .replace(/^```json?\s*/m, "")
      .replace(/\s*```$/m, "")
      .trim();
    const parsed = JSON.parse(cleaned);

    // Update domain knowledge with fresh trends
    const existing = loadAgentState<{ chunks: DomainChunk[] }>(
      "domain-knowledge",
      { chunks: [] },
    );

    // Replace the niche-trends chunk with fresh data
    existing.chunks = existing.chunks.filter(
      (c) => c.topic !== "niche-trends-weekly",
    );
    existing.chunks.push({
      topic: "niche-trends-weekly",
      content: `This week in ${niche}: ${(parsed.topics ?? []).join(", ")}`,
      tags: [niche, "trends", "weekly"],
    });

    if (parsed.painPoints?.length > 0) {
      existing.chunks = existing.chunks.filter(
        (c) => c.topic !== "pain-points-weekly",
      );
      existing.chunks.push({
        topic: "pain-points-weekly",
        content: `Fresh pain points: ${parsed.painPoints.join(". ")}`,
        tags: [niche, "pain-points", "weekly"],
      });
    }

    saveAgentState("domain-knowledge", {
      ...existing,
      refreshedAt: new Date().toISOString(),
    });
    console.log(
      `[Research] Niche trends refreshed: ${parsed.topics?.length ?? 0} topics`,
    );
  } catch {
    console.error("[Research] Failed to parse trend refresh");
  }
}

/**
 * Check if research has been done. Returns false if brand profile is still default.
 */
export function hasBeenResearched(): boolean {
  const domain = loadAgentState<{ chunks?: DomainChunk[] }>(
    "domain-knowledge",
    {},
  );
  return (domain.chunks?.length ?? 0) > 0;
}
