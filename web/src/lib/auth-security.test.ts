import { readFile } from "node:fs/promises";
import { describe, expect, it } from "bun:test";

const root = new URL("../", import.meta.url);

async function source(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

describe("authentication security boundaries", () => {
  it("uses fixed internal redirects and generic user-facing failures", async () => {
    const form = await source("app/auth/auth-form.tsx");
    const logout = await source("app/auth/logout-form.tsx");
    expect(form).toContain('router.push("/")');
    expect(logout).toContain('router.push("/login")');
    expect(form).not.toMatch(/redirect|returnTo|callbackUrl|next=|continue=/i);
    expect(form).toContain("E-post eller lösenord är felaktigt.");
    expect(form).toContain("Kontot kunde inte skapas.");
    expect(form).not.toMatch(/DATABASE_URL|BETTER_AUTH_SECRET|password hash|stack/i);
  });

  it("keeps auth secrets, database access, and session validation server-side", async () => {
    const auth = await source("lib/auth.ts");
    const db = await source("lib/auth-db.ts");
    const session = await source("lib/auth-session.ts");
    const client = await source("lib/auth-client.ts");
    expect(auth).toContain('import "server-only"');
    expect(db).toContain('import "server-only"');
    expect(session).toContain('import "server-only"');
    expect(session).toContain("getSession");
    expect(session).toContain("headers: await headers()");
    expect(client).not.toContain("BETTER_AUTH_SECRET");
    expect(client).not.toContain("DATABASE_URL");
    expect(client).not.toContain("getAuthDatabase");
    expect(client).not.toContain("localStorage");
    expect(client).not.toContain("sessionStorage");
  });

  it("uses password fields only for Better Auth submission and has no GET auth mutation", async () => {
    const form = await source("app/auth/auth-form.tsx");
    const logout = await source("app/auth/logout-form.tsx");
    const route = await source("app/api/auth/[...all]/route.ts");
    expect(form).toContain("authClient.signUp.email");
    expect(form).toContain("authClient.signIn.email");
    expect(form).toContain('type="password"');
    expect(form).not.toContain("console.");
    expect(logout).toContain("authClient.signOut");
    expect(route).toContain("toNextJsHandler");
    expect(route).toContain("export async function POST");
  });

  it("documents deferred abuse and email hardening without claiming completion", async () => {
    const docs = await readFile(new URL("../../AUTH_DATABASE.md", import.meta.url), "utf8");
    expect(docs).toContain("No distributed or production-grade brute-force limiter is configured");
    expect(docs).toContain("Email verification and password reset are also deferred");
    expect(docs).toContain("origin checks");
    expect(docs).toContain("same-site cookie behavior");
  });
});
