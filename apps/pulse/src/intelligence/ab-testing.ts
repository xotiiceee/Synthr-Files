/**
 * A/B Testing Engine for PULSE.
 * Tests different reply styles, tracks engagement, and auto-adjusts
 * style weights over time based on measured performance.
 */

import { getCRM } from '../crm/database.js';
import { loadState, saveState } from '../core/state.js';
import { askLLM } from '../core/llm.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ABTest {
  id: number;
  testName: string;
  variantA: string;
  variantB: string;
  variantASends: number;
  variantBSends: number;
  variantAEngagement: number;
  variantBEngagement: number;
  winner: string | null;
  status: string;
  createdAt: string;
}

export interface TestResult extends ABTest {
  impressions: number;
  significanceReached: boolean;
}

// ─── Schema Migration ────────────────────────────────────────────────────────

let migrated = false;

function ensureTables(): void {
  if (migrated) return;
  const db = getCRM();

  db.exec(`
    CREATE TABLE IF NOT EXISTS ab_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      test_name TEXT NOT NULL,
      variant_a TEXT NOT NULL,
      variant_b TEXT NOT NULL,
      variant_a_sends INTEGER DEFAULT 0,
      variant_b_sends INTEGER DEFAULT 0,
      variant_a_engagement REAL DEFAULT 0,
      variant_b_engagement REAL DEFAULT 0,
      winner TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ab_impressions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      test_id INTEGER NOT NULL REFERENCES ab_tests(id),
      variant TEXT NOT NULL,
      platform TEXT NOT NULL,
      content TEXT NOT NULL,
      engagement_score REAL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ab_impressions_test_id ON ab_impressions(test_id);
    CREATE INDEX IF NOT EXISTS idx_ab_tests_status ON ab_tests(status);
    CREATE INDEX IF NOT EXISTS idx_ab_tests_name ON ab_tests(test_name);
  `);

  migrated = true;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rowToTest(row: Record<string, unknown>): ABTest {
  return {
    id: row.id as number,
    testName: row.test_name as string,
    variantA: row.variant_a as string,
    variantB: row.variant_b as string,
    variantASends: row.variant_a_sends as number,
    variantBSends: row.variant_b_sends as number,
    variantAEngagement: row.variant_a_engagement as number,
    variantBEngagement: row.variant_b_engagement as number,
    winner: (row.winner as string) || null,
    status: row.status as string,
    createdAt: row.created_at as string,
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

/**
 * Create a new A/B test.
 */
export function createTest(name: string, variantA: string, variantB: string): ABTest {
  ensureTables();
  const db = getCRM();
  const now = new Date().toISOString();

  const info = db.prepare(`
    INSERT INTO ab_tests (test_name, variant_a, variant_b, created_at)
    VALUES (?, ?, ?, ?)
  `).run(name, variantA, variantB, now);

  return {
    id: info.lastInsertRowid as number,
    testName: name,
    variantA,
    variantB,
    variantASends: 0,
    variantBSends: 0,
    variantAEngagement: 0,
    variantBEngagement: 0,
    winner: null,
    status: 'active',
    createdAt: now,
  };
}

/**
 * Get all active A/B tests.
 */
export function getActiveTests(): ABTest[] {
  ensureTables();
  const db = getCRM();
  const rows = db.prepare(`SELECT * FROM ab_tests WHERE status = 'active' ORDER BY created_at DESC`).all() as Record<string, unknown>[];
  return rows.map(rowToTest);
}

/**
 * Pick which variant to serve for a given test.
 * Returns the variant with fewer sends (balanced), or random if tied.
 */
export function pickVariant(testName: string): { testId: number; variant: 'a' | 'b'; value: string } | null {
  ensureTables();
  const db = getCRM();

  const row = db.prepare(`SELECT * FROM ab_tests WHERE test_name = ? AND status = 'active' LIMIT 1`).get(testName) as Record<string, unknown> | undefined;
  if (!row) return null;

  const test = rowToTest(row);
  let variant: 'a' | 'b';

  if (test.variantASends < test.variantBSends) {
    variant = 'a';
  } else if (test.variantBSends < test.variantASends) {
    variant = 'b';
  } else {
    variant = Math.random() < 0.5 ? 'a' : 'b';
  }

  // Increment send count
  const col = variant === 'a' ? 'variant_a_sends' : 'variant_b_sends';
  db.prepare(`UPDATE ab_tests SET ${col} = ${col} + 1 WHERE id = ?`).run(test.id);

  return {
    testId: test.id,
    variant,
    value: variant === 'a' ? test.variantA : test.variantB,
  };
}

/**
 * Record an impression (a variant was shown to a user).
 * Returns the impression ID.
 */
export function recordImpression(
  testId: number,
  variant: 'a' | 'b',
  platform: string,
  content: string
): number {
  ensureTables();
  const db = getCRM();
  const now = new Date().toISOString();

  const info = db.prepare(`
    INSERT INTO ab_impressions (test_id, variant, platform, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(testId, variant, platform, content, now);

  return info.lastInsertRowid as number;
}

/**
 * Update the engagement score for an impression.
 * Recalculates the average engagement for the variant on the parent test.
 */
export function updateEngagement(impressionId: number, score: number): void {
  ensureTables();
  const db = getCRM();

  // Clamp score 0-10
  const clamped = Math.max(0, Math.min(10, score));

  db.prepare(`UPDATE ab_impressions SET engagement_score = ? WHERE id = ?`).run(clamped, impressionId);

  // Get the impression to find test + variant
  const imp = db.prepare(`SELECT test_id, variant FROM ab_impressions WHERE id = ?`).get(impressionId) as { test_id: number; variant: string } | undefined;
  if (!imp) return;

  // Recalculate average for this variant
  const avg = db.prepare(`
    SELECT AVG(engagement_score) as avg_score
    FROM ab_impressions
    WHERE test_id = ? AND variant = ? AND engagement_score > 0
  `).get(imp.test_id, imp.variant) as { avg_score: number | null } | undefined;

  const avgScore = avg?.avg_score ?? 0;
  const col = imp.variant === 'a' ? 'variant_a_engagement' : 'variant_b_engagement';
  db.prepare(`UPDATE ab_tests SET ${col} = ? WHERE id = ?`).run(avgScore, imp.test_id);
}

/**
 * Evaluate a test to determine the winner.
 * Requires at least 10 impressions per variant with engagement data.
 * Uses simple mean comparison with effect size threshold.
 */
export function evaluateTest(testId: number): { winner: 'a' | 'b' | null; confidence: number } {
  ensureTables();
  const db = getCRM();

  // Get counts and averages per variant
  const stats = db.prepare(`
    SELECT
      variant,
      COUNT(*) as cnt,
      AVG(engagement_score) as avg_score,
      SUM(engagement_score * engagement_score) as sum_sq
    FROM ab_impressions
    WHERE test_id = ? AND engagement_score > 0
    GROUP BY variant
  `).all(testId) as Array<{ variant: string; cnt: number; avg_score: number; sum_sq: number }>;

  const a = stats.find(s => s.variant === 'a');
  const b = stats.find(s => s.variant === 'b');

  // Need at least 10 scored impressions per variant
  if (!a || !b || a.cnt < 10 || b.cnt < 10) {
    return { winner: null, confidence: 0 };
  }

  // Compute variance for each: var = (sum_sq / n) - mean^2
  const varA = (a.sum_sq / a.cnt) - (a.avg_score * a.avg_score);
  const varB = (b.sum_sq / b.cnt) - (b.avg_score * b.avg_score);

  // Pooled standard error
  const se = Math.sqrt((Math.max(0, varA) / a.cnt) + (Math.max(0, varB) / b.cnt));

  // Z-score (difference / standard error)
  const diff = a.avg_score - b.avg_score;
  const z = se > 0 ? Math.abs(diff) / se : 0;

  // Approximate confidence from z-score
  // z >= 1.96 => ~95%, z >= 2.58 => ~99%
  let confidence = 0;
  if (z >= 2.58) confidence = 0.99;
  else if (z >= 1.96) confidence = 0.95;
  else if (z >= 1.65) confidence = 0.90;
  else if (z >= 1.28) confidence = 0.80;
  else confidence = Math.min(0.75, z / 2.58);

  let winner: 'a' | 'b' | null = null;

  // Need at least 80% confidence to declare a winner
  if (confidence >= 0.80) {
    winner = diff > 0 ? 'a' : 'b';

    // Update the test record
    db.prepare(`
      UPDATE ab_tests SET winner = ?, status = 'completed', completed_at = ?
      WHERE id = ?
    `).run(winner, new Date().toISOString(), testId);
  }

  return { winner, confidence: Math.round(confidence * 100) / 100 };
}

/**
 * Get all test results with stats.
 */
export function getTestResults(): TestResult[] {
  ensureTables();
  const db = getCRM();

  const tests = db.prepare(`SELECT * FROM ab_tests ORDER BY created_at DESC`).all() as Record<string, unknown>[];

  return tests.map(row => {
    const test = rowToTest(row);

    // Count scored impressions
    const countRow = db.prepare(`
      SELECT COUNT(*) as cnt FROM ab_impressions
      WHERE test_id = ? AND engagement_score > 0
    `).get(test.id) as { cnt: number };

    const impressions = countRow.cnt;

    // Count per-variant scored impressions
    const perVariant = db.prepare(`
      SELECT variant, COUNT(*) as cnt FROM ab_impressions
      WHERE test_id = ? AND engagement_score > 0
      GROUP BY variant
    `).all(test.id) as Array<{ variant: string; cnt: number }>;

    const aCnt = perVariant.find(v => v.variant === 'a')?.cnt ?? 0;
    const bCnt = perVariant.find(v => v.variant === 'b')?.cnt ?? 0;
    const significanceReached = aCnt >= 10 && bCnt >= 10;

    return { ...test, impressions, significanceReached };
  });
}

/**
 * Auto-create default A/B tests if none exist.
 * Creates tests for: reply_style, url_inclusion, tone.
 */
export function autoCreateTests(): void {
  ensureTables();
  const db = getCRM();

  const existing = db.prepare(`SELECT COUNT(*) as cnt FROM ab_tests`).get() as { cnt: number };
  if (existing.cnt > 0) return;

  console.log('  [A/B] Creating default tests...');

  createTest('reply_style', 'valueFirst', 'question');
  createTest('url_inclusion', '30%', '50%');
  createTest('tone', 'casual', 'professional');

  console.log('  [A/B] Created 3 default tests: reply_style, url_inclusion, tone');
}
