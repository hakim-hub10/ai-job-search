import { readFile } from "node:fs/promises";
import { describe, expect, it } from "bun:test";

describe("personal home entry boundary", () => {
  it("resolves session, owned candidate, and onboarding before rendering personal navigation", async () => {
    const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
    expect(source).toContain("getAuthenticatedUser");
    expect(source).toContain("getOrCreateOwnedCandidateForUser");
    expect(source).toContain("loadCandidateProfile");
    expect(source).toContain("/candidates/${encodeURIComponent(candidateId)}/onboarding");
    expect(source).toContain("/candidates/${encodeURIComponent(candidateId)}");
    expect(source).toContain("/jobs");
    expect(source).toContain("/applications");
    expect(source).not.toContain("loadDashboardData");
    expect(source).not.toContain("/coach");
    expect(source).not.toContain("/reports");
    expect(source).not.toContain("/analytics");
    expect(source).not.toContain("/candidates/new");
  });

  it("removes preview and repository wording from normal-user surfaces", async () => {
    const homeSource = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
    const jobsSource = await readFile(new URL("./jobs/page.tsx", import.meta.url), "utf8");
    const applicationsSource = await readFile(new URL("./applications/page.tsx", import.meta.url), "utf8");
    const applicationDetailSource = await readFile(new URL("./applications/[applicationId]/page.tsx", import.meta.url), "utf8");

    for (const source of [homeSource, jobsSource, applicationsSource, applicationDetailSource]) {
      expect(source).not.toContain("Förhandsversion Sverige");
      expect(source).not.toContain("Lokal förhandsversion");
      expect(source).not.toContain("Lokalt arkiv");
      expect(source).not.toContain("Ansökningsarkivet");
    }

    expect(applicationDetailSource).not.toContain("<strong>ID:</strong>");
  });
});
