import { describe, expect, it, mock } from "bun:test";

const claim = {
  id: "claim-a",
  candidateId: "candidate-a",
  importId: "import-a",
  documentId: "document-a",
  kind: "technicalSkill" as const,
  value: "Kubernetes",
  source: "cv-text" as const,
  status: "proposed" as const,
  provenance: { section: "Technical Skills", snippet: "SECRET RAW CV TEXT", line: 4 },
};

mock.module("server-only", () => ({}));
mock.module("../../../../../../.agents/job-search/cli/src/coach-cli-paths", () => ({
  resolveCoachRepositoryPaths: () => ({ candidates: "synthetic-candidates.json", candidateProfiles: "synthetic-profiles.json" }),
}));
mock.module("../../../../../../.agents/job-search/cli/src/coach-workspace-file-repository", () => ({
  createFileCoachWorkspaceRepository: () => ({ getCandidateById: async () => ({ ok: true, value: { id: "candidate-a" } }) }),
}));
mock.module("@/lib/candidate-import-upload", () => ({
  validateCandidateImportUpload: () => ({ ok: true, value: { id: "import-a", document: { id: "document-a", format: "pdf" } } }),
}));
mock.module("@/lib/candidate-import-pdf", () => ({
  extractCandidateImportPdf: async () => ({ ok: true, value: { text: "SECRET RAW CV TEXT", trust: "untrusted" } }),
}));
mock.module("@/lib/candidate-import-docx", () => ({ extractCandidateImportDocx: async () => ({ ok: false, error: { code: "NO_EXTRACTABLE_TEXT" } }) }));
mock.module("@/lib/candidate-import-claims", () => ({
  extractCandidateImportClaims: async () => ({ ok: true, value: { claims: [claim] } }),
}));

const { uploadCandidateOnboardingAction } = await import("./actions");

describe("onboarding client data boundary", () => {
  it("returns only safe claim views and never raw provenance or extracted CV text", async () => {
    process.env.COACH_DIR = "/synthetic-coach";
    const formData = new FormData();
    formData.set("candidateId", "candidate-a");
    formData.set("cv", new File(["synthetic"], "resume.pdf", { type: "application/pdf" }));
    const result = await uploadCandidateOnboardingAction(formData);
    expect(result.ok).toBe(true);
    expect(result.ok && "claims" in result ? result.claims : []).toEqual([{ id: "claim-a", kind: "technicalSkill", value: "Kubernetes", source: "cv-text" }]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("SECRET RAW CV TEXT");
    expect(serialized).not.toContain("provenance");
    expect(serialized).not.toContain("snippet");
  });
});
