import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-first-party-auth-routes");
process.env.HOSTED_DB_PATH = dbPath;

const originalAuthProvider = process.env.AUTH_PROVIDER;

const { addMembership, createOrg } = await import("../../hosted/db.js");
const { getSessionById } = await import("../../hosted/sessions.js");
const { createFirstPartyUser } = await import("../../hosted/password-auth.js");
const { verifyCsrfBundle } = await import("../../hosted/first-party-auth.js");
const {
  createFirstPartyAuthRouteHandlers,
  handleFirstPartyLoginRequest,
  INVALID_ORIGIN_CODE,
  FIRST_PARTY_AUTH_DISABLED_CODE,
} = await import("../../hosted/first-party-auth-routes.js");

function createApp() {
  const app = new Hono();
  const handlers = createFirstPartyAuthRouteHandlers({
    authProvider: "firstparty",
    expectedOrigin: "https://pulse.example.test",
    allowedOrigins: ["https://admin.pulse.example.test"],
    isProduction: true,
  });

  app.post("/auth/login", handlers.login);
  app.post("/auth/logout", handlers.logout);
  app.get("/auth/session", handlers.session);
  app.post("/auth/csrf/verify", handlers.verifyCsrf);
  return app;
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

describe("first-party auth routes", () => {
  it("keeps the default ClawNet provider guard in place when AUTH_PROVIDER is unset", () => {
    delete process.env.AUTH_PROVIDER;
    createFirstPartyUser({
      email: "guard@example.test",
      password: "guard default password",
    });

    const response = handleFirstPartyLoginRequest({
      email: "guard@example.test",
      password: "guard default password",
      origin: "https://pulse.example.test",
      requestUrl: "https://pulse.example.test/auth/login",
    });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      ok: false,
      code: FIRST_PARTY_AUTH_DISABLED_CODE,
    });
  });

  it("logs in, exposes session state, verifies csrf, and logs out through Hono handlers", async () => {
    createFirstPartyUser({
      email: "routes@example.test",
      password: "route auth password",
      name: "Route User",
    });

    const app = createApp();
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
          email: "routes@example.test",
          password: "route auth password",
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
    const setCookie = loginResponse.headers.get("set-cookie");
    expect(setCookie).toContain("pulse_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(loginBody.user.email).toBe("routes@example.test");
    expect(verifyCsrfBundle(loginBody.csrf, loginBody.session.id)).toBe(true);

    const cookieHeader = setCookie?.split(";")[0];
    expect(cookieHeader).toBeTruthy();

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
    expect(sessionBody.user.email).toBe("routes@example.test");
    expect(sessionBody.session.id).toBe(loginBody.session.id);
    expect(verifyCsrfBundle(sessionBody.csrf, sessionBody.session.id)).toBe(
      true,
    );

    const csrfResponse = await app.request(
      "https://pulse.example.test/auth/csrf/verify",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://pulse.example.test",
          cookie: cookieHeader!,
        },
        body: JSON.stringify({
          csrfToken: sessionBody.csrf.token,
          csrfHash: sessionBody.csrf.hash,
        }),
      },
    );

    expect(csrfResponse.status).toBe(200);
    expect(await csrfResponse.json()).toEqual({ ok: true, valid: true });

    const tamperedCsrfResponse = await app.request(
      "https://pulse.example.test/auth/csrf/verify",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://pulse.example.test",
          cookie: cookieHeader!,
        },
        body: JSON.stringify({
          csrfToken: sessionBody.csrf.token,
          csrfHash: "0".repeat(64),
        }),
      },
    );

    expect(tamperedCsrfResponse.status).toBe(200);
    expect(await tamperedCsrfResponse.json()).toEqual({
      ok: true,
      valid: false,
    });

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
  });

  it("rejects login from an invalid origin", () => {
    createFirstPartyUser({
      email: "origin@example.test",
      password: "origin reject password",
    });

    const response = handleFirstPartyLoginRequest({
      authProvider: "firstparty",
      email: "origin@example.test",
      password: "origin reject password",
      expectedOrigin: "https://pulse.example.test",
      origin: "https://evil.example.test",
      requestUrl: "https://pulse.example.test/auth/login",
    });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      ok: false,
      code: INVALID_ORIGIN_CODE,
    });
  });

  it("denies login into an org when the user is not a member", async () => {
    const org = createOrg({ name: "Cross Org Route" });
    createFirstPartyUser({
      email: "route-cross-org@example.test",
      password: "cross org route password",
    });

    const app = createApp();
    const loginResponse = await app.request(
      "https://pulse.example.test/auth/login",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://pulse.example.test",
        },
        body: JSON.stringify({
          email: "route-cross-org@example.test",
          password: "cross org route password",
          orgId: org.id,
        }),
      },
    );

    expect(loginResponse.status).toBe(401);
    expect(await loginResponse.json()).toEqual({
      ok: false,
      error: "org_membership_required",
    });
    expect(loginResponse.headers.get("set-cookie")).toBeNull();
  });

  it("allows login into an org when membership exists", async () => {
    const org = createOrg({ name: "Member Org Route" });
    const user = createFirstPartyUser({
      email: "route-member@example.test",
      password: "member route password",
    });
    addMembership(org.id, user.id, "owner");

    const app = createApp();
    const loginResponse = await app.request(
      "https://pulse.example.test/auth/login",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://pulse.example.test",
        },
        body: JSON.stringify({
          email: "route-member@example.test",
          password: "member route password",
          orgId: org.id,
        }),
      },
    );

    expect(loginResponse.status).toBe(200);
    const loginBody = (await loginResponse.json()) as {
      ok: true;
      session: { orgId: string | null };
    };
    expect(loginBody.session.orgId).toBe(org.id);
  });

  it("does not reuse a supplied session cookie during login", async () => {
    createFirstPartyUser({
      email: "fixation@example.test",
      password: "fixation password",
    });

    const app = createApp();
    const firstLogin = await app.request(
      "https://pulse.example.test/auth/login",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://pulse.example.test",
        },
        body: JSON.stringify({
          email: "fixation@example.test",
          password: "fixation password",
        }),
      },
    );
    expect(firstLogin.status).toBe(200);
    const firstBody = (await firstLogin.json()) as {
      ok: true;
      session: { id: string };
    };
    const firstCookie = firstLogin.headers.get("set-cookie")?.split(";")[0];
    expect(firstCookie).toBeTruthy();

    const secondLogin = await app.request(
      "https://pulse.example.test/auth/login",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://pulse.example.test",
          cookie: firstCookie!,
        },
        body: JSON.stringify({
          email: "fixation@example.test",
          password: "fixation password",
        }),
      },
    );
    expect(secondLogin.status).toBe(200);
    const secondBody = (await secondLogin.json()) as {
      ok: true;
      session: { id: string };
    };
    const secondCookie = secondLogin.headers.get("set-cookie")?.split(";")[0];

    expect(secondBody.session.id).not.toBe(firstBody.session.id);
    expect(secondCookie).toBeTruthy();
    expect(secondCookie).not.toBe(firstCookie);
  });

  it("rejects CSRF bundle replay across sessions", async () => {
    createFirstPartyUser({
      email: "csrf-a@example.test",
      password: "csrf replay password a",
    });
    createFirstPartyUser({
      email: "csrf-b@example.test",
      password: "csrf replay password b",
    });

    const app = createApp();
    const loginA = await app.request("https://pulse.example.test/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://pulse.example.test",
      },
      body: JSON.stringify({
        email: "csrf-a@example.test",
        password: "csrf replay password a",
      }),
    });
    const bodyA = (await loginA.json()) as {
      ok: true;
      csrf: { token: string; hash: string };
    };

    const loginB = await app.request("https://pulse.example.test/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://pulse.example.test",
      },
      body: JSON.stringify({
        email: "csrf-b@example.test",
        password: "csrf replay password b",
      }),
    });
    const cookieB = loginB.headers.get("set-cookie")?.split(";")[0];
    expect(cookieB).toBeTruthy();

    const replayResponse = await app.request(
      "https://pulse.example.test/auth/csrf/verify",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://pulse.example.test",
          cookie: cookieB!,
        },
        body: JSON.stringify({
          csrfToken: bodyA.csrf.token,
          csrfHash: bodyA.csrf.hash,
        }),
      },
    );

    expect(replayResponse.status).toBe(200);
    expect(await replayResponse.json()).toEqual({ ok: true, valid: false });
  });
});
