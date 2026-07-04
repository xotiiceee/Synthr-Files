/**
 * Thread Analyzer — the core intelligence upgrade.
 *
 * Takes a discovered opportunity (a trending post) and:
 * 1. Fetches the reply thread via ClawNet (twitsh-tweet-replies)
 * 2. Scores each reply author (bot detection, KOL identification)
 * 3. Classifies reply types (question, opinion, pain point, etc.)
 * 4. Selects 1–3 best comments to reply to
 *
 * The output replaces "reply to OP" with "reply to the best comment in the thread."
 */

import {
  getTweetReplies,
  isClawNetConfigured,
  type TweetReply,
  type BirthCertificate,
} from "../core/clawnet-client.js";
import { getListeningProvider } from "../core/listening.js";
import {
  scoreAccount,
  isLikelyBot,
  type AccountScore,
  type AuthorSignals,
} from "./account-scorer.js";
import { askLLMWithSystem } from "../core/llm.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ReplyType =
  | "question" // "how do you...", "what's the best..."
  | "opinion" // "I think...", "unpopular opinion..."
  | "pain_point" // "struggling with...", "frustrated by..."
  | "insight" // substantive take that adds value
  | "praise" // "great thread!", "this is fire"
  | "promotional" // links, self-promotion
  | "low_effort" // emoji-only, one word, "this"
  | "debate"; // disagreement, counterpoint

export interface ScoredReply {
  /** Tweet ID of this reply */
  tweetId: string;
  /** Reply author handle */
  author: string;
  /** Reply text content */
  text: string;
  /** What type of reply is this */
  replyType: ReplyType;
  /** Account quality score (0–100) */
  accountScore: AccountScore;
  /** How much value can we add by replying here (0–100) */
  valueOpportunity: number;
  /** Combined score for ranking (0–100) */
  overallScore: number;
  /** Why we'd reply to this specific comment */
  reason: string;
}

export interface ThreadAnalysis {
  /** Original post tweet ID */
  rootTweetId: string;
  /** Original post author */
  rootAuthor: string;
  /** Original post text */
  rootText: string;
  /** Total replies found */
  replyCount: number;
  /** Scored and ranked reply targets */
  targets: ScoredReply[];
  /** Soma provenance from the thread fetch */
  provenance: BirthCertificate | null;
  /** How long the analysis took */
  durationMs: number;
}

// ─── Reply Type Classification ──────────────────────────────────────────────

const QUESTION_PATTERNS = [
  /\bhow\s+(do|does|can|should|would|to)\b/i,
  /\bwhat('s|\s+is|\s+are|\s+was)\b/i,
  /\bwhy\s+(do|does|is|are|would|did)\b/i,
  /\banyone\s+(tried|know|using|recommend)/i,
  /\bwhat.*\bthink\b/i,
  /\bis\s+(there|it|this)\b.*\?/i,
  /\bwhich\s+(one|is)\b/i,
  /\?$/,
];

const PAIN_PATTERNS = [
  /\bstruggling\s+with\b/i,
  /\bfrustrated\b/i,
  /\bcan't\s+(figure|get|make|find)\b/i,
  /\bkeep\s+(getting|running\s+into)\b/i,
  /\bdriving\s+me\s+(crazy|nuts)\b/i,
  /\bwish\s+(there|it|they)\b/i,
  /\bpain\s+point\b/i,
  /\btired\s+of\b/i,
  /\bbroken\b/i,
  /\bbug(s|gy)?\b/i,
];

const PROMOTIONAL_PATTERNS = [
  /\bcheck\s+out\b/i,
  /\bfollow\s+me\b/i,
  /\blink\s+in\s+bio\b/i,
  /https?:\/\//,
  /\bdm\s+me\b/i,
  /\buse\s+code\b/i,
  /\bsign\s+up\b/i,
];

const LOW_EFFORT_PATTERNS = [
  /^(this|same|mood|facts?|real|fr|lol|lmao|true|based|W|L|🔥|💯|👀|😂|❤️|🙏|💀)+\.?$/i,
  /^.{1,10}$/, // very short replies
  /^(great|nice|good|awesome|amazing|perfect|excellent)\s*(thread|post|take)?[.!]*$/i,
];

function classifyReplyType(text: string): ReplyType {
  const trimmed = text.trim();

  // Check low-effort first (most restrictive)
  for (const p of LOW_EFFORT_PATTERNS) {
    if (p.test(trimmed)) return "low_effort";
  }

  // Promotional
  for (const p of PROMOTIONAL_PATTERNS) {
    if (p.test(trimmed)) return "promotional";
  }

  // Questions
  for (const p of QUESTION_PATTERNS) {
    if (p.test(trimmed)) return "question";
  }

  // Pain points
  for (const p of PAIN_PATTERNS) {
    if (p.test(trimmed)) return "pain_point";
  }

  // Debate signals
  if (
    /\b(disagree|actually|but\s+actually|counterpoint|not\s+really|well\s+actually)/i.test(
      trimmed,
    )
  ) {
    return "debate";
  }

  // Praise (that wasn't caught by low_effort)
  if (
    /\b(love\s+this|great\s+point|so\s+true|nailed\s+it|well\s+said|spot\s+on)/i.test(
      trimmed,
    )
  ) {
    return "praise";
  }

  // Substantial enough to be an opinion or insight
  const words = trimmed.split(/\s+/).length;
  if (words >= 15) return "insight";
  if (words >= 8) return "opinion";

  return "low_effort";
}

// ─── Value Opportunity Scoring ──────────────────────────────────────────────

function scoreValueOpportunity(
  reply: TweetReply,
  replyType: ReplyType,
  accountScore: AccountScore,
): number {
  let score = 0;

  // Reply type weights — questions are gold, pain points are silver
  const typeWeights: Record<ReplyType, number> = {
    question: 40,
    pain_point: 35,
    opinion: 25,
    insight: 20,
    debate: 15,
    praise: 5,
    promotional: 0,
    low_effort: 0,
  };
  score += typeWeights[replyType];

  // Account quality bonus — replying to KOLs is more valuable
  if (accountScore.isKol) score += 30;
  else if (accountScore.quality >= 60) score += 15;
  else if (accountScore.quality >= 40) score += 5;

  // Engagement on the reply itself — more visible comments = more value
  const likes = reply.likes ?? 0;
  if (likes >= 50) score += 15;
  else if (likes >= 10) score += 10;
  else if (likes >= 3) score += 5;

  // Text length — meatier comments offer more to work with
  const words = reply.text.split(/\s+/).length;
  if (words >= 20) score += 10;
  else if (words >= 10) score += 5;

  return Math.min(100, score);
}

// ─── Thread Analysis Pipeline ───────────────────────────────────────────────

/**
 * Analyze a tweet's reply thread and identify the best comments to engage with.
 *
 * @param tweetId - The root tweet ID to analyze
 * @param rootAuthor - Handle of the original poster
 * @param rootText - Text of the original post
 * @param maxTargets - Maximum number of reply targets to return (default 3)
 * @param ownHandle - Our X handle (to avoid replying to ourselves)
 */
export async function analyzeThread(
  tweetId: string,
  rootAuthor: string,
  rootText: string,
  maxTargets: number = 3,
  ownHandle?: string,
): Promise<ThreadAnalysis> {
  const start = Date.now();

  if (!isClawNetConfigured()) {
    return {
      rootTweetId: tweetId,
      rootAuthor,
      rootText,
      replyCount: 0,
      targets: [],
      provenance: null,
      durationMs: Date.now() - start,
    };
  }

  // ── Fetch thread replies via ClawNet ────────────────────────────────────
  let replies: TweetReply[] = [];
  let provenance: BirthCertificate | null = null;

  try {
    const result = await getTweetReplies(tweetId);
    replies = result.data.replies ?? [];
    provenance = result.provenance;
  } catch (err) {
    console.error(
      `  [ThreadAnalyzer] Failed to fetch replies for ${tweetId}: ${err instanceof Error ? err.message : err}`,
    );
    return {
      rootTweetId: tweetId,
      rootAuthor,
      rootText,
      replyCount: 0,
      targets: [],
      provenance: null,
      durationMs: Date.now() - start,
    };
  }

  if (replies.length === 0) {
    return {
      rootTweetId: tweetId,
      rootAuthor,
      rootText,
      replyCount: 0,
      targets: [],
      provenance,
      durationMs: Date.now() - start,
    };
  }

  // ── Filter obvious junk ────────────────────────────────────────────────
  const ownHandleClean = ownHandle?.replace("@", "").toLowerCase();
  const filtered = replies.filter((r) => {
    // Skip our own replies
    if (ownHandleClean && r.author.toLowerCase() === ownHandleClean)
      return false;
    // Skip OP's own replies (we might engage with these later, but not the primary target)
    if (r.author.toLowerCase() === rootAuthor.replace("@", "").toLowerCase())
      return false;
    // Skip obvious bots by username
    if (isLikelyBot(r.author)) return false;
    // Skip empty
    if (!r.text || r.text.trim().length < 3) return false;
    return true;
  });

  // ── Score each reply ──────────────────────────────────────────────────
  const scored: ScoredReply[] = [];

  // Batch profile lookups for top candidates (limit API calls)
  // First do a cheap pass with username-only scoring, then enrich top candidates
  const cheapScored = filtered.map((reply) => {
    const replyType = classifyReplyType(reply.text);
    const cheapAccountScore = scoreAccount({ username: reply.author });
    const valueOpp = scoreValueOpportunity(reply, replyType, cheapAccountScore);
    return { reply, replyType, cheapAccountScore, valueOpp };
  });

  // Sort by value opportunity, take top candidates for profile enrichment
  cheapScored.sort((a, b) => b.valueOpp - a.valueOpp);
  const topCandidates = cheapScored.slice(0, Math.min(maxTargets * 3, 10));

  // Enrich top candidates with real profile data (parallel, limited)
  const listening = getListeningProvider();
  const enriched = await Promise.allSettled(
    topCandidates.map(async (candidate) => {
      let accountScore = candidate.cheapAccountScore;

      try {
        const profile = await listening.getXUserProfile(candidate.reply.author);
        if (!profile) throw new Error("X profile provider unavailable");
        accountScore = scoreAccount({
          username: candidate.reply.author,
          displayName: profile.profile.displayName,
          followers: profile.profile.followers,
          following: profile.profile.following,
          verified: profile.profile.verified,
          bio: profile.profile.bio,
          engagementRate: profile.profile.engagementRate,
        });
      } catch {
        // Profile lookup failed — use username-only score
      }

      const valueOpportunity = scoreValueOpportunity(
        candidate.reply,
        candidate.replyType,
        accountScore,
      );

      // Overall score: 50% value opportunity, 30% account quality, 20% reply type bonus
      const typeBonuses: Record<ReplyType, number> = {
        question: 100,
        pain_point: 85,
        opinion: 60,
        insight: 70,
        debate: 40,
        praise: 15,
        promotional: 0,
        low_effort: 0,
      };
      const overallScore = Math.min(
        100,
        Math.round(
          valueOpportunity * 0.5 +
            accountScore.quality * 0.3 +
            typeBonuses[candidate.replyType] * 0.2,
        ),
      );

      // Generate reason
      const reasons: string[] = [];
      if (candidate.replyType === "question")
        reasons.push("asking a question we can answer");
      if (candidate.replyType === "pain_point")
        reasons.push("expressing a pain point we relate to");
      if (candidate.replyType === "opinion")
        reasons.push("shared an opinion we can expand on");
      if (candidate.replyType === "insight")
        reasons.push("made a substantive point worth engaging with");
      if (accountScore.isKol)
        reasons.push(
          `KOL (${accountScore.signals.followerScore >= 85 ? "10k+" : "1k+"} followers)`,
        );
      if ((candidate.reply.likes ?? 0) >= 10)
        reasons.push(`high-engagement reply (${candidate.reply.likes} likes)`);

      return {
        tweetId: candidate.reply.id,
        author: candidate.reply.author,
        text: candidate.reply.text,
        replyType: candidate.replyType,
        accountScore,
        valueOpportunity,
        overallScore,
        reason: reasons.join(", ") || "relevant community member",
      } satisfies ScoredReply;
    }),
  );

  for (const result of enriched) {
    if (result.status === "fulfilled") {
      // Final filter: skip low-quality targets
      if (
        result.value.overallScore >= 25 &&
        result.value.replyType !== "low_effort" &&
        result.value.replyType !== "promotional"
      ) {
        scored.push(result.value);
      }
    }
  }

  // Sort by overall score, take top N
  scored.sort((a, b) => b.overallScore - a.overallScore);
  const targets = scored.slice(0, maxTargets);

  return {
    rootTweetId: tweetId,
    rootAuthor,
    rootText,
    replyCount: replies.length,
    targets,
    provenance,
    durationMs: Date.now() - start,
  };
}

/**
 * Extract tweet ID from a Twitter/X URL.
 * Handles: https://x.com/user/status/123, https://twitter.com/user/status/123
 */
export function extractTweetId(url: string): string | null {
  const match = url.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/);
  return match?.[1] ?? null;
}
