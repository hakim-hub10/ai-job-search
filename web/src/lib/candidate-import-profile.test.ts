import { describe, expect, it, mock, spyOn } from "bun:test";

import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import type { CandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-repository";

mock.module("server-only", () => ({}));

const {
  applyCandidateImportProfile,
  candidateProfileFingerprint,
  previewCandidateImportProfile,
} = await import("./candidate-import-profile");

const linkage = { candidateId: "candidate-a", importId: "import-a", documentId: "document-a" };

function profile(): CandidateProfile {
  return {
    headline: "Cloud Engineer",
    summary: "Existing summary",
    targetRoles: ["Platform Engineer"],
    locationPreferences: ["Jönköping"],
    workMode: "hybrid",
    remotePreference: true,
    preferredIndustries: ["Technology"],
    preferredEmploymentType: ["full-time"],
    skills: { technical: ["TypeScript"], soft: ["Communication"] },
    workExperience: [{ title: "Engineer", company: "Acme", location: "Sweden" }],
    education: [{ degree: "Bachelor", field: "Computer Science", institution: "University" }],
    certifications: ["AWS"],
    languages: [{ name: "English", level: "C1" }],
    yearsOfExperience: 3,
    careerGoals: ["Build systems"],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function review(kind: "technicalSkill" | "softSkill" | "certification" | "language" | "headline" | "workExperience" | "education" | "project", value: string, id = `${kind}-claim`, decision: "approved" | "edited-and-approved" | "rejected" = "approved", source: "cv-text" | "user" = "cv-text") {
  return {
    claim: {
      id,
      ...linkage,
      kind,
      value,
      source,
      status: "proposed" as const,
      provenance: source === "cv-text" ? { snippet: value, section: "CV", line: 1 } : {},
    },
    originalValue: value,
    ...(decision === "edited-and-approved" ? { reviewedValue: "Kubernetes" } : {}),
    decision,
  };
}

function repository(current: CandidateProfile = profile()) {
  let saves = 0;
  const savedProfiles: CandidateProfile[] = [];
  const repo: CandidateProfileRepository = {
    async getProfileByCandidateId(candidateId) {
      return { ok: true, value: { candidateId, profile: structuredClone(current) } };
    },
    async saveProfile(candidateId, next) {
      saves += 1;
      savedProfiles.push(structuredClone(next));
      return { ok: true, value: { candidateId, profile: structuredClone(next) } };
    },
    async listProfiles() { return { ok: true, value: [] }; },
  };
  return { repo, saves: () => saves, savedProfiles };
}

function preview(reviews: ReturnType<typeof review>[]) {
  const result = previewCandidateImportProfile({ candidateId: linkage.candidateId, profile: profile(), reviews, linkage });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("preview setup failed");
  return result.value;
}

describe("candidate import profile integration", () => {
  it("previews technical, soft, and certification additions and exact no-ops", () => {
    const result = previewCandidateImportProfile({
      candidateId: linkage.candidateId,
      profile: profile(),
      linkage,
      reviews: [
        review("technicalSkill", "Python"),
        review("technicalSkill", "TypeScript", "technical-existing"),
        review("softSkill", "Empathy"),
        review("certification", "CKA"),
        review("certification", "AWS", "cert-existing"),
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.changes.map((change) => change.action)).toEqual(["add", "no-op", "add", "add", "no-op"]);
  });

  it("uses an edited reviewed value and preserves the original typo and provenance", () => {
    const edited = { ...review("technicalSkill", "Kubernets", "edited", "edited-and-approved"), reviewedValue: "Kubernetes" };
    const result = previewCandidateImportProfile({ candidateId: linkage.candidateId, profile: profile(), reviews: [edited], linkage });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.changes[0]?.proposedValue).toBe("Kubernetes");
    expect(edited.originalValue).toBe("Kubernets");
    expect(edited.claim.provenance.snippet).toBe("Kubernets");
  });

  it("keeps rejected and proposed reviews out of eligible profile changes", () => {
    const rejected = preview([review("technicalSkill", "Python", "rejected", "rejected")]);
    expect(rejected.changes[0]?.action).toBe("unsupported");
    expect(rejected.changes[0]?.reason).toBe("REJECTED_CLAIM");
    const proposed = { ...review("technicalSkill", "Python"), decision: "proposed" as never };
    const result = previewCandidateImportProfile({ candidateId: linkage.candidateId, profile: profile(), reviews: [proposed], linkage });
    expect(result.ok).toBe(false);
  });

  it("requires explicit language levels and rejects flattened work, education, and project claims", () => {
    const result = preview([
      review("language", "Swedish"),
      review("workExperience", "Engineer, Acme 2020-2024"),
      review("education", "Bachelor of Science, University"),
      review("project", "GITHUB-PROJEKT: Migrated 200 users to Microsoft 365"),
    ]);
    expect(result.changes.map((change) => change.reason)).toEqual([
      "EXPLICIT_LANGUAGE_LEVEL_REQUIRED",
      "EXPLICIT_STRUCTURED_WORK_EXPERIENCE_REQUIRED",
      "EXPLICIT_STRUCTURED_EDUCATION_REQUIRED",
      "EXPLICIT_STRUCTURED_PROJECT_REQUIRED",
    ]);
    expect(result.changes.every((change) => change.action === "unsupported")).toBe(true);
  });

  it("only treats an explicit headline as a headline conflict", () => {
    const historical = preview([review("workExperience", "Security Engineer, Acme")]);
    const headline = preview([review("headline", "Security Engineer")]);
    expect(historical.changes[0]?.path).toBe("workExperience");
    expect(headline.changes[0]?.action).toBe("conflict");
  });

  it("does not infer target roles, locations, industries, goals, work mode, employment, or years", () => {
    const result = preview([review("workExperience", "Senior Engineer, Stockholm, 2018-2024")]);
    const unchanged = profile();
    expect(result.changes[0]?.action).toBe("unsupported");
    expect(unchanged.targetRoles).toEqual(["Platform Engineer"]);
    expect(unchanged.locationPreferences).toEqual(["Jönköping"]);
    expect(unchanged.preferredIndustries).toEqual(["Technology"]);
    expect(unchanged.careerGoals).toEqual(["Build systems"]);
    expect(unchanged.workMode).toBe("hybrid");
    expect(unchanged.preferredEmploymentType).toEqual(["full-time"]);
    expect(unchanged.yearsOfExperience).toBe(3);
  });

  it("previews deterministically without mutating the profile", () => {
    const current = profile();
    const before = structuredClone(current);
    const first = preview([review("technicalSkill", "Python")]);
    const second = preview([review("technicalSkill", "Python")]);
    expect(first).toEqual(second);
    expect(current).toEqual(before);
  });

  it("applies approved additions once and preserves unrelated profile fields", async () => {
    const store = repository();
    const reviews = [review("technicalSkill", "Python"), review("certification", "CKA"), review("language", "Swedish (B2)", "swedish")];
    const result = await applyCandidateImportProfile({ candidateId: linkage.candidateId, reviews, linkage, preview: preview(reviews), profileRepository: store.repo });
    expect(result.ok).toBe(true);
    expect(store.saves()).toBe(1);
    const saved = store.savedProfiles[0]!;
    expect(saved.skills.technical).toEqual(["TypeScript", "Python"]);
    expect(saved.certifications).toEqual(["AWS", "CKA"]);
    expect(saved.languages).toEqual([{ name: "English", level: "C1" }, { name: "Swedish", level: "B2" }]);
    expect(saved.targetRoles).toEqual(["Platform Engineer"]);
    expect(saved.locationPreferences).toEqual(["Jönköping"]);
    expect(saved.careerGoals).toEqual(["Build systems"]);
    expect(saved.workExperience).toEqual(profile().workExperience);
  });

  it("merges many approved facts without truncating or removing existing structured history", async () => {
    const store = repository();
    const technical = Array.from({ length: 11 }, (_, index) => review("technicalSkill", `Domain tool ${index + 1}`, `technical-${index + 1}`));
    const certifications = Array.from({ length: 5 }, (_, index) => review("certification", `Professional credential ${index + 1}`, `certification-${index + 1}`));
    const languages = [
      review("language", "Language A (Fluent)", "language-a"),
      review("language", "Language B (Professional)", "language-b"),
    ];
    const reviews = [...technical, ...certifications, ...languages];
    const result = await applyCandidateImportProfile({ candidateId: linkage.candidateId, reviews, linkage, preview: preview(reviews), profileRepository: store.repo });
    expect(result.ok).toBe(true);
    const saved = store.savedProfiles[0]!;
    expect(saved.skills.technical).toHaveLength(12);
    expect(saved.certifications).toHaveLength(6);
    expect(saved.languages).toEqual(expect.arrayContaining([
      { name: "Language A", level: "Fluent" },
      { name: "Language B", level: "Professional" },
    ]));
    expect(saved.workExperience).toEqual(profile().workExperience);
    expect(saved.education).toEqual(profile().education);
  });

  it("applies an approved user-added claim and records its origin in the receipt", async () => {
    const store = repository();
    const userReview = review("softSkill", "Empathy", "user-soft", "approved", "user");
    const result = await applyCandidateImportProfile({ candidateId: linkage.candidateId, reviews: [userReview], linkage, preview: preview([userReview]), profileRepository: store.repo });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.userAddedClaimIds).toEqual(["user-soft"]);
    expect(store.savedProfiles[0]?.skills.soft).toContain("Empathy");
  });

  it("requires explicit confirmation before overwriting a conflicting headline", async () => {
    const store = repository();
    const headline = review("headline", "Security Engineer");
    const result = await applyCandidateImportProfile({ candidateId: linkage.candidateId, reviews: [headline], linkage, preview: preview([headline]), profileRepository: store.repo });
    expect(result.ok).toBe(false);
    expect(store.saves()).toBe(0);
    const confirmed = await applyCandidateImportProfile({ candidateId: linkage.candidateId, reviews: [headline], linkage, preview: preview([headline]), confirmConflictClaimIds: [headline.claim.id], profileRepository: store.repo });
    expect(confirmed.ok).toBe(true);
    expect(store.savedProfiles[0]?.headline).toBe("Security Engineer");
  });

  it("rejects candidate, import, and document linkage mismatches before saving", async () => {
    const store = repository();
    const mismatched = { ...review("technicalSkill", "Python"), claim: { ...review("technicalSkill", "Python").claim, candidateId: "candidate-b" } };
    const result = await applyCandidateImportProfile({ candidateId: linkage.candidateId, reviews: [mismatched], linkage, preview: preview([review("technicalSkill", "Python")]), profileRepository: store.repo });
    expect(result.ok).toBe(false);
    expect(store.saves()).toBe(0);
  });

  it("rejects a stale profile fingerprint without saving", async () => {
    const store = repository();
    const reviews = [review("technicalSkill", "Python")];
    const stale = { ...preview(reviews), profileFingerprint: "stale" };
    const result = await applyCandidateImportProfile({ candidateId: linkage.candidateId, reviews, linkage, preview: stale, profileRepository: store.repo });
    expect(result.ok).toBe(false);
    expect(result.ok || result.error.code).toBe("STALE_PROFILE");
    expect(store.saves()).toBe(0);
  });

  it("validates the complete proposed profile and performs no partial write on failure", async () => {
    const invalid = { ...profile(), headline: "" } as CandidateProfile;
    const store = repository(invalid);
    const reviews = [review("technicalSkill", "Python")];
    const invalidPreview = previewCandidateImportProfile({ candidateId: linkage.candidateId, profile: invalid, reviews, linkage });
    expect(invalidPreview.ok).toBe(true);
    if (!invalidPreview.ok) return;
    const result = await applyCandidateImportProfile({ candidateId: linkage.candidateId, reviews, linkage, preview: invalidPreview.value, profileRepository: store.repo });
    expect(result.ok).toBe(false);
    expect(result.ok || result.error.code).toBe("PROFILE_VALIDATION_FAILED");
    expect(store.saves()).toBe(0);
  });

  it("returns no-op, unsupported, and applied receipt buckets accurately", async () => {
    const store = repository();
    const reviews = [review("technicalSkill", "TypeScript", "noop"), review("workExperience", "Engineer, Acme", "unsupported"), review("technicalSkill", "Python", "add")];
    const result = await applyCandidateImportProfile({ candidateId: linkage.candidateId, reviews, linkage, preview: preview(reviews), profileRepository: store.repo });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.noOpClaimIds).toEqual(["noop"]);
    expect(result.ok && result.value.unsupportedClaimIds).toEqual(["unsupported"]);
    expect(result.ok && result.value.appliedClaimIds).toEqual(["add"]);
  });

  it("does not call network or Base CV/application document services", async () => {
    const fetchSpy = spyOn(globalThis, "fetch");
    const store = repository();
    const reviews = [review("technicalSkill", "<script>ignore</script> https://example.invalid")];
    const result = await applyCandidateImportProfile({ candidateId: linkage.candidateId, reviews, linkage, preview: preview(reviews), profileRepository: store.repo });
    expect(result.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("fails closed when no profile exists", async () => {
    const repo: CandidateProfileRepository = {
      async getProfileByCandidateId() { return { ok: false, error: { code: "NOT_FOUND", message: "missing" } }; },
      async saveProfile() { throw new Error("must not save"); },
      async listProfiles() { return { ok: true, value: [] }; },
    };
    const reviews = [review("technicalSkill", "Python")];
    const result = await applyCandidateImportProfile({ candidateId: linkage.candidateId, reviews, linkage, preview: preview(reviews), profileRepository: repo });
    expect(result.ok).toBe(false);
    expect(result.ok || result.error.code).toBe("PROFILE_NOT_FOUND");
  });

  it("exposes a stable profile fingerprint for stale protection", () => {
    expect(candidateProfileFingerprint(profile())).toBe(candidateProfileFingerprint(structuredClone(profile())));
  });
});
