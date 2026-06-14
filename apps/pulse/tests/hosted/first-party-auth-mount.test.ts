import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-first-party-auth-mount");
process.env.HOSTED_DB_PATH = dbPath;

const originalAuthProvider = process.env.AUTH_PROVIDER;

const { verifyCsrfBundle } = await import("../../hosted/first-party-auth.js");
const { registerFirstPartyAuthRoutes } =
  await import("../../hosted/first-party-auth-mount.js");
const { INVALID_ORIGIN_CODE, INVALID_REQUEST_CODE } =
  await import("../../hosted/first-party-auth-routes.js");
const { createFirstPartyUser } = await import("../../hosted/password-auth.js");
const { getSessionById } = await import("../../hosted/sessions.js");

function createMountedApp() {
  const app = new Hono();
  const registered = registerFirstPartyAuthRoutes(app, {
    expectedOrigin: "https://pulse.example.test",
    allowedOrigins: ["https://admin.pulse.example.test"],
    isProduction: true,
  });
  return { app, registered };
}

beforeEach(() => {
  if (originalAuthProvider === undefined) {
    delete process.env.AUTH_PROVIDER;
    return;
  }
  process.env.AUTH_PROVIDER = originalAuthProvider;
});

afterAll(() => {
  if (originalAuthProvider === undefined) {
    delete process.env.AUTH_PROVIDER;
  } else {
    process.env.AUTH_PROVIDER = originalAuthProvider;
  }
  cleanupSqliteFiles(dbPath);
});

describe("registerFirstPartyAuthRoutes", () => {
  it("keeps first-party auth endpoints unmounted by default in ClawNet mode", async () => {
    delete process.env.AUTH_PROVIDER;

    const { app, registered } = createMountedApp();

    expect(registered).toBe(false);

    const sessionResponse = await app.request(
      "https://pulse.example.test/auth/session",
    );
    expect(sessionResponse.status).toBe(404);

    const loginResponse = await app.request(
      "https://pulse.example.test/auth/login",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://pulse.example.test",
        },
        body: JSON.stringify({
          email: "disabled@example.test",
          password: "disabled password",
        }),
      },
    );
    expect(loginResponse.status).toBe(404);
  });

  it("mounts first-party auth routes when AUTH_PROVIDER=firstparty and supports login, session, csrf verify, and logout", async () => {
    process.env.AUTH_PROVIDER = "firstparty";
    createFirstPartyUser({
      email: "mounted@example.test",
      password: "mounted route password",
      name: "Mounted Route User",
    });

    const { app, registered } = createMountedApp();
    expect(registered).toBe(true);

    const loginResponse = await app.request(
      "https://pulse.example.test/auth/login",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://pulse.example.test",
          "user-agent": "vitest",
          "x-forwarded-for": "127.0.0.1",
        },
        body: JSON.stringify({
          email: "mounted@example.test",
          password: "mounted route password",
        }),
      },
    );

    expect(loginResponse.status).toBe(200);
    const loginBody = (await loginResponse.json()) as {
      ok: true;
      session: { id: string };
      csrf: { token: string; hash: string };
      user: { email: string };
    };
    const cookieHeader = loginResponse.headers.get("set-cookie")?.split(";")[0];
    expect(cookieHeader).toBeTruthy();
    expect(loginResponse.headers.get("set-cookie")).toContain("pulse_session=");
    expect(loginResponse.headers.get("set-cookie")).toContain("HttpOnly");
    expect(loginResponse.headers.get("set-cookie")).toContain("Secure");
    expect(verifyCsrfBundle(loginBody.csrf, loginBody.session.id)).toBe(true);

    const sessionResponse = await app.request(
      "https://pulse.example.test/auth/session",
      {
        headers: {
          cookie: cookieHeader!,
        },
      },
    );

    expect(sessionResponse.status).toBe(200);
    const sessionBody = (await sessionResponse.json()) as {
      ok: true;
      authenticated: boolean;
      session: { id: string };
      csrf: { token: string; hash: string };
      user: { email: string };
    };
    expect(sessionBody.authenticated).toBe(true);
    expect(sessionBody.user.email).toBe("mounted@example.test");
    expect(sessionBody.session.id).toBe(loginBody.session.id);

    const csrfResponse = await app.request(
      "https://pulse.example.test/auth/csrf/verify",
      {
        method: "POST",
        headers: {
          origin: "https://pulse.example.test",
          cookie: cookieHeader!,
          "x-csrf-token": sessionBody.csrf.token,
          "x-csrf-hash": sessionBody.csrf.hash,
        },
      },
    );

    expect(csrfResponse.status).toBe(200);
    expect(await csrfResponse.json()).toEqual({ ok: true, valid: true });

    const logoutResponse = await app.request(
      "https://pulse.example.test/auth/logout",
      {
        method: "POST",
        headers: {
          origin: "https://admin.pulse.example.test",
          cookie: cookieHeader!,
        },
      },
    );

    expect(logoutResponse.status).toBe(200);
    expect(await logoutResponse.json()).toEqual({
      ok: true,
      revoked: true,
      sessionId: loginBody.session.id,
    });
    expect(logoutResponse.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(getSessionById(loginBody.session.id)?.revoked_at).toBeTruthy();

    const postLogoutSessionResponse = await app.request(
      "https://pulse.example.test/auth/session",
      {
        headers: {
          cookie: cookieHeader!,
        },
      },
    );

    expect(postLogoutSessionResponse.status).toBe(200);
    expect(await postLogoutSessionResponse.json()).toEqual({
      ok: true,
      authenticated: false,
    });
  });

  it("rejects invalid origins on mounted first-party login", async () => {
    process.env.AUTH_PROVIDER = "firstparty";
    createFirstPartyUser({
      email: "invalid-origin@example.test",
      password: "origin reject password",
    });

    const { app, registered } = createMountedApp();
    expect(registered).toBe(true);

    const loginResponse = await app.request(
      "https://pulse.example.test/auth/login",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example.test",
        },
        body: JSON.stringify({
          email: "invalid-origin@example.test",
          password: "origin reject password",
        }),
      },
    );

    expect(loginResponse.status).toBe(403);
    expect(await loginResponse.json()).toMatchObject({
      ok: false,
      code: INVALID_ORIGIN_CODE,
    });
  });

  it("rejects CSRF verification requests with missing token or hash", async () => {
    process.env.AUTH_PROVIDER = "firstparty";
    createFirstPartyUser({
      email: "csrf-missing@example.test",
      password: "csrf missing password",
    });

    const { app, registered } = createMountedApp();
    expect(registered).toBe(true);

    const loginResponse = await app.request(
      "https://pulse.example.test/auth/login",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://pulse.example.test",
        },
        body: JSON.stringify({
          email: "csrf-missing@example.test",
          password: "csrf missing password",
        }),
      },
    );

    const cookieHeader = loginResponse.headers.get("set-cookie")?.split(";")[0];
    expect(cookieHeader).toBeTruthy();

    const csrfResponse = await app.request(
      "https://pulse.example.test/auth/csrf/verify",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://pulse.example.test",
          cookie: cookieHeader!,
        },
        body: JSON.stringify({}),
      },
    );

    expect(csrfResponse.status).toBe(400);
    expect(await csrfResponse.json()).toMatchObject({
      ok: false,
      code: INVALID_REQUEST_CODE,
    });
  });
});
