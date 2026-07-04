import crypto from "node:crypto";

import { createSession, type CreatedSession } from "./sessions.js";
import { createUser, getMembership, getUserByEmail, createVerificationToken, getVerificationToken, markUserEmailVerified, deleteVerificationToken, type User } from "./db.js";

const PASSWORD_HASH_VERSION = "pulse-scrypt-v1";
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 32;
const PASSWORD_MIN_LENGTH = 12;

export interface PasswordHashOptions {
  salt?: string;
}

export interface CreateFirstPartyUserInput {
  email: string;
  password: string;
  name?: string;
}

export interface AuthenticateFirstPartyPasswordInput {
  email: string;
  password: string;
  orgId?: string | null;
  ttlSeconds?: number;
  userAgent?: string;
  ipAddress?: string;
  now?: Date;
}

export type FirstPartyPasswordAuthResult =
  | {
      ok: true;
      user: User;
      session: CreatedSession["session"];
      token: string;
    }
  | {
      ok: false;
      error:
        | "invalid_credentials"
        | "password_not_configured"
        | "org_membership_required";
    };

export function validatePasswordStrength(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
    );
  }
}

export function hashPassword(
  password: string,
  options: PasswordHashOptions = {},
): string {
  validatePasswordStrength(password);

  const salt =
    options.salt ?? crypto.randomBytes(PASSWORD_SALT_BYTES).toString("hex");
  const hash = crypto
    .scryptSync(password, salt, PASSWORD_KEY_BYTES)
    .toString("hex");
  return `${PASSWORD_HASH_VERSION}:${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [version, salt, hash] = storedHash.split(":");
  if (version !== PASSWORD_HASH_VERSION || !salt || !hash) return false;

  try {
    const check = crypto
      .scryptSync(password, salt, PASSWORD_KEY_BYTES)
      .toString("hex");
    const expected = Buffer.from(hash, "hex");
    const actual = Buffer.from(check, "hex");
    return expected.length === actual.length
      ? crypto.timingSafeEqual(expected, actual)
      : false;
  } catch {
    return false;
  }
}

export function createFirstPartyUser(input: CreateFirstPartyUserInput): User {
  return createUser({
    email: normalizeEmail(input.email),
    name: input.name,
    passwordHash: hashPassword(input.password),
  });
}

export function authenticateFirstPartyPassword(
  input: AuthenticateFirstPartyPasswordInput,
): FirstPartyPasswordAuthResult {
  const user = getUserByEmail(normalizeEmail(input.email));
  if (!user) return { ok: false, error: "invalid_credentials" };
  if (!user.password_hash) {
    return { ok: false, error: "password_not_configured" };
  }
  if (!verifyPassword(input.password, user.password_hash)) {
    return { ok: false, error: "invalid_credentials" };
  }
  if (input.orgId && !getMembership(input.orgId, user.id)) {
    return { ok: false, error: "org_membership_required" };
  }

  const { session, token } = createSession({
    userId: user.id,
    orgId: input.orgId,
    ttlSeconds: input.ttlSeconds,
    userAgent: input.userAgent,
    ipAddress: input.ipAddress,
    now: input.now,
  });

  return { ok: true, user, session, token };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface SignUpUserInput {
  email: string;
  password: string;
  name?: string;
}

export interface SignUpUserResult {
  ok: true;
  user: User;
  verificationToken: string;
}

export type SignUpUserError =
  | { ok: false; error: "email_already_exists" }
  | { ok: false; error: "password_too_weak"; message: string }
  | { ok: false; error: "invalid_email" };

export function signUpUser(input: SignUpUserInput): SignUpUserResult | SignUpUserError {
  const email = normalizeEmail(input.email);
  if (!email || !email.includes("@")) {
    return { ok: false, error: "invalid_email" };
  }

  const existing = getUserByEmail(email);
  if (existing) {
    return { ok: false, error: "email_already_exists" };
  }

  try {
    validatePasswordStrength(input.password);
  } catch (err) {
    return {
      ok: false,
      error: "password_too_weak",
      message: err instanceof Error ? err.message : "Password too weak",
    };
  }

  const user = createFirstPartyUser({ email, password: input.password, name: input.name });
  const verificationToken = createVerificationToken(user.id);

  return { ok: true, user, verificationToken };
}

export function verifyUserEmail(token: string): { ok: boolean; userId?: string } {
  const record = getVerificationToken(token);
  if (!record) return { ok: false };

  markUserEmailVerified(record.user_id);
  deleteVerificationToken(token);

  return { ok: true, userId: record.user_id };
}
