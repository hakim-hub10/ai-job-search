import { readFile } from "node:fs/promises";
import { describe, expect, it } from "bun:test";

describe("personal home entry boundary", () => {
  it("resolves session, owned candidate, and onboarding before rendering personal navigation", async () => {
    const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
    expect(source).toContain("getAuthenticatedUser");
    expect(source).toContain("getOrCreateOwnedCandidateForUser");
    expect(source).toContain("loadCandidateProfile");
    expect(source).toContain("/candidates/${encodeURIComponent(owned.value.id)}/onboarding");
    expect(source).toContain("/candidates/${encodeURIComponent(owned.value.id)}");
    expect(source).toContain("/jobs");
    expect(source).toContain("/applications");
    expect(source).not.toContain("loadDashboardData");
    expect(source).not.toContain("/coach");
    expect(source).not.toContain("/reports");
    expect(source).not.toContain("/analytics");
    expect(source).not.toContain("/candidates/new");
  });
});
