/**
 * Multi-brand manager for PULSE.
 * Manages multiple brand configurations from one install.
 * Each brand gets its own pulse.yaml and data directory.
 *
 * Directory structure:
 *   data/brands/<slug>/pulse.yaml
 *   data/brands/<slug>/outreach.json
 *   data/brands/<slug>/actions.json
 *   data/brands/<slug>/pulse-crm.db
 *
 * When no brand is selected (single-brand mode), everything works
 * exactly as before — root pulse.yaml and data/ directory.
 * Multi-brand is opt-in.
 */

import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import type { PulseConfig } from './persona.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BrandInfo {
  slug: string;
  name: string;
  niche: string;
  platforms: string[];
  createdAt: string;
}

// ─── Paths ──────────────────────────────────────────────────────────────────

const BRANDS_DIR = path.join(process.cwd(), 'data', 'brands');

function brandDir(slug: string): string {
  return path.join(BRANDS_DIR, slug);
}

function brandConfigPath(slug: string): string {
  return path.join(brandDir(slug), 'pulse.yaml');
}

// ─── Brand Operations ───────────────────────────────────────────────────────

/**
 * Scan data/brands/ for subdirectories containing pulse.yaml.
 */
export function listBrands(): BrandInfo[] {
  if (!fs.existsSync(BRANDS_DIR)) return [];

  const entries = fs.readdirSync(BRANDS_DIR, { withFileTypes: true });
  const brands: BrandInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const configFile = brandConfigPath(entry.name);
    if (!fs.existsSync(configFile)) continue;

    try {
      const raw = fs.readFileSync(configFile, 'utf-8');
      const config = YAML.parse(raw) as PulseConfig;
      const stat = fs.statSync(configFile);

      const enabledPlatforms = Object.entries(config.platforms || {})
        .filter(([, s]) => s.enabled)
        .map(([name]) => name);

      brands.push({
        slug: entry.name,
        name: config.persona?.brandName || entry.name,
        niche: config.persona?.niche || 'general',
        platforms: enabledPlatforms,
        createdAt: stat.birthtime.toISOString().slice(0, 10),
      });
    } catch {
      // Skip malformed configs
    }
  }

  return brands;
}

/**
 * Create a new brand directory and save its pulse.yaml.
 */
export function createBrand(slug: string, config: PulseConfig): void {
  const dir = brandDir(slug);
  if (fs.existsSync(dir)) {
    throw new Error(`Brand "${slug}" already exists`);
  }

  // Validate slug: lowercase alphanumeric + hyphens only
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) && slug.length > 1) {
    throw new Error('Brand slug must be lowercase alphanumeric with hyphens (e.g. "my-saas")');
  }
  if (slug.length === 1 && !/^[a-z0-9]$/.test(slug)) {
    throw new Error('Brand slug must be lowercase alphanumeric');
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(brandConfigPath(slug), YAML.stringify(config, { lineWidth: 120 }));
}

/**
 * Set the active brand via PULSE_BRAND env var.
 */
export function switchBrand(slug: string): void {
  const dir = brandDir(slug);
  if (!fs.existsSync(brandConfigPath(slug))) {
    throw new Error(`Brand "${slug}" not found — run "brands create ${slug}" first`);
  }

  process.env.PULSE_BRAND = slug;

  // Write .active-brand file so other processes can detect it
  const markerPath = path.join(BRANDS_DIR, '.active-brand');
  fs.mkdirSync(BRANDS_DIR, { recursive: true });
  fs.writeFileSync(markerPath, slug);
}

/**
 * Get the currently active brand slug, or null for single-brand mode.
 */
export function getCurrentBrand(): string | null {
  // Check env var first
  if (process.env.PULSE_BRAND) return process.env.PULSE_BRAND;

  // Check marker file
  const markerPath = path.join(BRANDS_DIR, '.active-brand');
  if (fs.existsSync(markerPath)) {
    const slug = fs.readFileSync(markerPath, 'utf-8').trim();
    if (slug && fs.existsSync(brandConfigPath(slug))) {
      process.env.PULSE_BRAND = slug;
      return slug;
    }
  }

  return null;
}

/**
 * Load a specific brand's config.
 */
export function getBrandConfig(slug: string): PulseConfig | null {
  const configFile = brandConfigPath(slug);
  if (!fs.existsSync(configFile)) return null;

  try {
    const raw = fs.readFileSync(configFile, 'utf-8');
    return YAML.parse(raw) as PulseConfig;
  } catch {
    return null;
  }
}

/**
 * Delete a brand directory. Caller must confirm before calling this.
 */
export function deleteBrand(slug: string): void {
  const dir = brandDir(slug);
  if (!fs.existsSync(dir)) {
    throw new Error(`Brand "${slug}" not found`);
  }

  fs.rmSync(dir, { recursive: true, force: true });

  // Clear active brand if it was the deleted one
  if (getCurrentBrand() === slug) {
    delete process.env.PULSE_BRAND;
    const markerPath = path.join(BRANDS_DIR, '.active-brand');
    if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);
  }
}

/**
 * Get the data directory for the current or specified brand.
 * In single-brand mode, returns the root data/ directory.
 */
export function getBrandDataDir(slug?: string): string {
  const brand = slug || getCurrentBrand();
  if (brand) {
    const dir = brandDir(brand);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  // Single-brand mode — root data directory
  const rootData = path.join(process.cwd(), 'data');
  if (!fs.existsSync(rootData)) fs.mkdirSync(rootData, { recursive: true });
  return rootData;
}
