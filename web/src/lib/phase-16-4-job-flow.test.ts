import { readFile } from "node:fs/promises";
import { describe, expect, it } from "bun:test";

const root = new URL("../app/", import.meta.url);

async function source(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

describe("Phase 16.4 job to application boundary", () => {
  it("shows a clear application CTA on ranked results without a candidate selector", async () => {
    const page = await source("jobs/page.tsx");
    expect(page).toContain("Skapa ansökan");
    expect(page).not.toContain('name="candidateId"');
    expect(page).toContain("getAuthorizedCandidateContext");
    expect(page).toContain("${job.source}:${job.id}");
  });

  it("derives the application candidate from the authenticated context", async () => {
    const action = await source("jobs/actions.ts");
    expect(action).toContain("getAuthorizedCandidateContext");
    expect(action).toContain("const candidateId = owned.value.candidate.id");
    expect(action).not.toContain('formText(formData, "candidateId")');
    expect(action).toContain("startApplicationFromJob");
    expect(action).toContain("redirect(`/applications/");
  });
});
