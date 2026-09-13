import { describe, expect, it } from "bun:test";

import {
  createCoachCandidate,
  normalizeJob,
  type ApplicationRecord,
  type ApplicationRepository,
  type CandidateApplicationAssociation,
  type CandidateApplicationAssociationRepository,
  type CoachWorkspaceRepository,
  type NormalizedJob,
} from "../../../.agents/job-search/cli/src/index";
import type { CandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-repository";
import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import { startApplicationFromJob } from "./application-start";

const createdAt = "2026-09-06T10:00:00.000Z";

function candidateProfile(): CandidateProfile {
  return {
    headline: "IT-supporttekniker",
    targetRoles: ["IT Support"],
    locationPreferences: ["Jönköping"],
    workMode: "onsite",
    remotePreference: false,
    preferredEmploymentType: ["full-time"],
    skills: { technical: ["Microsoft 365"], soft: ["Kommunikation"] },
    yearsOfExperience: 3,
    preferredIndustries: [],
    workExperience: [],
    education: [],
    certifications: [],
    languages: [],
    careerGoals: [],
  };
}

function job(): NormalizedJob {
  return normalizeJob({
    id: "job-1",
    title: "IT Support",
    source: "jobtech",
    sourceId: "jobtech-1",
    company: "Exempel AB",
    location: "Jönköping",
    url: "https://example.test/jobs/job-1",
    applyUrl: "https://example.test/apply/job-1",
    employmentType: "full-time",
    remote: "onsite",
    description: "Microsoft 365 and communication are important.",
    skills: ["Microsoft 365"],
    seniority: "mid",
  });
}

function coachCandidate() {
  const result = createCoachCandidate({
    id: "candidate-1",
    displayName: "Test Candidate",
    createdAt,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function dependencies(options: {
  applicationRecords?: ApplicationRecord[];
  associationRecords?: CandidateApplicationAssociation[];
  profileResult?: Awaited<ReturnType<CandidateProfileRepository["getProfileByCandidateId"]>>;
  associationCreateError?: boolean;
} = {}) {
  const candidate = coachCandidate();
  const applicationRecords = new Map(
    (options.applicationRecords ?? []).map((record) => [record.id, structuredClone(record)]),
  );
  const associationRecords = [...(options.associationRecords ?? [])];
  let applicationCreateCalls = 0;

  const candidateRepository: CoachWorkspaceRepository = {
    async createCandidate(value) {
      return { ok: true, value: structuredClone(value) };
    },
    async getCandidateById(id) {
      return id === candidate.id
        ? { ok: true, value: structuredClone(candidate) }
        : { ok: false, error: { code: "NOT_FOUND", message: "missing candidate" } };
    },
    async listCandidates() {
      return { ok: true, value: [structuredClone(candidate)] };
    },
  };

  const profileRepository: CandidateProfileRepository = {
    async saveProfile() {
      throw new Error("not used");
    },
    async getProfileByCandidateId() {
      return options.profileResult ?? {
        ok: true,
        value: { candidateId: candidate.id, profile: candidateProfile() },
      };
    },
    async listProfiles() {
      return { ok: true, value: [] };
    },
  };

  const applicationRepository: ApplicationRepository = {
    async create(record) {
      applicationCreateCalls += 1;
      if (applicationRecords.has(record.id)) {
        return { ok: false, error: { code: "DUPLICATE_ID", message: "duplicate" } };
      }
      applicationRecords.set(record.id, structuredClone(record));
      return { ok: true, value: structuredClone(record) };
    },
    async save(record) {
      applicationRecords.set(record.id, structuredClone(record));
      return { ok: true, value: structuredClone(record) };
    },
    async getById(id) {
      const record = applicationRecords.get(id);
      return record
        ? { ok: true, value: structuredClone(record) }
        : { ok: false, error: { code: "NOT_FOUND", message: "missing application" } };
    },
    async list() {
      return { ok: true, value: [...applicationRecords.values()].map((record) => structuredClone(record)) };
    },
    async remove(id) {
      if (!applicationRecords.has(id)) return { ok: false, error: { code: "NOT_FOUND", message: "missing application" } };
      applicationRecords.delete(id);
      return { ok: true, value: undefined };
    },
  };

  const associationRepository: CandidateApplicationAssociationRepository = {
    async create(value) {
      if (options.associationCreateError) {
        return { ok: false, error: { code: "WRITE_FAILURE", message: "association write failed" } };
      }
      associationRecords.push(structuredClone(value));
      return { ok: true, value: structuredClone(value) };
    },
    async getByApplicationId(applicationId) {
      const association = associationRecords.find((item) => item.applicationId === applicationId);
      return association
        ? { ok: true, value: structuredClone(association) }
        : { ok: false, error: { code: "NOT_FOUND", message: "missing association" } };
    },
    async listByCandidateId(candidateId) {
      return {
        ok: true,
        value: associationRecords.filter((item) => item.candidateId === candidateId).map((item) => structuredClone(item)),
      };
    },
    async deleteByApplicationId(applicationId) {
      const index = associationRecords.findIndex((item) => item.applicationId === applicationId);
      if (index >= 0) associationRecords.splice(index, 1);
      return { ok: true, value: undefined };
    },
  };

  return {
    candidateRepository,
    profileRepository,
    applicationRepository,
    associationRepository,
    applicationRecords,
    associationRecords,
    get applicationCreateCalls() {
      return applicationCreateCalls;
    },
  };
}

function input() {
  return {
    candidateId: "candidate-1",
    jobId: "job-1",
    query: "IT Support",
    location: "Jönköping",
    limit: 10,
  };
}

function searchDependency() {
  return async (searchInput: { targetRoles?: string[] }) => {
    expect(searchInput.targetRoles).toBeUndefined();
    return {
      ok: true as const,
      jobs: [job()],
      totalRetrieved: 1,
      sourceStatus: [],
    };
  };
}

describe("web application start boundary", () => {
  it("creates an application from a trusted re-fetched job and associates the candidate", async () => {
    const store = dependencies();
    const result = await startApplicationFromJob(input(), {
      ...store,
      searchJobs: searchDependency(),
      createId: () => "application-1",
      now: () => createdAt,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.application).toMatchObject({
      id: "application-1",
      status: "saved",
      jobSnapshot: {
        id: "job-1",
        source: "jobtech",
        sourceId: "jobtech-1",
        url: "https://example.test/jobs/job-1",
      },
    });
    expect(store.associationRecords).toEqual([
      { candidateId: "candidate-1", applicationId: "application-1", createdAt },
    ]);
  });

  it("fails before application creation for an unknown candidate or malformed input", async () => {
    const store = dependencies();
    let searchCalls = 0;
    const searchJobs = async () => {
      searchCalls += 1;
      return { ok: true as const, jobs: [job()], totalRetrieved: 1, sourceStatus: [] };
    };

    const unknown = await startApplicationFromJob(
      { ...input(), candidateId: "missing" },
      { ...store, searchJobs },
    );
    const malformed = await startApplicationFromJob(
      { ...input(), limit: 0 },
      { ...store, searchJobs },
    );

    expect(unknown).toMatchObject({ ok: false, code: "CANDIDATE_NOT_FOUND" });
    expect(malformed).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(searchCalls).toBe(0);
    expect(store.applicationCreateCalls).toBe(0);
  });

  it("returns an explicit duplicate advisory without creating another record", async () => {
    const firstStore = dependencies();
    const first = await startApplicationFromJob(input(), {
      ...firstStore,
      searchJobs: searchDependency(),
      createId: () => "application-1",
      now: () => createdAt,
    });
    expect(first.ok).toBe(true);

    const repeatedStore = dependencies({
      applicationRecords: [...firstStore.applicationRecords.values()],
      associationRecords: firstStore.associationRecords,
    });
    const repeated = await startApplicationFromJob(input(), {
      ...repeatedStore,
      searchJobs: searchDependency(),
      createId: () => "application-2",
      now: () => createdAt,
    });

    expect(repeated).toMatchObject({ ok: false, code: "DUPLICATE_APPLICATION", applicationId: "application-1" });
    expect(repeatedStore.applicationCreateCalls).toBe(0);
  });

  it("reports an association failure and preserves the created application ID", async () => {
    const store = dependencies({ associationCreateError: true });
    const result = await startApplicationFromJob(input(), {
      ...store,
      searchJobs: searchDependency(),
      createId: () => "application-1",
      now: () => createdAt,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "APPLICATION_ASSOCIATION_FAILED",
      applicationId: "application-1",
    });
    expect(store.applicationRecords.has("application-1")).toBe(true);
  });

  it("does not generate or submit documents as part of application creation", async () => {
    const store = dependencies();
    const result = await startApplicationFromJob(input(), {
      ...store,
      searchJobs: searchDependency(),
      createId: () => "application-1",
      now: () => createdAt,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.application.notes).toEqual([]);
    expect(result.application.statusHistory).toEqual([{ status: "saved", timestamp: createdAt }]);
  });
});
