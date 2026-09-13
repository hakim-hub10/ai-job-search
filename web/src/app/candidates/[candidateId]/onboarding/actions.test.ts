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
mock.module("@/lib/authorization", () => ({
  configuredAuthorizationDependencies: () => ({ ok: true, value: {} }),
  requireOwnedCandidate: async () => ({ ok: true, value: { user: { id: "user-a", email: "a@example.test" }, candidate: { id: "candidate-a", displayName: "Candidate A" } } }),
}));
mock.module("../../../../../../.agents/job-search/cli/src/coach-cli-paths", () => ({
  resolveCoachRepositoryPaths: () => ({ candidates: "synthetic-candidates.json", candidateProfiles: "synthetic-profiles.json" }),
}));
mock.module("../../../../../../.agents/job-search/cli/src/coach-workspace-file-repository", () => ({
  createFileCoachWorkspaceRepository: () => ({ getCandidateById: async () => ({ ok: true, value: { id: "candidate-a" } }) }),
}));
const profile = {
  headline: "Cloud Engineer",
  targetRoles: ["Platform Engineer"],
  locationPreferences: ["Stockholm"],
  workMode: "hybrid",
  remotePreference: true,
  preferredIndustries: ["Technology"],
  preferredEmploymentType: ["full-time"],
  skills: { technical: ["Python"], soft: ["Communication"] },
  workExperience: [{ title: "Engineer", company: "Acme", location: "Sweden" }],
  education: [{ degree: "Bachelor", field: "Computer Science", institution: "University" }],
  certifications: ["AWS"],
  languages: [{ name: "English", level: "C1" }],
  yearsOfExperience: 4,
  careerGoals: ["Build systems"],
  summary: "Existing profile summary",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
let savedProfile = structuredClone(profile);
let profileExists = true;
let profileReadError: string | null = null;
let savedBaseCv: Record<string, unknown> | null = {
  candidateId: "candidate-a",
  source: "candidateProfile",
  headline: "Cloud Engineer",
  summary: "Manual Base CV summary",
  workExperience: profile.workExperience,
  education: profile.education,
  technicalSkills: ["Python"],
  softSkills: ["Communication"],
  certifications: ["AWS"],
  languages: profile.languages,
  visibility: { headline: true, summary: true, workExperience: true, education: true, technicalSkills: true, softSkills: true, certifications: true, languages: true },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
mock.module("../../../../../../.agents/job-search/cli/src/candidate-profile-file-repository", () => ({
  createFileCandidateProfileRepository: () => ({
    getProfileByCandidateId: async () => profileReadError
      ? { ok: false as const, error: { code: profileReadError, message: "Candidate profile storage could not be read." } }
      : profileExists
        ? { ok: true as const, value: { candidateId: "candidate-a", profile: structuredClone(savedProfile) } }
        : { ok: false as const, error: { code: "NOT_FOUND", message: "Candidate profile was not found." } },
    saveProfile: async (_candidateId: string, next: typeof profile) => {
      savedProfile = structuredClone(next);
      profileExists = true;
      return { ok: true as const, value: { candidateId: "candidate-a", profile: structuredClone(next) } };
    },
    listProfiles: async () => profileExists
      ? { ok: true as const, value: [{ candidateId: "candidate-a", profile: structuredClone(savedProfile) }] }
      : { ok: true as const, value: [] },
  }),
}));
mock.module("@/lib/candidate-base-cv-file-repository", () => ({
  createFileCandidateBaseCvRepository: () => ({
    getByCandidateId: async () => ({ ok: true, value: structuredClone(savedBaseCv) }),
    save: async (next: Record<string, unknown>) => { savedBaseCv = structuredClone(next); return { ok: true, value: structuredClone(next) }; },
  }),
}));
mock.module("@/lib/candidate-import-upload", () => ({
  validateCandidateImportUpload: (input: { filename: string }) => ({ ok: true, value: { id: "import-a", document: { id: "document-a", format: input.filename.endsWith(".docx") ? "docx" : "pdf" } } }),
}));
mock.module("@/lib/candidate-import-pdf", () => ({
  extractCandidateImportPdf: async () => ({ ok: true, value: { text: "SECRET RAW CV TEXT", trust: "untrusted" } }),
}));
mock.module("@/lib/candidate-import-docx", () => ({ extractCandidateImportDocx: async () => ({ ok: true, value: { text: "SECRET RAW CV TEXT", trust: "untrusted" } }) }));
mock.module("@/lib/candidate-import-claims", () => ({
  extractCandidateImportClaims: async () => ({ ok: true, value: { claims: [claim, { ...claim, id: "claim-edit", value: "Kubernets" }, { ...claim, id: "claim-reject", value: "Unwanted" }] } }),
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
    expect(result.ok && "claims" in result ? result.claims : []).toHaveLength(3);
    expect(result.ok && "claims" in result ? result.claims[0] : undefined).toEqual({ id: "claim-a", kind: "technicalSkill", value: "Kubernetes", source: "cv-text" });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("SECRET RAW CV TEXT");
    expect(serialized).not.toContain("provenance");
    expect(serialized).not.toContain("snippet");
  });

  it("uses the same safe claim view for a synthetic DOCX upload", async () => {
    process.env.COACH_DIR = "/synthetic-coach";
    const formData = new FormData();
    formData.set("candidateId", "candidate-a");
    formData.set("cv", new File(["synthetic"], "resume.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    const result = await uploadCandidateOnboardingAction(formData);
    expect(result.ok).toBe(true);
    expect(result.ok && "claims" in result ? result.claims[0] : undefined).toEqual({ id: "claim-a", kind: "technicalSkill", value: "Kubernetes", source: "cv-text" });
  });

  it("fails closed for a missing session and forged claim IDs", async () => {
    process.env.COACH_DIR = "/synthetic-coach";
    const missing = new FormData();
    missing.set("candidateId", "candidate-a");
    missing.set("importId", "missing-session");
    missing.set("documentId", "document-a");
    missing.set("reviews", "[]");
    missing.set("added", "[]");
    const missingResult = await (await import("./actions")).applyCandidateOnboardingAction(missing);
    expect(missingResult.ok).toBe(false);

    const upload = new FormData();
    upload.set("candidateId", "candidate-a");
    upload.set("cv", new File(["synthetic"], "resume.pdf", { type: "application/pdf" }));
    const uploaded = await uploadCandidateOnboardingAction(upload);
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok || !("claims" in uploaded)) return;
    const forged = new FormData();
    forged.set("candidateId", "candidate-a");
    forged.set("importId", uploaded.importId);
    forged.set("documentId", uploaded.documentId);
    forged.set("reviews", JSON.stringify([{ claimId: "forged-claim", decision: "approved", reviewedValue: "Forged provenance" }]));
    forged.set("added", "[]");
    const forgedResult = await (await import("./actions")).applyCandidateOnboardingAction(forged);
    expect(forgedResult.ok).toBe(false);
  });

  it("completes approve/edit/reject/add through profile and Base CV boundaries", async () => {
    savedProfile = structuredClone(profile);
    profileExists = true;
    const upload = new FormData();
    upload.set("candidateId", "candidate-a");
    upload.set("cv", new File(["synthetic"], "resume.pdf", { type: "application/pdf" }));
    const uploaded = await uploadCandidateOnboardingAction(upload);
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok || !("claims" in uploaded)) return;
    const apply = new FormData();
    apply.set("candidateId", "candidate-a");
    apply.set("importId", uploaded.importId);
    apply.set("documentId", uploaded.documentId);
    apply.set("reviews", JSON.stringify([
      { claimId: "claim-a", decision: "approved" },
      { claimId: "claim-edit", decision: "edited-and-approved", reviewedValue: "Kubernetes 1.30" },
      { claimId: "claim-reject", decision: "rejected" },
    ]));
    apply.set("added", JSON.stringify([{ kind: "softSkill", value: "Empathy", decision: "approved" }]));
    const result = await (await import("./actions")).applyCandidateOnboardingAction(apply);
    expect(result).toEqual({ ok: true, complete: true });
    expect(savedProfile.skills.technical).toEqual(["Python", "Kubernetes", "Kubernetes 1.30"]);
    expect(savedProfile.skills.technical).not.toContain("Unwanted");
    expect(savedProfile.skills.soft).toContain("Empathy");
    expect(savedBaseCv?.summary).toBe("Manual Base CV summary");
    expect(savedBaseCv?.technicalSkills).toContain("Kubernetes 1.30");
  });

  it("initializes, saves, and reads back a first-time profile before completing onboarding", async () => {
    profileReadError = null;
    profileExists = false;
    savedBaseCv = null;
    const upload = new FormData();
    upload.set("candidateId", "candidate-a");
    upload.set("cv", new File(["synthetic"], "resume.pdf", { type: "application/pdf" }));
    const uploaded = await uploadCandidateOnboardingAction(upload);
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok || !("claims" in uploaded)) return;
    const apply = new FormData();
    apply.set("candidateId", "candidate-a");
    apply.set("importId", uploaded.importId);
    apply.set("documentId", uploaded.documentId);
    apply.set("reviews", JSON.stringify([{ claimId: "claim-a", decision: "approved" }]));
    apply.set("added", JSON.stringify([{ kind: "technicalSkill", value: "azur solution architect", decision: "approved" }]));
    apply.set("structuredProfile", JSON.stringify({ headline: "Cloud Engineer", summary: "User-confirmed summary", workExperience: profile.workExperience, education: profile.education }));
    const result = await (await import("./actions")).applyCandidateOnboardingAction(apply);
    expect(result).toEqual({ ok: true, complete: true });
    expect(profileExists).toBe(true);
    expect(savedProfile.skills.technical).toEqual(["Kubernetes", "azur solution architect"]);
    const repository = (await import("../../../../../../.agents/job-search/cli/src/candidate-profile-file-repository")).createFileCandidateProfileRepository("synthetic-profiles.json");
    const records = await repository.listProfiles();
    expect(records.ok && records.value).toHaveLength(1);
    expect(savedBaseCv).not.toBeNull();
    expect(savedProfile.headline).toBe("Cloud Engineer");
    expect(savedProfile.workExperience).toEqual(profile.workExperience);
    expect(savedProfile.education).toEqual(profile.education);
    expect((savedBaseCv as Record<string, unknown> | null)?.workExperience).toEqual(profile.workExperience);
    expect((savedBaseCv as Record<string, unknown> | null)?.education).toEqual(profile.education);
  });

  it("keeps profile repository read failures fatal", async () => {
    profileExists = true;
    profileReadError = "READ_FAILURE";
    const upload = new FormData();
    upload.set("candidateId", "candidate-a");
    upload.set("cv", new File(["synthetic"], "resume.pdf", { type: "application/pdf" }));
    const uploaded = await uploadCandidateOnboardingAction(upload);
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok || !("claims" in uploaded)) return;
    const apply = new FormData();
    apply.set("candidateId", "candidate-a");
    apply.set("importId", uploaded.importId);
    apply.set("documentId", uploaded.documentId);
    apply.set("reviews", "[]");
    apply.set("added", "[]");
    const result = await (await import("./actions")).applyCandidateOnboardingAction(apply);
    expect(result).toEqual({ ok: false, code: "PROFILE_READ_FAILED", message: "Din profil kunde inte läsas." });
    profileReadError = null;
  });
});
