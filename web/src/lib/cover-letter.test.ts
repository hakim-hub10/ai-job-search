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
import type { ApplicationDocumentRecord, ApplicationDocumentRepository } from "../../../.agents/job-search/cli/src/application-document-repository";
import type { CandidateBaseCvRepository } from "./candidate-base-cv-repository";
import { createCandidateBaseCvFromProfile } from "./candidate-base-cv";
import { createCoverLetter } from "./cover-letter";
import { createTailoredCv } from "./tailored-cv";

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

function application(candidateProfileUpdatedAt?: string): ApplicationRecord {
  const created = createApplication({ id: applicationId, rankedJob: analyzeJobs(profile(), [job()]).rankedJobs[0], createdAt: timestamp, ...(candidateProfileUpdatedAt ? { candidateProfileUpdatedAt } : {}) });
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function baseCvRepository(result?: Awaited<ReturnType<CandidateBaseCvRepository["getByCandidateId"]>>): CandidateBaseCvRepository {
  const fallback = (() => {
    const created = createCandidateBaseCvFromProfile(candidateId, profile(), timestamp);
    if (!created.ok) throw new Error(created.error.message);
    return { ok: true, value: created.value } as const;
  })();
  return {
    async save(value) { return { ok: true, value }; },
    async getByCandidateId() { return result ?? fallback; },
  };
}

function stores(options: {
  applicationMissing?: boolean;
  associationMissing?: boolean;
  profileMissing?: boolean;
  documentError?: boolean;
  baseCvResult?: Awaited<ReturnType<CandidateBaseCvRepository["getByCandidateId"]>>;
  applicationOverride?: ApplicationRecord;
  profileOverride?: CandidateProfile;
} = {}) {
  const app = options.applicationOverride ?? application();
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
    async getProfileByCandidateId() { return options.profileMissing ? { ok: false, error: { code: "NOT_FOUND", message: "missing" } } : { ok: true, value: { candidateId, profile: options.profileOverride ?? profile() } }; },
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
  return { applicationRepository, associationRepository, candidateRepository, profileRepository, baseCvRepository: baseCvRepository(options.baseCvResult), documentRepository, documents };
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

  it("includes the authenticated account's email in the cover letter's contact details when supplied, and omits it entirely when not", async () => {
    const store = stores();
    const withEmail = await createCoverLetter({ applicationId, email: "candidate-a@example.test" }, { ...store, createId: () => "letter-email", now: () => timestamp });
    expect(withEmail.ok).toBe(true);
    if (withEmail.ok) expect(withEmail.document.renderedDocument.content).toContain("candidate-a@example.test");

    const withoutEmail = await createCoverLetter({ applicationId }, { ...store, createId: () => "letter-no-email", now: () => timestamp });
    expect(withoutEmail.ok).toBe(true);
    if (withoutEmail.ok) expect(withoutEmail.document.renderedDocument.content).not.toContain("@example.test");
  });

  it("creates version two without changing CV documents", async () => {
    const store = stores();
    const first = await createCoverLetter({ applicationId }, { ...store, createId: () => "letter-1", now: () => timestamp });
    const second = await createCoverLetter({ applicationId }, { ...store, createId: () => "letter-2", now: () => "2026-09-06T11:00:00.000Z" });

    expect(first).toMatchObject({ ok: true, document: { version: 1 } });
    expect(second).toMatchObject({ ok: true, document: { version: 2 } });
    expect(store.documents.every((document) => document.documentType === "coverLetter")).toBe(true);
  });

  it("creates an explicit English letter with English grounded claims", async () => {
    const store = stores();
    const result = await createCoverLetter({ applicationId, language: "en" }, { ...store, createId: () => "letter-1", now: () => timestamp });

    expect(result).toMatchObject({ ok: true, document: { documentType: "coverLetter", version: 1, language: "en" } });
    if (!result.ok) throw new Error(result.message);
    expect(result.document.renderedDocument.content).toStartWith("Dear Hiring Manager,");
    expect(result.document.renderedDocument.content).toContain("Kind regards,");
    expect(result.document.renderedDocument.content).toContain("Microsoft 365");
    expect(result.document.renderedDocument.content).not.toContain("Kubernetes");
  });

  it("preserves each version's own explicit language and leaves matching untouched across a language switch", async () => {
    const store = stores();
    const first = await createCoverLetter({ applicationId, language: "sv" }, { ...store, createId: () => "letter-1", now: () => timestamp });
    const second = await createCoverLetter({ applicationId, language: "en" }, { ...store, createId: () => "letter-2", now: () => "2026-09-06T11:00:00.000Z" });

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

  it("fails safely for missing inputs, missing/corrupt Base CV, and corrupt document storage", async () => {
    const missingApplication = await createCoverLetter({ applicationId }, stores({ applicationMissing: true }));
    const missingAssociation = await createCoverLetter({ applicationId }, stores({ associationMissing: true }));
    const missingProfile = await createCoverLetter({ applicationId }, stores({ profileMissing: true }));
    const missingBaseCv = await createCoverLetter({ applicationId }, stores({ baseCvResult: { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }));
    const corruptBaseCv = await createCoverLetter({ applicationId }, stores({ baseCvResult: { ok: false, error: { code: "CORRUPT_STORAGE", message: "corrupt" } } }));
    const corruptDocuments = await createCoverLetter({ applicationId }, stores({ documentError: true }));

    expect(missingApplication).toMatchObject({ ok: false, code: "APPLICATION_NOT_FOUND" });
    expect(missingAssociation).toMatchObject({ ok: false, code: "ASSOCIATION_NOT_FOUND" });
    expect(missingProfile).toMatchObject({ ok: false, code: "PROFILE_NOT_FOUND" });
    expect(missingBaseCv).toMatchObject({ ok: false, code: "BASE_CV_NOT_FOUND" });
    expect(corruptBaseCv).toMatchObject({ ok: false, code: "BASE_CV_STORAGE_FAILURE" });
    expect(corruptDocuments).toMatchObject({ ok: false, code: "DOCUMENT_STORAGE_FAILURE" });
  });

  it("respects Base CV visibility and edits, not the raw profile - an edited employer is used, and hiding work experience removes it", async () => {
    const base = createCandidateBaseCvFromProfile(candidateId, profile(), timestamp);
    if (!base.ok) throw new Error("fixture");
    base.value.workExperience = [{ ...base.value.workExperience[0], company: "Base CV Edited Employer AB" }];
    const store = stores({ baseCvResult: { ok: true, value: base.value } });

    const edited = await createCoverLetter({ applicationId }, { ...store, createId: () => "letter-edited", now: () => timestamp });
    expect(edited.ok).toBe(true);
    if (edited.ok) expect(edited.document.renderedDocument.content).toContain("Base CV Edited Employer AB");

    base.value.visibility.workExperience = false;
    const hidden = await createCoverLetter({ applicationId }, { ...store, baseCvRepository: baseCvRepository({ ok: true, value: base.value }), createId: () => "letter-hidden", now: () => "2026-09-06T11:00:00.000Z" });
    expect(hidden.ok).toBe(true);
    if (hidden.ok) expect(hidden.document.renderedDocument.content).not.toContain("Base CV Edited Employer AB");
  });

  it("shares the same approved candidate + Base CV evidence universe as the CV: a Base-CV-hidden certification never appears in either document", async () => {
    const base = createCandidateBaseCvFromProfile(candidateId, profile(), timestamp);
    if (!base.ok) throw new Error("fixture");
    base.value.visibility.certifications = false;
    const store = stores({ baseCvResult: { ok: true, value: base.value } });

    const letter = await createCoverLetter({ applicationId }, { ...store, createId: () => "letter-1", now: () => timestamp });
    const cv = await createTailoredCv({ applicationId }, { ...store, createId: () => "cv-1", now: () => timestamp });

    expect(letter.ok).toBe(true);
    expect(cv.ok).toBe(true);
    if (letter.ok) expect(letter.document.renderedDocument.content).not.toContain("AZ-900");
    if (cv.ok) expect(cv.document.renderedDocument.content).not.toContain("AZ-900");
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

describe("a stale analysis blocks cover-letter generation - the same shared rule as the CV", () => {
  it("blocks first-time cover-letter creation when the profile changed after the stored analysis, and creates no document", async () => {
    const staleApplication = application(timestamp);
    const editedProfile = { ...profile(), updatedAt: "2026-09-06T10:30:00.000Z" };
    const store = stores({ applicationOverride: staleApplication, profileOverride: editedProfile });

    const result = await createCoverLetter({ applicationId }, { ...store, createId: () => "letter-1", now: () => "2026-09-06T10:45:00.000Z" });

    expect(result).toMatchObject({ ok: false, code: "STALE_ANALYSIS" });
    expect(store.documents).toHaveLength(0);
  });

  it("blocks regeneration of a new cover-letter version when the profile changed after the stored analysis, and preserves the existing version untouched", async () => {
    const staleApplication = application(timestamp);
    const store = stores({ applicationOverride: staleApplication });
    const first = await createCoverLetter({ applicationId }, { ...store, createId: () => "letter-1", now: () => timestamp });
    expect(first).toMatchObject({ ok: true, document: { version: 1 } });
    if (!first.ok) throw new Error(first.message);
    const firstContentBefore = first.document.renderedDocument.content;

    const editedProfile = { ...profile(), updatedAt: "2026-09-06T10:30:00.000Z" };
    const blocked = await createCoverLetter(
      { applicationId },
      { ...store, profileRepository: { ...store.profileRepository, getProfileByCandidateId: async () => ({ ok: true, value: { candidateId, profile: editedProfile } }) }, createId: () => "letter-2", now: () => "2026-09-06T10:45:00.000Z" },
    );

    expect(blocked).toMatchObject({ ok: false, code: "STALE_ANALYSIS" });
    expect(store.documents).toHaveLength(1);
    expect(store.documents[0].renderedDocument.content).toBe(firstContentBefore);
  });

  it("cannot be bypassed by calling createCoverLetter directly with a stale application/profile pair", async () => {
    const staleApplication = application(timestamp);
    const editedProfile = { ...profile(), updatedAt: "2026-09-06T10:30:00.000Z" };
    const store = stores({ applicationOverride: staleApplication, profileOverride: editedProfile });
    const result = await createCoverLetter({ applicationId, email: "direct-submission@example.test" }, store);
    expect(result).toMatchObject({ ok: false, code: "STALE_ANALYSIS" });
  });

  it("unblocks cover-letter generation once re-analysis records the same profile timestamp", async () => {
    const staleApplication = application(timestamp);
    const updatedProfile: CandidateProfile = { ...profile(), updatedAt: "2026-09-06T10:30:00.000Z" };
    const freshRankedJob = analyzeJobs(updatedProfile, [job()]).rankedJobs[0];
    const reanalyzed = reanalyzeApplication(staleApplication, { rankedJob: freshRankedJob, timestamp: "2026-09-06T10:50:00.000Z", candidateProfileUpdatedAt: updatedProfile.updatedAt });
    if (!reanalyzed.ok) throw new Error(reanalyzed.error.message);

    const store = stores({ applicationOverride: reanalyzed.value, profileOverride: updatedProfile });
    const result = await createCoverLetter({ applicationId }, { ...store, createId: () => "letter-1", now: () => "2026-09-06T11:00:00.000Z" });

    expect(result).toMatchObject({ ok: true, document: { version: 1 } });
  });

  it("re-blocks cover-letter generation after another profile edit that postdates the just-completed re-analysis", async () => {
    const staleApplication = application(timestamp);
    const analyzedProfile = { ...profile(), updatedAt: "2026-09-06T10:30:00.000Z" };
    const freshRankedJob = analyzeJobs(analyzedProfile, [job()]).rankedJobs[0];
    const reanalyzed = reanalyzeApplication(staleApplication, { rankedJob: freshRankedJob, timestamp: "2026-09-06T10:50:00.000Z", candidateProfileUpdatedAt: analyzedProfile.updatedAt });
    if (!reanalyzed.ok) throw new Error(reanalyzed.error.message);

    const editedAgain = { ...profile(), updatedAt: "2026-09-06T11:15:00.000Z" };
    const store = stores({ applicationOverride: reanalyzed.value, profileOverride: editedAgain });
    const result = await createCoverLetter({ applicationId }, { ...store, createId: () => "letter-1", now: () => "2026-09-06T11:30:00.000Z" });

    expect(result).toMatchObject({ ok: false, code: "STALE_ANALYSIS" });
  });
});
