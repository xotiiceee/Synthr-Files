import { loadState, saveState, deleteState } from "./state.js";

function getContextAgentIdProvider(): (() => string | undefined) | undefined {
  return (
    globalThis as typeof globalThis & {
      __pulseGetContextAgentId?: () => string | undefined;
    }
  ).__pulseGetContextAgentId;
}

function getLegacyAgentIdProvider(): (() => string | undefined) | undefined {
  return (
    globalThis as typeof globalThis & {
      __pulseGetLegacyActiveAgentId?: () => string | undefined;
    }
  ).__pulseGetLegacyActiveAgentId;
}

function resolveAgentId(overrideAgentId?: string): string {
  const explicitAgentId = overrideAgentId?.trim();
  if (explicitAgentId) return explicitAgentId;

  const contextAgentId = getContextAgentIdProvider()?.()?.trim();
  if (contextAgentId) return contextAgentId;

  const legacyAgentId = getLegacyAgentIdProvider()?.()?.trim();
  if (legacyAgentId) return legacyAgentId;

  return "default";
}

export function runtimeAgentStateKey(
  baseName: string,
  overrideAgentId?: string,
): string {
  return `${baseName}-${resolveAgentId(overrideAgentId)}`;
}

export function loadRuntimeAgentState<T>(
  baseName: string,
  defaultValue: T,
  overrideAgentId?: string,
): T {
  return loadState<T>(runtimeAgentStateKey(baseName, overrideAgentId), defaultValue);
}

export function saveRuntimeAgentState<T>(
  baseName: string,
  data: T,
  overrideAgentId?: string,
): void {
  saveState(runtimeAgentStateKey(baseName, overrideAgentId), data);
}

export function deleteRuntimeAgentState(
  baseName: string,
  overrideAgentId?: string,
): void {
  deleteState(runtimeAgentStateKey(baseName, overrideAgentId));
}

export function currentRuntimeAgentId(): string {
  return resolveAgentId();
}
