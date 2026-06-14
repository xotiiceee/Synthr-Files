/**
 * Image generation via ClawNet endpoints.
 *
 * Calls ClawNet's image gen registry endpoints (x402engine, freepik, heurist, etc.)
 * Always forces fresh generation (no cache — images should be unique).
 * Saves generated images to the asset library with auto-tags.
 */

import { callEndpoint, isClawNetConfigured, type BirthCertificate } from '../core/clawnet-client.js';
import { addImageAsset, type Asset } from '../core/asset-library.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ImageModel = 'fast' | 'quality' | 'freepik';

export interface ImageGenResult {
  /** URL of the generated image */
  imageUrl: string;
  /** The asset that was saved to the library */
  asset: Asset;
  /** Credits spent */
  creditsUsed: number;
  /** Soma provenance */
  provenance: BirthCertificate | null;
  /** Which model was used */
  model: string;
}

interface ImageEndpointResponse {
  imageUrl?: string;
  image_url?: string;
  url?: string;
  seed?: number;
  width?: number;
  height?: number;
  model?: string;
}

// ─── Model → Endpoint Mapping ───────────────────────────────────────────────

const MODEL_ENDPOINTS: Record<ImageModel, { endpointId: string; label: string }> = {
  fast: { endpointId: 'x402engine-image-fast', label: 'FLUX Schnell (fast, ~$0.015)' },
  quality: { endpointId: 'x402engine-image-quality', label: 'FLUX.2 Pro (quality, ~$0.05)' },
  freepik: { endpointId: 'freepik-image', label: 'Freepik Mystic (~$0.04)' },
};

// ─── Core Generation ────────────────────────────────────────────────────────

/**
 * Generate an image via ClawNet and save it to the asset library.
 *
 * @param prompt - What to generate ("cyberpunk lobster holding a server rack")
 * @param opts - Model selection, tags, categories
 * @returns The generated image URL + saved asset
 */
export async function generateImage(
  prompt: string,
  opts?: {
    model?: ImageModel;
    tags?: string[];
    categories?: string[];
    width?: number;
    height?: number;
    style?: string;
  },
): Promise<ImageGenResult> {
  if (!isClawNetConfigured()) {
    throw new Error('CLAWNET_API_KEY required for image generation');
  }

  const model: ImageModel = opts?.model ?? 'fast';
  const endpoint = MODEL_ENDPOINTS[model];

  // Build params based on endpoint
  const params: Record<string, unknown> = {
    prompt,
    width: opts?.width ?? 1024,
    height: opts?.height ?? 1024,
  };

  if (model === 'freepik' && opts?.style) {
    params.style = opts.style;
  }
  if (model === 'quality' && opts?.style) {
    params.guidance = 3.5;
  }

  // Always force fresh — never cache image generation
  const result = await callEndpoint<ImageEndpointResponse>(endpoint.endpointId, params, {
    cache: 'fresh',
    timeout: 30_000, // Image gen can be slow
  });

  const imageUrl = result.data.imageUrl || result.data.image_url || result.data.url;
  if (!imageUrl) {
    throw new Error(`Image generation returned no URL (endpoint: ${endpoint.endpointId})`);
  }

  // Auto-generate tags from the prompt
  const autoTags = extractTags(prompt);
  const allTags = [...new Set([...(opts?.tags ?? []), ...autoTags])];

  // Save to asset library
  const asset = addImageAsset({
    name: prompt.slice(0, 50),
    tags: allTags,
    source: imageUrl,
    mimeType: 'image/png',
    prompt,
    model: endpoint.label,
    categories: opts?.categories ?? [],
    somaDataHash: result.provenance?.dataHash,
  });

  return {
    imageUrl,
    asset,
    creditsUsed: result.creditsUsed,
    provenance: result.provenance,
    model: endpoint.label,
  };
}

// ─── Tag Extraction ─────────────────────────────────────────────────────────

/**
 * Extract searchable tags from an image gen prompt.
 * Simple keyword extraction — no LLM needed.
 */
function extractTags(prompt: string): string[] {
  const stopWords = new Set([
    'a', 'an', 'the', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
    'and', 'or', 'but', 'is', 'are', 'was', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'that', 'this', 'these',
    'those', 'it', 'its', 'very', 'just', 'about', 'above', 'also',
    'into', 'from', 'up', 'out', 'no', 'not', 'only', 'some', 'such',
  ]);

  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 10);
}

/**
 * Get available image models with their labels and estimated costs.
 */
export function getAvailableModels(): Array<{ id: ImageModel; label: string; costEstimate: string }> {
  return [
    { id: 'fast', label: 'FLUX Schnell', costEstimate: '~$0.015' },
    { id: 'quality', label: 'FLUX.2 Pro', costEstimate: '~$0.05' },
    { id: 'freepik', label: 'Freepik Mystic', costEstimate: '~$0.04' },
  ];
}
