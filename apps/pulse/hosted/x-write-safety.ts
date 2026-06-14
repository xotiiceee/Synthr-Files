import {
  setXWriteSafetyFailureHook,
  setXWriteSafetyHook,
  type XWriteSafetyEvent,
  type XWriteSafetyFailureEvent,
  type XWriteSafetyHook,
} from "../src/platforms/x-write-client.js";
import { getContextTenantId } from "./context.js";
import {
  consumeRateBucket,
  isAccountAllowed,
  openCircuitBreaker,
} from "./account-safety.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const DEFAULT_POSTS_PER_HOUR = 10;
const DEFAULT_REPLIES_PER_HOUR = 20;
const DEFAULT_LIKES_PER_HOUR = 60;

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveScope(event: XWriteSafetyEvent): {
  tenantId?: string;
  brandId?: string;
  accountId?: string;
} {
  const tenantId = getContextTenantId();
  const brandId =
    metadataString(event.metadata, "brandId") ||
    metadataString(event.metadata, "tenantId") ||
    tenantId;
  const accountId =
    metadataString(event.metadata, "accountId") ||
    metadataString(event.metadata, "xAccountId") ||
    brandId;
  return { tenantId, brandId, accountId };
}

function rateLimitForAction(action: XWriteSafetyEvent["action"]): number {
  const envKey =
    action === "post"
      ? "PULSE_X_POSTS_PER_HOUR"
      : action === "reply"
        ? "PULSE_X_REPLIES_PER_HOUR"
        : "PULSE_X_LIKES_PER_HOUR";
  const value = Number.parseInt(process.env[envKey] || "", 10);
  if (Number.isFinite(value) && value > 0) return value;
  if (action === "post") return DEFAULT_POSTS_PER_HOUR;
  if (action === "reply") return DEFAULT_REPLIES_PER_HOUR;
  return DEFAULT_LIKES_PER_HOUR;
}

function shouldOpenCircuitBreaker(error: string): boolean {
  return (
    /\b(401|403|429)\b/.test(error) ||
    /unauthori[sz]ed|invalid token|forbidden|not allowed|not permitted|rate limit|too many requests/i.test(
      error,
    )
  );
}

export function createHostedXWriteSafetyHook(): XWriteSafetyHook {
  return (event) => {
    const { brandId, accountId } = resolveScope(event);
    if (!brandId) return { allowed: true };

    const safety = isAccountAllowed({
      brandId,
      accountId,
    });
    if (!safety.allowed) {
      return {
        allowed: false,
        reason: `X write blocked by account safety controls: ${safety.reasons.join(", ")}`,
      };
    }

    if (!event.operationId) return { allowed: true };

    const bucket = consumeRateBucket({
      scopeType: "brand",
      scopeId: brandId,
      bucketKey: `x_write_${event.action}_hourly`,
      limit: rateLimitForAction(event.action),
      windowMs: ONE_HOUR_MS,
      idempotencyKey: `x-write-safety:${brandId}:${event.action}:${event.operationId}`,
    });
    if (!bucket.allowed) {
      return {
        allowed: false,
        reason: `X ${event.action} hourly safety limit reached; retry in ${Math.ceil(bucket.retryAfterMs / 1000)}s`,
      };
    }

    return { allowed: true };
  };
}

export function recordHostedXWriteSafetyFailure(
  event: XWriteSafetyFailureEvent,
): void {
  if (!shouldOpenCircuitBreaker(event.error)) return;
  const { brandId, accountId } = resolveScope(event);
  if (!brandId && !accountId) return;

  openCircuitBreaker({
    scopeType: accountId ? "account" : "brand",
    scopeId: accountId || brandId,
    breakerKey: `x_write_${event.action}`,
    source: "x-write-client",
    reason: event.error,
    metadata: {
      action: event.action,
      operationId: event.operationId,
      postType: event.postType,
      replyToPostId: event.replyToPostId,
      brandId,
    },
  });
}

export function installHostedXWriteSafetyHooks(): () => void {
  setXWriteSafetyHook(createHostedXWriteSafetyHook());
  setXWriteSafetyFailureHook(recordHostedXWriteSafetyFailure);
  return () => {
    setXWriteSafetyHook(null);
    setXWriteSafetyFailureHook(null);
  };
}
