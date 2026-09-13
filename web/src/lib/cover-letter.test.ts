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
import type { ApplicationDocumentRecord, ApplicationDocumentRepository } from "../../../.agents/job-search/cli/src/application-document-repository";
import { createCoverLetter } from "./cover-letter";

const timestamp = "2026-09-06T10:00:00.000Z";
const candidateId = "candidate-a";
const applicationId = "application-a";

function profile(): CandidateProfile {
  return {
    headline: "IT-supporttekniker",
    targetRoles: ["IT Support"],
    locationPreferences: ["Jönköping"],
    workMode: "onsite",
    remotePreference: false,
    preferredIndustries: ["IT"],
    preferredEmploymentType: ["full-time"],
    skills: { technical: ["Microsoft 365"], soft: ["Kommunikation"] },
    workExperience: [{ title: "Supporttekniker", company: "Exempel AB", location: "Jönköping", summary: "Arbetade med support." }],
    education: [],
    certifications: ["AZ-900"],
    languages: [{ name: "Svenska", level: "Professionell" }],
    yearsOfExperience: 3,
    careerGoals: [],
    summary: "Erfaren supporttekniker.",
    updatedAt: timestamp,
  };
}

function application(): ApplicationRecord {
  const job: NormalizedJob = normalizeJob({
    id: "job-a",
    title: "IT Support",
    source: "jobtech",
    sourceId: "source-a",
    company: "Exempel AB",
    location: "Jönköping",
    url: "https://example.test/job-a",
    applyUrl: "https://example.test/apply-a",
    description: "Kubernetes is required. Microsoft 365 is useful.",
    skills: ["Kubernetes", "Microsoft 365"],
    remote: "onsite",
    employmentType: "full-time",
    seniority: "mid",
  });
  const created = createApplication({ id: applicationId, rankedJob: analyzeJobs(profile(), [job]).rankedJobs[0], createdAt: timestamp });
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function stores(options: {
  applicationMissing?: boolean;
  associationMissing?: boolean;
  profileMissing?: boolean;
  documentError?: boolean;
} = {}) {
  const app = application();
  const documents: ApplicationDocumentRecord[] = [];
  const applicationRepository: ApplicationRepository = {
    async create(value) { return { ok: true, value }; },
    async save(value) { return { ok: true, value }; },
    async getById() { return options.applicationMissing ? { ok: false, error: { code: "NOT_FOUND", message: "missing" } } : { ok: true, value: app }; },
    async list() { return { ok: true, value: [app] }; },
    async remove() { throw new Error("not used"); },
  };
  const associationRepository: CandidateApplicationAssociationRepository = {
    async create(value) { return { ok: true, value }; },
    async getByApplicationId() { return options.associationMissing ? { ok: false, error: { code: "NOT_FOUND", message: "missing" } } : { ok: true, value: { candidateId, applicationId, createdAt: timestamp } }; },
    async listByCandidateId() { return { ok: true, value: [] }; },
    async deleteByApplicationId() { throw new Error("not used"); },
  };
  const candidateRepository: CoachWorkspaceRepository = {
    async createCandidate() { throw new Error("not used"); },
    async getCandidateById() { return { ok: true, value: { id: candidateId, displayName: "Candidate A", createdAt: timestamp, updatedAt: timestamp } }; },
    async listCandidates() { return { ok: true, value: [] }; },
  };
  const profileRepository: CandidateProfileRepository = {
    async saveProfile() { throw new Error("not used"); },
    async getProfileByCandidateId() { return options.profileMissing ? { ok: false, error: { code: "NOT_FOUND", message: "missing" } } : { ok: true, value: { candidateId, profile: profile() } }; },
    async listProfiles() { return { ok: true, value: [] }; },
  };
  const documentRepository: ApplicationDocumentRepository = {
    async create(value) { documents.push(value); return { ok: true, value }; },
    async getById() { throw new Error("not used"); },
    async listByApplication() { return { ok: true, value: documents }; },
    async listVersions() { return options.documentError ? { ok: false, error: { code: "CORRUPT_STORAGE", message: "corrupt" } } : { ok: true, value: documents }; },
    async getLatest() { throw new Error("not used"); },
    async deleteByApplication() { throw new Error("not used"); },
  };
  return { applicationRepository, associationRepository, candidateRepository, profileRepository, documentRepository, documents };
}

describe("cover letter boundary", () => {
  it("creates a Swedish factual letter with grounded claims and version one", async () => {
    const store = stores();
    const result = await createCoverLetter({ applicationId, language: "sv" }, { ...store, createId: () => "letter-1", now: () => timestamp });

    expect(result).toMatchObject({ ok: true, document: { documentType: "coverLetter", version: 1, language: "sv" } });
    if (!result.ok) throw new Error(result.message);
    expect(result.document.renderedDocument.content).toStartWith("Hej,");
    expect(result.document.renderedDocument.content).toContain("Med vänliga hälsningar");
    expect(result.document.renderedDocument.content).toContain("Microsoft 365");
    expect(result.document.renderedDocument.content).not.toContain("Kubernetes");
    expect(store.documents).toHaveLength(1);
  });

  it("creates version two without changing CV documents", async () => {
    const store = stores();
    const first = await createCoverLetter({ applicationId }, { ...store, createId: () => "letter-1", now: () => timestamp });
    const second = await createCoverLetter({ applicationId }, { ...store, createId: () => "letter-2", now: () => "2026-09-06T11:00:00.000Z" });

    expect(first).toMatchObject({ ok: true, document: { version: 1 } });
    expect(second).toMatchObject({ ok: true, document: { version: 2 } });
    expect(store.documents.every((document) => document.documentType === "coverLetter")).toBe(true);
  });

  it("fails safely for missing inputs and corrupt document storage", async () => {
    const missingApplication = await createCoverLetter({ applicationId }, stores({ applicationMissing: true }));
    const missingAssociation = await createCoverLetter({ applicationId }, stores({ associationMissing: true }));
    const missingProfile = await createCoverLetter({ applicationId }, stores({ profileMissing: true }));
    const corruptDocuments = await createCoverLetter({ applicationId }, stores({ documentError: true }));

    expect(missingApplication).toMatchObject({ ok: false, code: "APPLICATION_NOT_FOUND" });
    expect(missingAssociation).toMatchObject({ ok: false, code: "ASSOCIATION_NOT_FOUND" });
    expect(missingProfile).toMatchObject({ ok: false, code: "PROFILE_NOT_FOUND" });
    expect(corruptDocuments).toMatchObject({ ok: false, code: "DOCUMENT_STORAGE_FAILURE" });
  });

  it("does not change the application or invent personal motivation", async () => {
    const store = stores();
    const before = await store.applicationRepository.getById(applicationId);
    const result = await createCoverLetter({ applicationId }, { ...store, createId: () => "letter-1", now: () => timestamp });
    const after = await store.applicationRepository.getById(applicationId);

    expect(result.ok).toBe(true);
    expect(before).toEqual(after);
    if (result.ok) expect(result.document.renderedDocument.content).not.toContain("alltid drömt");
  });
});
