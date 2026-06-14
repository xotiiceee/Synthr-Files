/**
 * Brand voice / persona engine.
 * Loads persona + topics + platform config from pulse.yaml.
 * Everything is niche-agnostic — configured by the setup wizard.
 */

import fs from "fs";
import path from "path";
import YAML from "yaml";

function getContextConfigPathProvider():
  | (() => string | undefined)
  | undefined {
  return (
    globalThis as typeof globalThis & {
      __pulseGetContextConfigPath?: () => string | undefined;
    }
  ).__pulseGetContextConfigPath;
}

// ─── Config Types ────────────────────────────────────────────────────────────

export interface SearchTopic {
  id: string;
  query: string;
  textMustMatch: string[];
  replies: string[];
  platform?: string; // Default: all enabled platforms
}

export interface PersonaConfig {
  name: string;
  brandName: string;
  website: string;
  tagline: string;
  niche: string;
  idealCustomer: string;
  problemSolved: string;
  uniqueValue: string;
  tone:
    | "professional"
    | "casual"
    | "witty"
    | "technical"
    | "friendly"
    | "authoritative";
  neverSay: string[];
  xHandle?: string; // X/Twitter handle (e.g., @yourbrand) — used for mention detection
}

export interface PlatformSettings {
  enabled: boolean;
  maxPerDay: number;
  maxPerRun: number;
  subreddits?: string[];
  discordServers?: string[];
  hnCategories?: string[];
}

export interface AutopostCategoryConfig {
  enabled?: boolean;
  weight?: number;
  minRelevanceScore?: number;
  rotate?: boolean;
  depth?: "shallow" | "medium" | "deep";
  types?: Record<string, boolean>;
  maxSpiceLevel?: number;
  commentaryRequired?: boolean;
}

export interface ActivityLimits {
  profilePostsPerDay: number; // Original content posts
  repliesPerDay: number; // Replies to others' posts
  repostsPerDay: number; // Retweets/reposts
  likesPerDay: number; // Likes
  quoteTweetsPerDay: number; // Quote tweets
}

export interface AutopilotConfig {
  enabled: boolean;
  calibrationComplete: boolean;
  calibrationDecisions: number; // how many approve/reject decisions made (graduates at 10)
  confidenceThreshold: number; // 0-100, default 75, hidden from users
  activeHours: { start: string; end: string }; // e.g. { start: '09:00', end: '22:00' }
  dailyDigest: {
    enabled: boolean;
    emailAddress?: string;
    sendTimeLocal: string; // e.g. '09:00'
  };
}

export interface AutopostConfig {
  enabled?: boolean;
  approvalMode?: "review_all" | "review_risky" | "auto_all";
  limits?: ActivityLimits;
  categories?: Record<string, AutopostCategoryConfig>;
  safety?: {
    bannedTopics?: string[];
    bannedWords?: string[];
    maxThreadLength?: number;
    requireFactCheck?: boolean;
    duplicateDetectionDays?: number;
    coolDownOnNegative?: {
      enabled?: boolean;
      thresholdRatio?: number;
      pauseHours?: number;
    };
  };
  learning?: {
    trackEngagement?: boolean;
    adaptWeights?: boolean;
    adaptTiming?: boolean;
    weeklyReport?: boolean;
  };
}

export interface HumanBehaviorConfig {
  voice?: {
    catchphrases?: string[];
    emojiFrequency?: "none" | "rare" | "moderate" | "heavy";
    favoriteEmojis?: string[];
    capStyle?: "normal" | "mostly-lowercase" | "mixed-emphasis";
    punctuationQuirks?: string[];
    strongOpinions?: string[];
    humorStyle?:
      | "dry"
      | "self-deprecating"
      | "none"
      | "observational"
      | "absurdist";
    sentenceStyle?: "short-punchy" | "flowing-complex" | "mixed";
    casualtyLevel?: number;
  };
  timing?: {
    timezone?: string;
    activeWindows?: Array<{ start: string; end: string }>;
    basePostsPerDay?: number;
    silentDayChance?: number;
    burstChance?: number;
  };
  antiDetection?: {
    enabled?: boolean;
    maxConsecutiveSameFormat?: number;
    minPostGapMinutes?: number;
    maxPostGapMinutes?: number;
    dropTrailingPeriod?: number;
    casualContractions?: number;
  };
  engagement?: {
    enabled?: boolean;
    replyToQuestionsAlways?: boolean;
    replyToSubstantive?: number;
    likeRate?: number;
    maxRepliesPerPost?: number;
    monitorHours?: number;
  };
  mentions?: {
    enabled?: boolean;
    checkInterval?: number;
    replyToQuestions?: boolean;
    replyToPositive?: number;
    replyToNeutral?: number;
    replyToNegative?: boolean;
  };
}

export interface EngagementConfig {
  /** Your personal X handle — when you mention the bot, it joins the conversation */
  mainAccount?: string;
  /** Reply strategy: direct (default), engage-first, or quote-fallback */
  strategy?: "direct" | "engage-first" | "quote-fallback";
  /** Hours to wait before retrying reply after engage-first (default 24) */
  retryAfterHours?: number;
}

export interface AutoFollowConfig {
  enabled?: boolean;
  dailyCap?: number;
  minConfidence?: number;
  minFollowerCount?: number;
  autoUnfollowDays?: number;
  signals?: {
    repost?: boolean;
    reply?: boolean;
    tag?: boolean;
    mention_positive?: boolean;
  };
  kols?: string[];
}

export interface PulseConfig {
  persona: PersonaConfig;
  platforms: Record<string, PlatformSettings>;
  topics: SearchTopic[];
  contentThemes: string[];
  competitors: string[];
  schedule: {
    outreachIntervalHours: number;
    contentPostsPerDay: number;
    adaptationIntervalDays: number;
  };
  aggressiveness: "conservative" | "moderate" | "active";
  autopost?: AutopostConfig;
  humanBehavior?: HumanBehaviorConfig;
  autopilot?: AutopilotConfig;
  engagement?: EngagementConfig;
  autoFollow?: AutoFollowConfig;
  imageMode?: "auto" | "library" | "off";
}

// ─── Config Loading ──────────────────────────────────────────────────────────

const cachedConfigs = new Map<string, PulseConfig>();
let configPathOverride: string | null = null;

/** Override the config file path (used by hosted multi-tenant layer) */
export function setConfigPath(p: string): void {
  configPathOverride = p;
  cachedConfigs.delete(p); // Clear cache so next getConfig() loads from new path
}

/** Get the active config file path */
export function getConfigPath(): string {
  return (
    getContextConfigPathProvider()?.() ||
    configPathOverride ||
    path.join(process.cwd(), "pulse.yaml")
  );
}

const DEFAULT_CONFIG: PulseConfig = {
  persona: {
    name: "Pulse",
    brandName: "My Brand",
    website: "",
    tagline: "",
    niche: "general",
    idealCustomer: "",
    problemSolved: "",
    uniqueValue: "",
    tone: "casual",
    neverSay: [],
  },
  platforms: {
    x: { enabled: true, maxPerDay: 8, maxPerRun: 3 },
    reddit: { enabled: false, maxPerDay: 5, maxPerRun: 2 },
    hackernews: { enabled: false, maxPerDay: 3, maxPerRun: 1 },
    producthunt: { enabled: false, maxPerDay: 3, maxPerRun: 1 },
    linkedin: { enabled: false, maxPerDay: 3, maxPerRun: 2 },
    discord: { enabled: false, maxPerDay: 5, maxPerRun: 2 },
  },
  topics: [],
  contentThemes: [],
  competitors: [],
  schedule: {
    outreachIntervalHours: 3,
    contentPostsPerDay: 2,
    adaptationIntervalDays: 7,
  },
  aggressiveness: "moderate",
  autopilot: {
    enabled: false,
    calibrationComplete: false,
    calibrationDecisions: 0,
    confidenceThreshold: 75,
    activeHours: { start: "09:00", end: "22:00" },
    dailyDigest: {
      enabled: true,
      sendTimeLocal: "09:00",
    },
  },
};

/**
 * Load pulse.yaml from project root. Falls back to defaults.
 */
export function loadConfig(): PulseConfig {
  const configPath = getConfigPath();
  const cachedConfig = cachedConfigs.get(configPath);
  if (cachedConfig) return cachedConfig;

  if (!fs.existsSync(configPath)) {
    console.warn("No pulse.yaml found — run `npm run setup` first.");
    console.warn("Using default config.\n");
    cachedConfigs.set(configPath, DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = YAML.parse(raw) as Partial<PulseConfig>;

    // Deep merge — preserve defaults for nested objects the user didn't set
    const config = {
      ...DEFAULT_CONFIG,
      ...parsed,
      persona: { ...DEFAULT_CONFIG.persona, ...(parsed.persona ?? {}) },
      platforms: Object.fromEntries(
        Object.entries(DEFAULT_CONFIG.platforms).map(([name, defaults]) => [
          name,
          { ...defaults, ...(parsed.platforms?.[name] ?? {}) },
        ]),
      ),
      schedule: { ...DEFAULT_CONFIG.schedule, ...(parsed.schedule ?? {}) },
      autopost: parsed.autopost
        ? {
            ...parsed.autopost,
            limits: {
              profilePostsPerDay: 3,
              repliesPerDay: 10,
              repostsPerDay: 5,
              likesPerDay: 20,
              quoteTweetsPerDay: 2,
              ...(parsed.autopost.limits ?? {}),
            },
            safety: parsed.autopost.safety
              ? { ...parsed.autopost.safety }
              : undefined,
            learning: parsed.autopost.learning
              ? { ...parsed.autopost.learning }
              : undefined,
          }
        : undefined,
      humanBehavior: parsed.humanBehavior ?? undefined,
      autopilot: {
        ...DEFAULT_CONFIG.autopilot!,
        ...(parsed.autopilot ?? {}),
        activeHours: {
          ...DEFAULT_CONFIG.autopilot!.activeHours,
          ...(parsed.autopilot?.activeHours ?? {}),
        },
        dailyDigest: {
          ...DEFAULT_CONFIG.autopilot!.dailyDigest,
          ...(parsed.autopilot?.dailyDigest ?? {}),
        },
      },
    };

    // Validation warnings
    if (
      !process.env.GROQ_API_KEY &&
      !process.env.OPENAI_API_KEY &&
      !process.env.ANTHROPIC_API_KEY &&
      !process.env.OPENROUTER_API_KEY
    ) {
      console.warn("  Warning: No LLM API key set. Run npm run setup.");
    }
    if (
      !process.env.SERPER_API_KEY &&
      !process.env.SERPAPI_API_KEY &&
      !process.env.BRAVE_API_KEY
    ) {
      console.warn(
        "  Warning: No search API key set. Outreach will be limited.",
      );
    }
    if (config.topics.length === 0) {
      console.warn(
        "  Warning: No search topics configured. Run npm run setup.",
      );
    }
    if (!config.persona.name || !config.persona.brandName) {
      console.warn(
        "  Warning: persona.name and persona.brandName are required. Run npm run setup.",
      );
    }
    const hasEnabledPlatform = Object.values(config.platforms).some(
      (p) => p?.enabled,
    );
    if (!hasEnabledPlatform) {
      console.warn(
        "  Warning: No platforms enabled. Enable at least one in pulse.yaml.",
      );
    }

    cachedConfigs.set(configPath, config);
    return config;
  } catch (err) {
    console.error(
      `Failed to parse pulse.yaml: ${err instanceof Error ? err.message : String(err)}`,
    );
    cachedConfigs.set(configPath, DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
}

/**
 * Save config to pulse.yaml.
 */
export function saveConfig(config: PulseConfig): void {
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, YAML.stringify(config, { lineWidth: 120 }));
  cachedConfigs.set(configPath, config);
}

/**
 * Get the loaded config (loads if needed).
 */
export function getConfig(): PulseConfig {
  return loadConfig();
}

/**
 * Reset cached config (useful after wizard generates a new one).
 */
export function resetConfigCache(): void {
  cachedConfigs.clear();
}

/**
 * Get enabled platform names.
 */
export function getEnabledPlatforms(): string[] {
  const config = getConfig();
  return Object.entries(config.platforms)
    .filter(([, settings]) => settings.enabled)
    .map(([name]) => name);
}

/**
 * Build a persona description for LLM prompts.
 */
export function getPersonaPrompt(): string {
  const config = getConfig();
  const p = config.persona;
  const agentRole = (config as any).agentRole as string | undefined;

  // If agent role is defined (rich persona description), use it as primary identity
  if (agentRole && agentRole.length > 20) {
    const parts = [agentRole];
    if (p.website) parts.push(`Website: ${p.website}`);
    if (p.neverSay.length > 0)
      parts.push(`Never say: ${p.neverSay.join(", ")}`);
    return parts.join("\n");
  }

  // Fallback to structured persona fields
  const parts = [`You are ${p.name} — a ${p.tone} voice for ${p.brandName}.`];
  if (p.tagline) parts.push(p.tagline);
  if (p.problemSolved) parts.push(`You solve: ${p.problemSolved}`);
  if (p.uniqueValue) parts.push(`What makes you different: ${p.uniqueValue}`);
  if (p.website) parts.push(`Website: ${p.website}`);
  if (p.neverSay.length > 0) parts.push(`Never say: ${p.neverSay.join(", ")}`);
  return parts.join(" ");
}
