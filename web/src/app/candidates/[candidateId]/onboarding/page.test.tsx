import { describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/lib/candidate-overview", () => ({
  loadCandidateOperationalOverview: async () => ({
    configured: true,
    error: null,
    candidate: { id: "candidate-a", displayName: "Kandidat A", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    overview: null,
  }),
}));
mock.module("@/lib/authorization", () => ({
  configuredAuthorizationDependencies: () => ({ ok: true, value: {} }),
  requireOwnedCandidate: async () => ({ ok: true, value: { user: { id: "user-a", email: "a@example.test" }, candidate: { id: "candidate-a", displayName: "Kandidat A" } } }),
}));
mock.module("./actions", () => ({
  uploadCandidateOnboardingAction: async () => ({ ok: true, claims: [], importId: "import-a", documentId: "document-a" }),
  applyCandidateOnboardingAction: async () => ({ ok: true, complete: true }),
}));

const { default: OnboardingPage } = await import("./page");

describe("candidate onboarding page", () => {
  it("renders the Swedish upload state without exposing internal architecture or CV text", async () => {
    const html = renderToStaticMarkup(await OnboardingPage({ params: Promise.resolve({ candidateId: "candidate-a" }) }));
    expect(html).toContain("Ladda upp ditt CV");
    expect(html).toContain("PDF eller DOCX, max 5 MB");
    expect(html).toContain("Fortsätt");
    expect(html).not.toContain("CandidateImportClaim");
    expect(html).not.toContain("fingerprint");
    expect(html).not.toContain("Kubernets");
    expect(html).toContain('accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"');
  });
});
