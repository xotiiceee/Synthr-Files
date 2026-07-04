import { loadState, saveState, deleteState } from "../src/core/state.js";
import { getHostedSelectedRuntimeAgentId } from "./brand-runtime-context.js";
import { getContext } from "./context.js";

function getLegacyAgentIdProvider(): (() => string | undefined) | undefined {
  return (
    globalThis as typeof globalThis & {
      __pulseGetLegacyActiveAgentId?: () => string | undefined;
    }
  ).__pulseGetLegacyActiveAgentId;
}

export function currentHostedRuntimeAgentId(fallback = "default"): string {
  const context = getContext();
  const selectedAgentId = context?.selectedAgentId?.trim();
  if (selectedAgentId) return selectedAgentId;
  if (context?.tenantId) {
    const persistedAgentId = getHostedSelectedRuntimeAgentId({
      tenantId: context.tenantId,
    });
    if (persistedAgentId) return persistedAgentId;
  }
  const legacyActiveAgentId = getLegacyAgentIdProvider()?.()?.trim();
  if (legacyActiveAgentId) return legacyActiveAgentId;
  return fallback;
}

export function hostedRuntimeStateKey(baseName: string, agentId?: string): string {
  return `${baseName}-${agentId || currentHostedRuntimeAgentId()}`;
}

export function loadHostedRuntimeState<T>(
  baseName: string,
  defaultValue: T,
  agentId?: string,
): T {
  return loadState<T>(hostedRuntimeStateKey(baseName, agentId), defaultValue);
}

export function saveHostedRuntimeState<T>(
  baseName: string,
  data: T,
  agentId?: string,
): void {
  saveState(hostedRuntimeStateKey(baseName, agentId), data);
}

export function deleteHostedRuntimeState(
  baseName: string,
  agentId?: string,
): void {
  deleteState(hostedRuntimeStateKey(baseName, agentId));
}
