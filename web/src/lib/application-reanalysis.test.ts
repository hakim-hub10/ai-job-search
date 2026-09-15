import { describe, expect, it } from "bun:test";

import {
  analyzeJobs,
  createApplication,
  normalizeJob,
  type ApplicationRecord,
  type ApplicationRepository,
  type CandidateApplicationAssociationRepository,
  type CoachWorkspaceRepository,
  type NormalizedJob,
} from "../../../.agents/job-search/cli/src/index";
import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import type { CandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-repository";
import { isApplicationAnalysisStale, reanalyzeApplicationJob } from "./application-reanalysis";

const timestamp = "2026-09-14T10:00:00.000Z";
const candidateId = "candidate-a";
const applicationId = "application-a";

function profile(overrides: Partial<CandidateProfile> = {}): CandidateProfile {
  return {
    headline: "IT-supporttekniker",
    targetRoles: ["IT Support"],
    locationPreferences: ["Jönköping"],
    workMode: "onsite",
    remotePreference: false,
    preferredIndustries: ["IT"],
    preferredEmploymentType: ["full-time"],
    skills: { technical: ["Microsoft 365"], soft: ["Kommunikation"] },
    workExperience: [],
    education: [],
    certifications: [],
    languages: [{ name: "Svenska", level: "Professionell" }],
    yearsOfExperience: 3,
    careerGoals: [],
    summary: undefined,
    updatedAt: timestamp,
    ...overrides,
  };
}

function job(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return normalizeJob({
    id: "job-a",
    title: "IT Support",
    source: "jobtech",
    sourceId: "source-a",
    company: "Exempel AB",
    location: "Jönköping",
    url: "https://example.test/job-a",
    applyUrl: "https://example.test/apply-a",
    description: "Active Directory is required. Microsoft 365 is useful.",
    skills: ["Active Directory", "Microsoft 365"],
    remote: "onsite",
    employmentType: "full-time",
    seniority: "mid",
    ...overrides,
  });
}

function application(candidateProfile = profile(), theJob = job()): ApplicationRecord {
  const rankedJob = analyzeJobs(candidateProfile, [theJob]).rankedJobs[0];
  const created = createApplication({ id: applicationId, rankedJob, createdAt: timestamp, candidateProfileUpdatedAt: candidateProfile.updatedAt });
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function stores(options: {
  applicationResult?: Awaited<ReturnType<ApplicationRepository["getById"]>>;
  associationResult?: Awaited<ReturnType<CandidateApplicationAssociationRepository["getByApplicationId"]>>;
  profileResult?: Awaited<ReturnType<CandidateProfileRepository["getProfileByCandidateId"]>>;
  seed?: ApplicationRecord;
} = {}) {
  const applications = new Map<string, ApplicationRecord>([[applicationId, options.seed ?? application()]]);
  const applicationRepository: ApplicationRepository = {
    async create(value) { applications.set(value.id, value); return { ok: true, value }; },
    async save(value) { applications.set(value.id, value); return { ok: true, value }; },
    async getById(id) {
      return options.applicationResult ?? (applications.get(id)
        ? { ok: true, value: applications.get(id)! }
        : { ok: false, error: { code: "NOT_FOUND", message: "missing application" } });
    },
    async list() { return { ok: true, value: [...applications.values()] }; },
    async remove() { throw new Error("not used"); },
  };
  const associationRepository: CandidateApplicationAssociationRepository = {
    async create(value) { return { ok: true, value }; },
    async getByApplicationId() {
      return options.associationResult ?? { ok: true, value: { candidateId, applicationId, createdAt: timestamp } };
    },
    async listByCandidateId() { return { ok: true, value: [] }; },
    async deleteByApplicationId() { throw new Error("not used"); },
  };
  const candidateRepository: CoachWorkspaceRepository = {
    async createCandidate() { throw new Error("not used"); },
    async getCandidateById(id) {
      return id === candidateId
        ? { ok: true, value: { id, displayName: "Candidate A", createdAt: timestamp, updatedAt: timestamp } }
        : { ok: false, error: { code: "NOT_FOUND", message: "missing candidate" } };
    },
    async listCandidates() { return { ok: true, value: [] }; },
  };
  const profileRepository: CandidateProfileRepository = {
    async saveProfile() { throw new Error("not used"); },
    async getProfileByCandidateId() { return options.profileResult ?? { ok: true, value: { candidateId, profile: profile() } }; },
    async listProfiles() { return { ok: true, value: [] }; },
  };
  return { applicationRepository, associationRepository, candidateRepository, profileRepository, applications };
}

describe("re-analyze job boundary", () => {
  it("reuses the existing matching pipeline against the application's own jobSnapshot, using the latest candidate profile", async () => {
    const seed = application(profile({ skills: { technical: ["Microsoft 365"], soft: [] } }));
    expect(seed.analysisSnapshot.matchingResult.matchedDimensions).not.toContain("technicalSkills");

    const improvedProfile = profile({ skills: { technical: ["Microsoft 365", "Active Directory"], soft: [] }, updatedAt: "2026-09-15T10:00:00.000Z" });
    const store = stores({ seed, profileResult: { ok: true, value: { candidateId, profile: improvedProfile } } });
    const result = await reanalyzeApplicationJob({ applicationId }, { ...store, now: () => "2026-09-16T10:00:00.000Z" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.application.analysisSnapshot.matchingResult.matchedDimensions).toContain("technicalSkills");
    expect(result.application.analysisSnapshot.analyzedAt).toBe("2026-09-16T10:00:00.000Z");
    expect(result.application.analysisSnapshot.candidateProfileUpdatedAt).toBe("2026-09-15T10:00:00.000Z");
  });

  it("uses the application's original jobSnapshot unchanged, never a different or re-fetched job", async () => {
    const seed = application();
    const store = stores({ seed });
    const result = await reanalyzeApplicationJob({ applicationId }, { ...store, now: () => "2026-09-16T10:00:00.000Z" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.application.jobSnapshot).toEqual(seed.jobSnapshot);
  });

  it("never fabricates an unsupported job requirement into a candidate fact: technical skill coverage still reflects only real evidence", async () => {
    const store = stores();
    const result = await reanalyzeApplicationJob({ applicationId }, { ...store, now: () => "2026-09-16T10:00:00.000Z" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const technical = result.application.analysisSnapshot.matchingResult.matched.find((e) => e.dimension === "technicalSkills")
      ?? result.application.analysisSnapshot.matchingResult.missing.find((e) => e.dimension === "technicalSkills");
    expect(technical?.requirementCoverage?.matchedRequirements ?? []).not.toContain("Active Directory");
  });

  it("preserves the previous analysis when re-analysis fails, and never persists a partial result", async () => {
    const seed = application();
    const store = stores({ seed, profileResult: { ok: false, error: { code: "NOT_FOUND", message: "missing" } } });
    const result = await reanalyzeApplicationJob({ applicationId }, store);
    expect(result).toMatchObject({ ok: false, code: "PROFILE_NOT_FOUND" });
    expect(store.applications.get(applicationId)).toEqual(seed);
  });

  it("fails safely for missing application, association, candidate, and profile storage", async () => {
    expect(await reanalyzeApplicationJob({ applicationId }, stores({ applicationResult: { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }))).toMatchObject({ ok: false, code: "APPLICATION_NOT_FOUND" });
    expect(await reanalyzeApplicationJob({ applicationId }, stores({ associationResult: { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }))).toMatchObject({ ok: false, code: "ASSOCIATION_NOT_FOUND" });
    expect(await reanalyzeApplicationJob({ applicationId }, stores({ profileResult: { ok: false, error: { code: "CORRUPT_STORAGE", message: "corrupt" } } }))).toMatchObject({ ok: false, code: "PROFILE_STORAGE_FAILURE" });
  });

  it("rejects an empty application ID before any repository access", async () => {
    const store = stores();
    const result = await reanalyzeApplicationJob({ applicationId: "   " }, store);
    expect(result).toMatchObject({ ok: false, code: "INVALID_APPLICATION_ID" });
  });
});

describe("stale-analysis detection", () => {
  it("flags stale only when both timestamps are known and the profile was edited after the analysis", () => {
    const application = { analysisSnapshot: { candidateProfileUpdatedAt: "2026-09-10T10:00:00.000Z" } } as never;
    expect(isApplicationAnalysisStale(application, "2026-09-11T10:00:00.000Z")).toBe(true);
    expect(isApplicationAnalysisStale(application, "2026-09-10T10:00:00.000Z")).toBe(false);
    expect(isApplicationAnalysisStale(application, "2026-09-09T10:00:00.000Z")).toBe(false);
  });

  it("never flags stale when either timestamp is unknown - a record from before this metadata existed is never guessed at", () => {
    const withoutAnalysisTimestamp = { analysisSnapshot: {} } as never;
    expect(isApplicationAnalysisStale(withoutAnalysisTimestamp, "2026-09-11T10:00:00.000Z")).toBe(false);
    const withAnalysisTimestamp = { analysisSnapshot: { candidateProfileUpdatedAt: "2026-09-10T10:00:00.000Z" } } as never;
    expect(isApplicationAnalysisStale(withAnalysisTimestamp, undefined)).toBe(false);
  });

  it("clears after a successful re-analysis, then becomes stale again after a further profile edit - through the real end-to-end sequence", async () => {
    const seed = application();
    const store = stores({ seed });

    const editedProfile = profile({ skills: { technical: ["Microsoft 365", "Active Directory"], soft: [] }, updatedAt: "2026-09-15T10:00:00.000Z" });
    expect(isApplicationAnalysisStale(seed, editedProfile.updatedAt)).toBe(true);

    const reanalyzed = await reanalyzeApplicationJob(
      { applicationId },
      { ...store, profileRepository: { ...store.profileRepository, getProfileByCandidateId: async () => ({ ok: true, value: { candidateId, profile: editedProfile } }) }, now: () => "2026-09-16T10:00:00.000Z" },
    );
    expect(reanalyzed.ok).toBe(true);
    if (!reanalyzed.ok) return;
    expect(isApplicationAnalysisStale(reanalyzed.application, editedProfile.updatedAt)).toBe(false);

    const editedAgain = profile({ skills: { technical: ["Microsoft 365", "Active Directory", "ServiceNow"], soft: [] }, updatedAt: "2026-09-17T10:00:00.000Z" });
    expect(isApplicationAnalysisStale(reanalyzed.application, editedAgain.updatedAt)).toBe(true);
  });
});
