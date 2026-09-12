import { readFile } from "node:fs/promises";
import { describe, expect, it } from "bun:test";

const root = new URL("../app/", import.meta.url);

async function source(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

describe("Phase 15.6 real route/action authorization wiring", () => {
  it("guards candidate and onboarding entry points before domain work", async () => {
    const candidateActions = await source("candidates/[candidateId]/actions.ts");
    const profileActions = await source("candidates/[candidateId]/profile-actions.ts");
    const baseCvActions = await source("candidates/[candidateId]/base-cv-actions.ts");
    const onboardingActions = await source("candidates/[candidateId]/onboarding/actions.ts");
    const candidatePage = await source("candidates/[candidateId]/page.tsx");
    expect(candidateActions).toContain("await authorizeCandidate(candidateId)");
    expect(profileActions).toContain("requireOwnedCandidate");
    expect(baseCvActions).toContain("requireOwnedCandidate");
    expect(onboardingActions).toContain("requireOwnedCandidate");
    expect(candidatePage).toContain("requireOwnedCandidate");
  });

  it("guards application, document, and interview entry points through central helpers", async () => {
    const applicationActions = await source("applications/actions.ts");
    const applicationPage = await source("applications/[applicationId]/page.tsx");
    const documentPage = await source("applications/[applicationId]/documents/cv/page.tsx");
    const exportRoute = await source("applications/[applicationId]/documents/export/route.ts");
    const interviewPage = await source("applications/[applicationId]/interview/page.tsx");
    const interviewPreparePage = await source("applications/[applicationId]/interview/prepare/page.tsx");
    const interviewActions = await source("applications/[applicationId]/interview/sessions/actions.ts");
    const resultsPage = await source("applications/[applicationId]/interview/sessions/[sessionId]/results/page.tsx");
    expect(applicationActions).toContain("authorizeApplication");
    expect(applicationPage).toContain("requireOwnedApplication");
    expect(documentPage).toContain("requireOwnedApplication");
    expect(exportRoute).toContain("requireOwnedApplication");
    expect(interviewPage).toContain("requireOwnedApplication");
    expect(interviewPreparePage).toContain("requireOwnedApplication");
    expect(interviewActions).toContain("requireOwnedInterviewSession");
    expect(resultsPage).toContain("requireOwnedInterviewSession");
  });

  it("prevents broad multi-candidate reads and generic second-candidate creation", async () => {
    const home = await source("page.tsx");
    const candidates = await source("candidates/page.tsx");
    const coach = await source("coach/page.tsx");
    const analytics = await source("analytics/page.tsx");
    const reports = await source("reports/page.tsx");
    const candidateCreation = await source("candidates/actions.ts");
    expect(home).toContain("getOrCreateOwnedCandidateForUser");
    expect(candidates).toContain("getAuthorizedCandidateContext");
    // The coach roster must deny ANY authenticated identity, not only one
    // whose personal candidate has already been auto-provisioned - a
    // brand-new user's session passed getAuthorizedCandidateContext's
    // internal check (FORBIDDEN, since no candidate exists yet) and could
    // still reach this global, cross-account roster. getAuthenticatedUser()
    // has no such gap: any active session denies access outright.
    expect(coach).toContain("getAuthenticatedUser");
    expect(analytics).toContain("getAuthorizedCandidateContext");
    expect(reports).toContain("getAuthorizedCandidateContext");
    expect(candidateCreation).toContain("getAuthenticatedUser");
  });
});
