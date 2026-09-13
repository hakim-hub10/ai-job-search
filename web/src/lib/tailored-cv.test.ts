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
import type { CandidateBaseCvRepository } from "./candidate-base-cv-repository";
import { createCandidateBaseCvFromProfile, synchronizeCandidateBaseCv } from "./candidate-base-cv";
import { createTailoredCv } from "./tailored-cv";
import type { ApplicationDocumentRecord, ApplicationDocumentRepository } from "../../../.agents/job-search/cli/src/application-document-repository";

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

function job(): NormalizedJob {
  return normalizeJob({
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
}

function application(): ApplicationRecord {
  const rankedJob = analyzeJobs(profile(), [job()]).rankedJobs[0];
  const created = createApplication({ id: applicationId, rankedJob, createdAt: timestamp });
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function candidateRepository(): CoachWorkspaceRepository {
  return {
    async createCandidate() { throw new Error("not used"); },
    async getCandidateById(id) {
      return id === candidateId
        ? { ok: true, value: { id, displayName: "Candidate A", createdAt: timestamp, updatedAt: timestamp } }
        : { ok: false, error: { code: "NOT_FOUND", message: "missing candidate" } };
    },
    async listCandidates() { return { ok: true, value: [] }; },
  };
}

function profileRepository(result: Awaited<ReturnType<CandidateProfileRepository["getProfileByCandidateId"]>> = { ok: true, value: { candidateId, profile: profile() } }): CandidateProfileRepository {
  return {
    async saveProfile() { throw new Error("not used"); },
    async getProfileByCandidateId() { return result; },
    async listProfiles() { return { ok: true, value: [] }; },
  };
}

function baseCvRepository(result: Awaited<ReturnType<CandidateBaseCvRepository["getByCandidateId"]>> = (() => {
  const created = createCandidateBaseCvFromProfile(candidateId, profile(), timestamp);
  if (!created.ok) throw new Error(created.error.message);
  return { ok: true, value: created.value };
})()): CandidateBaseCvRepository {
  return {
    async save(value) { return { ok: true, value }; },
    async getByCandidateId() { return result; },
  };
}

function stores(options: {
  applicationResult?: Awaited<ReturnType<ApplicationRepository["getById"]>>;
  associationResult?: Awaited<ReturnType<CandidateApplicationAssociationRepository["getByApplicationId"]>>;
  profileResult?: Awaited<ReturnType<CandidateProfileRepository["getProfileByCandidateId"]>>;
  baseCvResult?: Awaited<ReturnType<CandidateBaseCvRepository["getByCandidateId"]>>;
  documentListError?: boolean;
} = {}) {
  const applications = new Map<string, ApplicationRecord>([[applicationId, application()]]);
  const documents: ApplicationDocumentRecord[] = [];
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
  const documentRepository: ApplicationDocumentRepository = {
    async create(value) { documents.push(value); return { ok: true, value }; },
    async getById(id) { const value = documents.find((item) => item.id === id); return value ? { ok: true, value } : { ok: false, error: { code: "NOT_FOUND", message: "missing document" } }; },
    async listByApplication(id) { return { ok: true, value: documents.filter((item) => item.applicationId === id) }; },
    async listVersions(id, type) {
      return options.documentListError
        ? { ok: false, error: { code: "CORRUPT_STORAGE", message: "corrupt documents" } }
        : { ok: true, value: documents.filter((item) => item.applicationId === id && item.documentType === type) };
    },
    async getLatest(id, type) { const value = documents.filter((item) => item.applicationId === id && item.documentType === type).at(-1); return value ? { ok: true, value } : { ok: false, error: { code: "NOT_FOUND", message: "missing document" } }; },
    async deleteByApplication() { throw new Error("not used"); },
  };
  return {
    applicationRepository,
    associationRepository: {
      async create(value) { return { ok: true, value }; },
      async getByApplicationId() {
        return options.associationResult ?? { ok: true, value: { candidateId, applicationId, createdAt: timestamp } };
      },
      async listByCandidateId() { return { ok: true, value: [] }; },
      async deleteByApplicationId() { throw new Error("not used"); },
    } as CandidateApplicationAssociationRepository,
    candidateRepository: candidateRepository(),
    profileRepository: profileRepository(options.profileResult),
    baseCvRepository: baseCvRepository(options.baseCvResult),
    documentRepository,
    documents,
  };
}

describe("tailored CV boundary", () => {
  it("renders structured profile evidence after Base CV synchronization", async () => {
    const completed = { ...profile(), education: [{ degree: "YH", field: "IT", institution: "Synthetic School", startYear: 2020, endYear: 2022 }] };
    const synced = synchronizeCandidateBaseCv(candidateId, completed, null, null, timestamp);
    if (!synced.ok) throw new Error("fixture");
    const store = stores({ profileResult: { ok: true, value: { candidateId, profile: completed } }, baseCvResult: { ok: true, value: synced.value } });
    const result = await createTailoredCv({ applicationId }, { ...store, createId: () => "complete-cv", now: () => timestamp });
    if (!result.ok) throw new Error(result.message);
    const content = result.document.renderedDocument.content;
    for (const fact of [completed.headline, completed.summary!, "Exempel AB", "Synthetic School", "Microsoft 365", "AZ-900", "Svenska"]) expect(content).toContain(fact);
    expect(content).not.toContain("Kubernetes");
  });

  it("retains complete visible structured evidence without promoting unsupported job skills", async () => {
    const complete: CandidateProfile = {
      ...profile(),
      skills: {
        technical: ["Domain tool A", "Domain tool B", "Domain tool C"],
        soft: ["Collaboration", "Planning"],
      },
      certifications: ["Professional credential A", "Professional credential B"],
      languages: [
        { name: "Language A", level: "Fluent" },
        { name: "Language B", level: "Professional" },
      ],
      workExperience: [
        { title: "Role A", company: "Organization A", location: "City A", summary: "Delivered service A." },
        { title: "Role B", company: "Organization B", location: "City B", summary: "Delivered service B." },
      ],
      education: [
        { degree: "Diploma A", field: "Field A", institution: "School A" },
        { degree: "Diploma B", field: "Field B", institution: "School B" },
      ],
    };
    const completeJob = normalizeJob({
      ...job(),
      skills: ["Unsupported job skill"],
      description: "Unsupported job skill is required.",
    });
    const rankedJob = analyzeJobs(complete, [completeJob]).rankedJobs[0];
    if (!rankedJob) throw new Error("fixture");
    const created = createApplication({ id: applicationId, rankedJob, createdAt: timestamp });
    if (!created.ok) throw new Error("fixture");
    const base = createCandidateBaseCvFromProfile(candidateId, complete, timestamp);
    if (!base.ok) throw new Error("fixture");
    const store = stores({
      applicationResult: { ok: true, value: created.value },
      profileResult: { ok: true, value: { candidateId, profile: complete } },
      baseCvResult: { ok: true, value: base.value },
    });

    const result = await createTailoredCv({ applicationId }, { ...store, createId: () => "complete-cv", now: () => timestamp });
    if (!result.ok) throw new Error(result.message);
    const content = result.document.renderedDocument.content;
    for (const fact of [
      "Domain tool A", "Domain tool B", "Domain tool C", "Collaboration", "Planning",
      "Professional credential A", "Professional credential B", "Language A", "Language B",
      "Organization A", "Organization B", "School A", "School B",
    ]) expect(content).toContain(fact);
    expect(content).not.toContain("Unsupported job skill");
  });

  it("respects an explicitly hidden authored Base CV summary", async () => {
    const store = stores();
    const base = createCandidateBaseCvFromProfile(candidateId, profile(), timestamp);
    if (!base.ok) throw new Error("fixture");
    base.value.visibility.summary = false;
    const result = await createTailoredCv({ applicationId }, { ...store, baseCvRepository: baseCvRepository({ ok: true, value: base.value }), createId: () => "hidden-summary", now: () => timestamp });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.renderedDocument.content).not.toContain(profile().summary!);
      expect(result.document.generatedDocument.sections.find(section => section.kind === "summary")?.claims).toHaveLength(1);
    }
  });

  it("creates a deterministic CV with version one and no invented job skill", async () => {
    const store = stores();
    const result = await createTailoredCv({ applicationId }, { ...store, createId: () => "document-1", now: () => timestamp });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.document).toMatchObject({ applicationId, documentType: "cv", version: 1, language: "en" });
    expect(result.document.renderedDocument.content).toContain("Microsoft 365");
    expect(result.document.renderedDocument.content).not.toContain("Kubernetes");
    expect(store.documents).toHaveLength(1);
  });

  it("creates the next version and preserves the previous record", async () => {
    const store = stores();
    const first = await createTailoredCv({ applicationId }, { ...store, createId: () => "document-1", now: () => timestamp });
    const second = await createTailoredCv({ applicationId }, { ...store, createId: () => "document-2", now: () => "2026-09-06T11:00:00.000Z" });

    expect(first).toMatchObject({ ok: true, document: { version: 1, id: "document-1" } });
    expect(second).toMatchObject({ ok: true, document: { version: 2, id: "document-2" } });
    expect(store.documents.map((document) => document.version)).toEqual([1, 2]);
  });

  it("honors an explicit Swedish selection over English auto-detection from the job description", async () => {
    const store = stores();
    const result = await createTailoredCv({ applicationId, language: "sv" }, { ...store, createId: () => "document-1", now: () => timestamp });

    expect(result).toMatchObject({ ok: true, document: { language: "sv" } });
  });

  it("preserves each version's own explicit language and leaves matching untouched across a language switch", async () => {
    const store = stores();
    const first = await createTailoredCv({ applicationId, language: "sv" }, { ...store, createId: () => "document-1", now: () => timestamp });
    const second = await createTailoredCv({ applicationId, language: "en" }, { ...store, createId: () => "document-2", now: () => "2026-09-06T11:00:00.000Z" });

    expect(first).toMatchObject({ ok: true, document: { version: 1, language: "sv" } });
    expect(second).toMatchObject({ ok: true, document: { version: 2, language: "en" } });
    if (!first.ok || !second.ok) throw new Error("expected both versions to succeed");
    for (const document of [first.document, second.document]) {
      expect(document.renderedDocument.content).toContain("Microsoft 365");
      expect(document.renderedDocument.content).not.toContain("Kubernetes");
    }
    expect(second.document.generatedDocument.sections.flatMap((section) => section.claims.flatMap((claim) => claim.evidenceIds)).sort())
      .toEqual(first.document.generatedDocument.sections.flatMap((section) => section.claims.flatMap((claim) => claim.evidenceIds)).sort());
  });

  it("fails explicitly for missing application, association, profile, and Base CV", async () => {
    const missingApplication = await createTailoredCv({ applicationId }, { ...stores({ applicationResult: { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }) });
    const missingAssociation = await createTailoredCv({ applicationId }, { ...stores({ associationResult: { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }) });
    const missingProfile = await createTailoredCv({ applicationId }, { ...stores({ profileResult: { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }) });
    const missingBaseCv = await createTailoredCv({ applicationId }, { ...stores({ baseCvResult: { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }) });

    expect(missingApplication).toMatchObject({ ok: false, code: "APPLICATION_NOT_FOUND" });
    expect(missingAssociation).toMatchObject({ ok: false, code: "ASSOCIATION_NOT_FOUND" });
    expect(missingProfile).toMatchObject({ ok: false, code: "PROFILE_NOT_FOUND" });
    expect(missingBaseCv).toMatchObject({ ok: false, code: "BASE_CV_NOT_FOUND" });
  });

  it("fails safely for corrupt Base CV and document storage", async () => {
    const corruptBaseCv = await createTailoredCv({ applicationId }, {
      ...stores({ baseCvResult: { ok: false, error: { code: "CORRUPT_STORAGE", message: "corrupt Base CV" } } }),
    });
    const corruptDocuments = await createTailoredCv({ applicationId }, {
      ...stores({ documentListError: true }),
    });

    expect(corruptBaseCv).toMatchObject({ ok: false, code: "BASE_CV_STORAGE_FAILURE" });
    expect(corruptDocuments).toMatchObject({ ok: false, code: "DOCUMENT_STORAGE_FAILURE" });
  });

  it("does not change application status or call an external provider", async () => {
    const store = stores();
    const before = (await store.applicationRepository.getById(applicationId));
    const result = await createTailoredCv({ applicationId }, { ...store, createId: () => "document-1", now: () => timestamp });
    const after = await store.applicationRepository.getById(applicationId);

    expect(result.ok).toBe(true);
    expect(before).toEqual(after);
  });
});
