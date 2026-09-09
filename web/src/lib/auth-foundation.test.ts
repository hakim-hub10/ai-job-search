import { readFile } from "node:fs/promises";
import { describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const { MIN_BETTER_AUTH_SECRET_LENGTH, readAuthEnvironment } = await import("./auth-config");
const { createCandidateOwnership } = await import("./candidate-ownership");

const timestamp = "2026-09-10T00:00:00.000Z";
const secret = "synthetic-secret-012345678901234567890123";

async function migration(): Promise<string> {
  return readFile(new URL("../../migrations/0001_auth_and_candidate_ownership.sql", import.meta.url), "utf8");
}

describe("authentication and ownership foundation", () => {
  it("validates server-only configuration without exposing secret values", () => {
    const missing = readAuthEnvironment({});
    expect(missing).toEqual({ ok: false, error: { code: "DATABASE_URL_MISSING", message: "Authentication database configuration is missing." } });
    const weak = readAuthEnvironment({ DATABASE_URL: "postgresql://synthetic", BETTER_AUTH_SECRET: "short" });
    expect(weak.ok).toBe(false);
    expect(JSON.stringify(weak)).not.toContain("short");
    const configured = readAuthEnvironment({ DATABASE_URL: "postgresql://synthetic", BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: "http://localhost:3000" });
    expect(configured).toEqual({ ok: true, value: { databaseUrl: "postgresql://synthetic", secret, baseUrl: "http://localhost:3000" } });
    expect(MIN_BETTER_AUTH_SECRET_LENGTH).toBe(32);
  });

  it("rejects invalid ownership identifiers and relationships", () => {
    expect(createCandidateOwnership({ userId: "", candidateId: "candidate-a", relationship: "owner", createdAt: timestamp }).ok).toBe(false);
    expect(createCandidateOwnership({ userId: "user-a", candidateId: "", relationship: "owner", createdAt: timestamp }).ok).toBe(false);
    expect(createCandidateOwnership({ userId: "user-a", candidateId: "candidate-a", relationship: "coach", createdAt: timestamp }).ok).toBe(false);
    expect(createCandidateOwnership({ userId: "user-a", candidateId: "candidate-a", relationship: "owner", createdAt: "not-a-date" }).ok).toBe(false);
  });

  it("accepts only the MVP owner relationship", () => {
    expect(createCandidateOwnership({ userId: "user-a", candidateId: "candidate-a", relationship: "owner", createdAt: timestamp })).toEqual({ ok: true, value: { userId: "user-a", candidateId: "candidate-a", relationship: "owner", createdAt: timestamp } });
  });

  it("represents both one-user and one-candidate constraints in SQL", async () => {
    const sql = await migration();
    expect(sql).toContain('UNIQUE ("userId", "relationship")');
    expect(sql).toContain('UNIQUE ("candidateId", "relationship")');
    expect(sql).toContain('REFERENCES "user"("id")');
    expect(sql).toContain('CHECK ("relationship" = \'owner\')');
    expect(sql).not.toContain("profile");
    expect(sql).not.toContain("candidate-profiles.json");
  });

  it("keeps authentication and database modules server-only and session identity server-resolved", async () => {
    const [auth, db, session] = await Promise.all([
      readFile(new URL("./auth.ts", import.meta.url), "utf8"),
      readFile(new URL("./auth-db.ts", import.meta.url), "utf8"),
      readFile(new URL("./auth-session.ts", import.meta.url), "utf8"),
    ]);
    expect(auth).toContain('import "server-only"');
    expect(db).toContain('import "server-only"');
    expect(session).toContain('import "server-only"');
    expect(session).toContain("headers: await headers()");
    expect(session).not.toContain("userId:");
    expect(session).not.toContain("clientUserId");
  });

  it("does not require a real database for ordinary foundation tests", () => {
    expect(readAuthEnvironment({ DATABASE_URL: "postgresql://synthetic", BETTER_AUTH_SECRET: secret }).ok).toBe(true);
  });
});
