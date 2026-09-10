import "server-only";

import { betterAuth } from "better-auth";

import { getAuthDatabase } from "./auth-db";
import { requireAuthEnvironment } from "./auth-config";

function createAuth() {
  const environment = requireAuthEnvironment();
  return betterAuth({
    database: getAuthDatabase(),
    secret: environment.secret,
    emailAndPassword: {
      enabled: true,
    },
    ...(environment.baseUrl ? { baseURL: environment.baseUrl } : {}),
  });
}

type AuthInstance = ReturnType<typeof createAuth>;
let authInstance: AuthInstance | undefined;

/** Creates the Better Auth instance only when a server operation needs it. */
export function getAuth(): AuthInstance {
  if (!authInstance) authInstance = createAuth();
  return authInstance;
}
