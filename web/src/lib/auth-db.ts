import "server-only";

import { Pool } from "pg";

import { requireAuthEnvironment } from "./auth-config";

const globalForAuthDb = globalThis as typeof globalThis & {
  __aiCareerAgentAuthPool?: Pool;
};

/** Lazily creates one process-local pool; importing this module never connects. */
export function getAuthDatabase(): Pool {
  if (!globalForAuthDb.__aiCareerAgentAuthPool) {
    const environment = requireAuthEnvironment();
    globalForAuthDb.__aiCareerAgentAuthPool = new Pool({ connectionString: environment.databaseUrl });
  }
  return globalForAuthDb.__aiCareerAgentAuthPool;
}
