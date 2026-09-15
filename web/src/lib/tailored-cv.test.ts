import { describe, expect, it } from "bun:test";

import {
  analyzeJobs,
  createApplication,
  normalizeJob,
  reanalyzeApplication,
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

  it("uses the Base CV's projects and its visibility toggle, not the raw profile's", async () => {
    const withProject: CandidateProfile = { ...profile(), projects: [{ title: "Internal ticketing tool", description: "Built a support ticketing tool." }] };
    const base = createCandidateBaseCvFromProfile(candidateId, withProject, timestamp);
    if (!base.ok) throw new Error("fixture");
    const store = stores({ profileResult: { ok: true, value: { candidateId, profile: withProject } } });

    const shown = await createTailoredCv({ applicationId }, { ...store, baseCvRepository: baseCvRepository({ ok: true, value: base.value }), createId: () => "project-shown", now: () => timestamp });
    expect(shown.ok).toBe(true);
    if (shown.ok) expect(shown.document.renderedDocument.content).toContain("Internal ticketing tool");

    base.value.visibility.projects = false;
    const hidden = await createTailoredCv({ applicationId }, { ...store, baseCvRepository: baseCvRepository({ ok: true, value: base.value }), createId: () => "project-hidden", now: () => timestamp });
    expect(hidden.ok).toBe(true);
    if (hidden.ok) expect(hidden.document.renderedDocument.content).not.toContain("Internal ticketing tool");
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

  it("includes the authenticated account's email in the CV's contact details when supplied, and omits it entirely when not", async () => {
    const store = stores();
    const withEmail = await createTailoredCv({ applicationId, email: "candidate-a@example.test" }, { ...store, createId: () => "document-email", now: () => timestamp });
    expect(withEmail.ok).toBe(true);
    if (withEmail.ok) expect(withEmail.document.renderedDocument.content).toContain("candidate-a@example.test");

    const withoutEmail = await createTailoredCv({ applicationId }, { ...store, createId: () => "document-no-email", now: () => timestamp });
    expect(withoutEmail.ok).toBe(true);
    if (withoutEmail.ok) expect(withoutEmail.document.renderedDocument.content).not.toContain("@example.test");
  });

  it("creates the next version and preserves the previous record", async () => {
    const store = stores();
    const first = await createTailoredCv({ applicationId }, { ...store, createId: () => "document-1", now: () => timestamp });
    const second = await createTailoredCv({ applicationId }, { ...store, createId: () => "document-2", now: () => "2026-09-06T11:00:00.000Z" });

    expect(first).toMatchObject({ ok: true, document: { version: 1, id: "document-1" } });
    expect(second).toMatchObject({ ok: true, document: { version: 2, id: "document-2" } });
    expect(store.documents.map((document) => document.version)).toEqual([1, 2]);
  });

  it("regenerates a new version from the latest saved profile evidence, while the previous version keeps what it was created from", async () => {
    const store = stores();
    const first = await createTailoredCv({ applicationId }, { ...store, createId: () => "document-1", now: () => timestamp });
    expect(first).toMatchObject({ ok: true, document: { version: 1 } });
    if (!first.ok) throw new Error(first.message);
    expect(first.document.renderedDocument.content).not.toContain("Ansible");

    const updatedProfile: CandidateProfile = { ...profile(), skills: { technical: ["Microsoft 365", "Ansible"], soft: ["Kommunikation"] }, updatedAt: "2026-09-06T10:30:00.000Z" };
    const updatedBase = createCandidateBaseCvFromProfile(candidateId, updatedProfile, updatedProfile.updatedAt!);
    if (!updatedBase.ok) throw new Error("fixture");
    const second = await createTailoredCv(
      { applicationId },
      { ...store, profileRepository: profileRepository({ ok: true, value: { candidateId, profile: updatedProfile } }), baseCvRepository: baseCvRepository({ ok: true, value: updatedBase.value }), createId: () => "document-2", now: () => "2026-09-06T11:00:00.000Z" },
    );
    expect(second).toMatchObject({ ok: true, document: { version: 2 } });
    if (!second.ok) throw new Error(second.message);
    expect(second.document.renderedDocument.content).toContain("Ansible");

    const preservedFirstVersion = store.documents.find((document) => document.version === 1);
    expect(preservedFirstVersion?.renderedDocument.content).not.toContain("Ansible");
  });

  it("only promotes a newly added skill that happens to match a job requirement into a new document version after re-analysis has refreshed which requirements are matched", async () => {
    // Not a design flaw introduced by this phase: application-documents.ts deliberately keeps a
    // document's requirement-support claims consistent with the application's own stored
    // analysisSnapshot (see technicalRequirementStatus/buildRequirementContext), so a job-required
    // skill only "counts" once re-analysis has recorded it as matched - exactly the re-analyze-then-
    // regenerate order this phase's UI enforces for its prominent "Uppdatera dina ansökningsdokument"
    // call to action. A profile fact unrelated to any job requirement (the test above) is never
    // subject to this and always reflects the latest profile immediately.
    const store = stores();
    const updatedProfile: CandidateProfile = { ...profile(), skills: { technical: ["Microsoft 365", "Kubernetes"], soft: ["Kommunikation"] }, updatedAt: "2026-09-06T10:30:00.000Z" };
    const updatedBase = createCandidateBaseCvFromProfile(candidateId, updatedProfile, updatedProfile.updatedAt!);
    if (!updatedBase.ok) throw new Error("fixture");
    const storeWithUpdatedProfile = { ...store, profileRepository: profileRepository({ ok: true, value: { candidateId, profile: updatedProfile } }), baseCvRepository: baseCvRepository({ ok: true, value: updatedBase.value }) };

    const beforeReanalysis = await createTailoredCv({ applicationId }, { ...storeWithUpdatedProfile, createId: () => "document-stale", now: () => "2026-09-06T10:45:00.000Z" });
    expect(beforeReanalysis).toMatchObject({ ok: true });
    if (!beforeReanalysis.ok) throw new Error(beforeReanalysis.message);
    expect(beforeReanalysis.document.renderedDocument.content).not.toContain("Kubernetes");

    const freshRankedJob = analyzeJobs(updatedProfile, [job()]).rankedJobs[0];
    const stored = await store.applicationRepository.getById(applicationId);
    if (!stored.ok) throw new Error("fixture");
    const reanalyzed = reanalyzeApplication(stored.value, { rankedJob: freshRankedJob, timestamp: "2026-09-06T10:50:00.000Z", candidateProfileUpdatedAt: updatedProfile.updatedAt });
    if (!reanalyzed.ok) throw new Error(reanalyzed.error.message);
    await store.applicationRepository.save(reanalyzed.value);

    const afterReanalysis = await createTailoredCv({ applicationId }, { ...storeWithUpdatedProfile, createId: () => "document-fresh", now: () => "2026-09-06T11:00:00.000Z" });
    expect(afterReanalysis).toMatchObject({ ok: true });
    if (!afterReanalysis.ok) throw new Error(afterReanalysis.message);
    expect(afterReanalysis.document.renderedDocument.content).toContain("Kubernetes");
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

describe("a stale analysis blocks CV generation - one rule for both first creation and regeneration", () => {
  function applicationWithAnalyzedProfileTimestamp(candidateProfileUpdatedAt: string): ApplicationRecord {
    const rankedJob = analyzeJobs(profile(), [job()]).rankedJobs[0];
    const created = createApplication({ id: applicationId, rankedJob, createdAt: timestamp, candidateProfileUpdatedAt });
    if (!created.ok) throw new Error(created.error.message);
    return created.value;
  }

  it("blocks first-time CV creation when the profile changed after the stored analysis, and creates no document", async () => {
    const staleApplication = applicationWithAnalyzedProfileTimestamp(timestamp);
    const editedProfile = { ...profile(), updatedAt: "2026-09-06T10:30:00.000Z" };
    const store = stores({ applicationResult: { ok: true, value: staleApplication }, profileResult: { ok: true, value: { candidateId, profile: editedProfile } } });

    const result = await createTailoredCv({ applicationId }, { ...store, createId: () => "document-1", now: () => "2026-09-06T10:45:00.000Z" });

    expect(result).toMatchObject({ ok: false, code: "STALE_ANALYSIS" });
    expect(store.documents).toHaveLength(0);
  });

  it("blocks regeneration of a new version when the profile changed after the stored analysis, and preserves the existing version untouched", async () => {
    const staleApplication = applicationWithAnalyzedProfileTimestamp(timestamp);
    const store = stores({ applicationResult: { ok: true, value: staleApplication } });
    const first = await createTailoredCv({ applicationId }, { ...store, createId: () => "document-1", now: () => timestamp });
    expect(first).toMatchObject({ ok: true, document: { version: 1 } });
    if (!first.ok) throw new Error(first.message);
    const firstContentBefore = first.document.renderedDocument.content;

    const editedProfile = { ...profile(), updatedAt: "2026-09-06T10:30:00.000Z" };
    const blocked = await createTailoredCv(
      { applicationId },
      { ...store, profileRepository: profileRepository({ ok: true, value: { candidateId, profile: editedProfile } } ), createId: () => "document-2", now: () => "2026-09-06T10:45:00.000Z" },
    );

    expect(blocked).toMatchObject({ ok: false, code: "STALE_ANALYSIS" });
    expect(store.documents).toHaveLength(1);
    expect(store.documents[0].renderedDocument.content).toBe(firstContentBefore);
  });

  it("cannot be bypassed by calling createTailoredCv directly with a stale application/profile pair, even without going through any UI form", async () => {
    // The guard lives inside createTailoredCv itself - the shared boundary both the "Dina
    // dokument" and "Uppdatera dina ansökningsdokument" UI call into - so there is no direct
    // dependency-level call path that skips it.
    const staleApplication = applicationWithAnalyzedProfileTimestamp(timestamp);
    const editedProfile = { ...profile(), updatedAt: "2026-09-06T10:30:00.000Z" };
    const store = stores({ applicationResult: { ok: true, value: staleApplication }, profileResult: { ok: true, value: { candidateId, profile: editedProfile } } });
    const result = await createTailoredCv({ applicationId, email: "direct-submission@example.test" }, store);
    expect(result).toMatchObject({ ok: false, code: "STALE_ANALYSIS" });
  });

  it("unblocks generation once re-analysis records the same profile timestamp, and the new document reflects the newly verified skill", async () => {
    const staleApplication = applicationWithAnalyzedProfileTimestamp(timestamp);
    const updatedProfile: CandidateProfile = { ...profile(), skills: { technical: ["Microsoft 365", "Kubernetes"], soft: ["Kommunikation"] }, updatedAt: "2026-09-06T10:30:00.000Z" };
    const updatedBase = createCandidateBaseCvFromProfile(candidateId, updatedProfile, updatedProfile.updatedAt!);
    if (!updatedBase.ok) throw new Error("fixture");
    const freshRankedJob = analyzeJobs(updatedProfile, [job()]).rankedJobs[0];
    const reanalyzed = reanalyzeApplication(staleApplication, { rankedJob: freshRankedJob, timestamp: "2026-09-06T10:50:00.000Z", candidateProfileUpdatedAt: updatedProfile.updatedAt });
    if (!reanalyzed.ok) throw new Error(reanalyzed.error.message);

    const store = stores({
      applicationResult: { ok: true, value: reanalyzed.value },
      profileResult: { ok: true, value: { candidateId, profile: updatedProfile } },
      baseCvResult: { ok: true, value: updatedBase.value },
    });
    const result = await createTailoredCv({ applicationId }, { ...store, createId: () => "document-1", now: () => "2026-09-06T11:00:00.000Z" });

    expect(result).toMatchObject({ ok: true, document: { version: 1 } });
    if (!result.ok) throw new Error(result.message);
    expect(result.document.renderedDocument.content).toContain("Kubernetes");
  });

  it("re-blocks generation after another profile edit that postdates the just-completed re-analysis", async () => {
    const staleApplication = applicationWithAnalyzedProfileTimestamp(timestamp);
    const analyzedProfile = { ...profile(), updatedAt: "2026-09-06T10:30:00.000Z" };
    const freshRankedJob = analyzeJobs(analyzedProfile, [job()]).rankedJobs[0];
    const reanalyzed = reanalyzeApplication(staleApplication, { rankedJob: freshRankedJob, timestamp: "2026-09-06T10:50:00.000Z", candidateProfileUpdatedAt: analyzedProfile.updatedAt });
    if (!reanalyzed.ok) throw new Error(reanalyzed.error.message);

    const editedAgain = { ...profile(), updatedAt: "2026-09-06T11:15:00.000Z" };
    const store = stores({ applicationResult: { ok: true, value: reanalyzed.value }, profileResult: { ok: true, value: { candidateId, profile: editedAgain } } });
    const result = await createTailoredCv({ applicationId }, { ...store, createId: () => "document-1", now: () => "2026-09-06T11:30:00.000Z" });

    expect(result).toMatchObject({ ok: false, code: "STALE_ANALYSIS" });
  });
});
