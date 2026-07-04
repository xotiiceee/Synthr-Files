/**
 * Account quality scorer — bot detection + KOL identification.
 *
 * Works with data from ClawNet's Twitter endpoints (twitsh-user-profile, cascade-twitter-user).
 * Falls back to username-only heuristics when profile data isn't available.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AuthorSignals {
  username: string;
  displayName?: string;
  followers?: number;
  following?: number;
  verified?: boolean;
  bio?: string;
  engagementRate?: number;
  accountAge?: 'new' | 'established' | 'unknown';
}

export interface AccountScore {
  /** 0–100, higher = more likely real + valuable. 50+ = worth engaging. */
  quality: number;
  /** 0–100, higher = more likely bot. 60+ = skip. */
  botProbability: number;
  /** Is this a KOL worth targeting? (1k+ followers, real engagement) */
  isKol: boolean;
  /** Human-readable summary for logging */
  label: 'kol' | 'quality' | 'normal' | 'low-quality' | 'bot-likely';
  /** Individual signal scores */
  signals: {
    usernameScore: number;
    followerScore: number;
    ratioScore: number;
    bioScore: number;
    verifiedBonus: number;
  };
}

// ─── Username Pattern Analysis ──────────────────────────────────────────────

const BOT_USERNAME_PATTERNS = [
  /^[a-z]{2,4}\d{6,}$/i,              // ab123456
  /^[A-Za-z]+_[A-Za-z]+\d{4,}$/,      // First_Last12345
  /^[a-f0-9]{8,}$/i,                   // hex string
  /^user\d+$/i,                        // user12345
  /^[A-Z][a-z]+[A-Z][a-z]+\d+$/,      // JohnDoe42
  /crypto|gem|pump|moon|100x|nft.*flip/i,  // spam keywords in handle
  /^.{20,}$/,                          // very long usernames
];

const QUALITY_USERNAME_PATTERNS = [
  /^[a-z_]{3,15}$/,                    // clean, short lowercase
  /^[a-z]+[._][a-z]+$/i,              // first.last or first_last
  /^[a-z]{3,12}\d{0,2}$/i,            // natural name with optional 1-2 digits
];

function scoreUsername(username: string): number {
  if (!username) return 0;
  const clean = username.replace(/^@/, '');

  // Bot patterns
  for (const pattern of BOT_USERNAME_PATTERNS) {
    if (pattern.test(clean)) return 15;
  }

  // Quality patterns
  for (const pattern of QUALITY_USERNAME_PATTERNS) {
    if (pattern.test(clean)) return 85;
  }

  // Default: moderate score based on length and character diversity
  const hasLetters = /[a-zA-Z]/.test(clean);
  const hasNumbers = /\d/.test(clean);
  const hasUnderscore = /_/.test(clean);
  const reasonable = clean.length >= 3 && clean.length <= 15;

  let score = 50;
  if (hasLetters && reasonable) score += 15;
  if (hasUnderscore && hasLetters) score += 5;
  if (hasNumbers && clean.replace(/\D/g, '').length > 4) score -= 15;
  return Math.max(10, Math.min(90, score));
}

// ─── Follower Score ─────────────────────────────────────────────────────────

function scoreFollowers(followers?: number): number {
  if (followers == null) return 50; // unknown = neutral
  if (followers >= 100_000) return 95;
  if (followers >= 10_000) return 85;
  if (followers >= 1_000) return 75;
  if (followers >= 100) return 60;
  if (followers >= 10) return 40;
  return 20;
}

// ─── Follow Ratio Score ─────────────────────────────────────────────────────

function scoreFollowRatio(followers?: number, following?: number): number {
  if (followers == null || following == null) return 50;
  if (following === 0) return followers > 100 ? 90 : 50;
  const ratio = following / Math.max(followers, 1);
  // ratio > 10 = following way more than followers = bot signal
  if (ratio > 10) return 15;
  if (ratio > 5) return 30;
  if (ratio > 2) return 50;
  if (ratio > 1) return 60;
  // More followers than following = good signal
  return 80;
}

// ─── Bio Quality ────────────────────────────────────────────────────────────

const SPAM_BIO_PATTERNS = [
  /dm.*for.*promo/i,
  /follow.*back/i,
  /100x|1000x|guaranteed/i,
  /check.*pinned/i,
  /crypto.*influencer/i,
  /send.*dm/i,
  /^$/,  // empty bio
];

function scoreBio(bio?: string): number {
  if (!bio || bio.trim().length === 0) return 25;
  for (const pattern of SPAM_BIO_PATTERNS) {
    if (pattern.test(bio)) return 15;
  }
  // Longer, substantive bios = better
  const words = bio.split(/\s+/).length;
  if (words >= 10) return 80;
  if (words >= 5) return 65;
  return 45;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Score an account based on available signals.
 * Works with full profile data or just a username.
 */
export function scoreAccount(author: AuthorSignals): AccountScore {
  const usernameScore = scoreUsername(author.username);
  const followerScore = scoreFollowers(author.followers);
  const ratioScore = scoreFollowRatio(author.followers, author.following);
  const bioScore = scoreBio(author.bio);
  const verifiedBonus = author.verified ? 20 : 0;

  // Weighted composite — followers matter most, then ratio, then username, then bio
  const quality = Math.min(100, Math.round(
    followerScore * 0.30 +
    ratioScore * 0.20 +
    usernameScore * 0.20 +
    bioScore * 0.15 +
    verifiedBonus * 0.15 +
    (verifiedBonus > 0 ? 10 : 0)  // extra boost for verified
  ));

  const botProbability = Math.max(0, Math.min(100, 100 - quality));

  const isKol = (author.followers ?? 0) >= 1_000
    && quality >= 65
    && (author.verified || (author.followers ?? 0) >= 5_000);

  let label: AccountScore['label'];
  if (isKol) label = 'kol';
  else if (quality >= 70) label = 'quality';
  else if (quality >= 45) label = 'normal';
  else if (quality >= 25) label = 'low-quality';
  else label = 'bot-likely';

  return {
    quality,
    botProbability,
    isKol,
    label,
    signals: { usernameScore, followerScore, ratioScore, bioScore, verifiedBonus },
  };
}

/**
 * Quick bot check from username only (no API call needed).
 * Returns true if the username looks bot-like.
 */
export function isLikelyBot(username: string): boolean {
  return scoreUsername(username) < 30;
}

/**
 * Quick KOL check from follower count only.
 */
export function isLikelyKol(followers: number, verified: boolean = false): boolean {
  return followers >= 1_000 && (verified || followers >= 5_000);
}
