import "server-only";

export const MIN_BETTER_AUTH_SECRET_LENGTH = 32;

export interface AuthEnvironment {
  databaseUrl: string;
  secret: string;
  baseUrl?: string;
}

export type AuthEnvironmentErrorCode = "DATABASE_URL_MISSING" | "BETTER_AUTH_SECRET_MISSING" | "BETTER_AUTH_SECRET_WEAK";

export type AuthEnvironmentResult =
  | { ok: true; value: AuthEnvironment }
  | { ok: false; error: { code: AuthEnvironmentErrorCode; message: string } };

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export function readAuthEnvironment(environment: EnvironmentSource = process.env): AuthEnvironmentResult {
  const databaseUrl = environment.DATABASE_URL?.trim() ?? "";
  const secret = environment.BETTER_AUTH_SECRET?.trim() ?? "";
  const baseUrl = environment.BETTER_AUTH_URL?.trim() || undefined;

  if (!databaseUrl) return { ok: false, error: { code: "DATABASE_URL_MISSING", message: "Authentication database configuration is missing." } };
  if (!secret) return { ok: false, error: { code: "BETTER_AUTH_SECRET_MISSING", message: "Authentication secret configuration is missing." } };
  if (secret.length < MIN_BETTER_AUTH_SECRET_LENGTH) return { ok: false, error: { code: "BETTER_AUTH_SECRET_WEAK", message: "Authentication secret configuration is too weak." } };
  return { ok: true, value: { databaseUrl, secret, ...(baseUrl ? { baseUrl } : {}) } };
}

export function requireAuthEnvironment(environment: EnvironmentSource = process.env): AuthEnvironment {
  const result = readAuthEnvironment(environment);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
