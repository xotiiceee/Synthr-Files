/**
 * White-label configuration for PULSE.
 * Allows removing/replacing Pulse branding for agencies
 * that resell to their clients.
 *
 * Config stored in data/whitelabel.json.
 */

import fs from 'fs';
import path from 'path';
import { getBrandDataDir } from './brands.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WhiteLabelConfig {
  enabled: boolean;
  agentName: string;          // Replace "Pulse" with this (e.g. "GrowthBot")
  companyName: string;        // Agency name
  companyUrl: string;         // Agency website
  primaryColor: string;       // Hex color for dashboard
  accentColor: string;        // Hex color for dashboard
  logoUrl: string;            // URL to logo image (for dashboard)
  footerText: string;         // Custom footer in reports
  hideCredits: boolean;       // Remove "Powered by Pulse"
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: WhiteLabelConfig = {
  enabled: false,
  agentName: 'Pulse',
  companyName: 'Pulse AI',
  companyUrl: '',
  primaryColor: '#6366f1',
  accentColor: '#22d3ee',
  logoUrl: '',
  footerText: 'Powered by Pulse AI Marketing Agent',
  hideCredits: false,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function configPath(): string {
  return path.join(getBrandDataDir(), 'whitelabel.json');
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Load white-label config from file. Returns default Pulse branding if not set.
 */
export function getWhiteLabelConfig(): WhiteLabelConfig {
  const file = configPath();
  if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG };

  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<WhiteLabelConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Save white-label config. Merges with existing config.
 */
export function setWhiteLabelConfig(config: Partial<WhiteLabelConfig>): void {
  const current = getWhiteLabelConfig();
  const merged = { ...current, ...config };

  const dir = path.dirname(configPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const tmp = configPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2));
  fs.renameSync(tmp, configPath());
}

/**
 * Get the agent display name — white-label name or "Pulse".
 */
export function getAgentName(): string {
  const config = getWhiteLabelConfig();
  return config.enabled ? config.agentName : 'Pulse';
}

/**
 * Get the company name — white-label name or "Pulse AI".
 */
export function getCompanyName(): string {
  const config = getWhiteLabelConfig();
  return config.enabled ? config.companyName : 'Pulse AI';
}

/**
 * Get brand colors for dashboard/reports.
 */
export function getBrandColors(): { primary: string; accent: string } {
  const config = getWhiteLabelConfig();
  return { primary: config.primaryColor, accent: config.accentColor };
}

/**
 * Get footer text for reports — custom or default.
 */
export function getFooterText(): string {
  const config = getWhiteLabelConfig();
  if (config.enabled && config.hideCredits) return config.footerText || '';
  if (config.enabled) return config.footerText || `Powered by ${config.agentName}`;
  return DEFAULT_CONFIG.footerText;
}

/**
 * Check if white-labeling is active.
 */
export function isWhiteLabeled(): boolean {
  return getWhiteLabelConfig().enabled;
}
