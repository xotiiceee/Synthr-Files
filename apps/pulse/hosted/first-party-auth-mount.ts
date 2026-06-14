import type { Hono } from "hono";

import {
  createFirstPartyAuthRouteHandlers,
  type FirstPartyAuthRouteOptions,
} from "./first-party-auth-routes.js";
import {
  isFirstPartyAuthEnabled,
  resolveAuthProviderName,
} from "./sessions.js";

export function registerFirstPartyAuthRoutes(
  app: Hono,
  options: FirstPartyAuthRouteOptions = {},
): boolean {
  const authProvider = resolveAuthProviderName(options.authProvider);
  if (!isFirstPartyAuthEnabled(authProvider)) return false;

  const handlers = createFirstPartyAuthRouteHandlers({
    ...options,
    authProvider,
  });

  app.post("/auth/login", handlers.login);
  app.post("/auth/logout", handlers.logout);
  app.get("/auth/session", handlers.session);
  app.post("/auth/csrf/verify", handlers.verifyCsrf);
  app.post("/auth/signup", handlers.signup);
  app.get("/auth/verify", handlers.verifyEmail);

  return true;
}
