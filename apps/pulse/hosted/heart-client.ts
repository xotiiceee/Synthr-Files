import fs from 'node:fs';
import path from 'node:path';
import {
  createSomaHeart,
  loadSomaHeart,
  effectiveCapabilities,
  hasCapability,
  type HeartRuntime,
  type HeartLineage,
} from 'soma-heart';
import { getCryptoProvider } from 'soma-heart/crypto-provider';
import { createGenome, commitGenome } from 'soma-heart/core';
import { saveState, loadState, deleteState } from '../src/core/state.js';

const DEFAULT_HEART_PATH = path.resolve(process.cwd(), 'data/pulse-heart.json');

let pulseHeart: HeartRuntime | null = null;

export function initPulseHeart(): void {
  if (pulseHeart !== null) return;

  const secret = process.env.PULSE_HEART_SECRET;
  if (!secret) {
    throw new Error(
      'PULSE_HEART_SECRET env var is required to initialize the Pulse heart',
    );
  }

  const heartPath = process.env.PULSE_HEART_PATH ?? DEFAULT_HEART_PATH;

  // Rehydrate from existing blob — preserves lineage chain embedded by soma-heart-fork
  if (fs.existsSync(heartPath)) {
    try {
      const blob = fs.readFileSync(heartPath, 'utf-8');
      pulseHeart = loadSomaHeart(blob, secret);
      console.log(`[heart-client] Pulse heart loaded (DID: ${pulseHeart.did})`);
      return;
    } catch (err) {
      throw new Error(
        `[heart-client] Failed to load persisted heart from ${heartPath}: ${err}`,
      );
    }
  }

  // First boot: generate fresh identity and persist so soma-heart-fork can patch it later
  try {
    const provider = getCryptoProvider();
    const keyPair = provider.signing.generateKeyPair();

    const genome = createGenome(
      {
        modelProvider: 'pulse',
        modelId: 'operator',
        modelVersion: '1',
        systemPrompt: 'Pulse operator heart',
        toolManifest: '{}',
        runtimeId: 'pulse-operator',
      },
      provider,
    );

    const commitment = commitGenome(genome, keyPair, provider);

    pulseHeart = createSomaHeart({
      genome: commitment,
      signingKeyPair: keyPair,
      modelApiKey: 'n/a',
      modelBaseUrl: 'https://api.anthropic.com/v1',
      modelId: 'claude-sonnet-4-6',
      cryptoProvider: provider,
    });

    const dir = path.dirname(heartPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // mode 0o600: owner read/write only
    fs.writeFileSync(heartPath, pulseHeart.serialize(secret), {
      encoding: 'utf-8',
      mode: 0o600,
    });

    console.log(
      `[heart-client] Pulse heart created and persisted (DID: ${pulseHeart.did}, path: ${heartPath})`,
    );
  } catch (err) {
    console.error('[heart-client] initPulseHeart failed:', err);
    throw err;
  }
}

export function getPulseHeart(): HeartRuntime {
  if (pulseHeart === null)
    throw new Error('[heart-client] Pulse heart not initialized');
  return pulseHeart;
}

export async function forkAgentHeart(
  agentId: string,
  name: string,
): Promise<{ did: string; certId: string } | null> {
  try {
    const heart = getPulseHeart();
    const { lineageCertificate, childLineage } = heart.fork({
      systemPrompt: `Pulse agent: ${name}`,
      toolManifest: '{}',
      runtimeId: agentId,
      capabilities: [
        'content:post',
        'content:reply',
        'content:thread',
        'content:schedule',
      ],
    });
    saveState(`agent-heart-cert-${agentId}`, lineageCertificate.id);
    saveState(`agent-heart-lineage-${agentId}`, childLineage);
    console.log(
      `[heart-client] Forked agent heart ${agentId} (cert: ${lineageCertificate.id})`,
    );
    return { did: heart.did, certId: lineageCertificate.id };
  } catch (err) {
    console.error(
      `[heart-client] forkAgentHeart failed for ${agentId}:`,
      err,
    );
    return null;
  }
}

export function revokeAgentHeart(agentId: string): void {
  try {
    const certId = loadState<string | null>(
      `agent-heart-cert-${agentId}`,
      null,
    );
    if (certId) {
      getPulseHeart().revoke({ targetId: certId, targetKind: 'lineage' });
      deleteState(`agent-heart-cert-${agentId}`);
      deleteState(`agent-heart-lineage-${agentId}`);
      console.log(
        `[heart-client] Revoked agent heart ${agentId} (cert: ${certId})`,
      );
    }
  } catch (err) {
    console.error(
      `[heart-client] revokeAgentHeart failed for ${agentId}:`,
      err,
    );
  }
}

export function getAgentLineage(agentId: string): HeartLineage | null {
  return loadState<HeartLineage | null>(`agent-heart-lineage-${agentId}`, null);
}

export function agentHasCapability(agentId: string, capability: string): boolean {
  const lineage = getAgentLineage(agentId);
  if (lineage === null) return false;
  const caps = effectiveCapabilities(lineage);
  if (caps === null) return true; // null = inherits all from parent chain
  return hasCapability(caps, capability);
}
