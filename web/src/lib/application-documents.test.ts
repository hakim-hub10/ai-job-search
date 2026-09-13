import { describe, expect, it } from "bun:test";

import type { ApplicationRecord } from "../../../.agents/job-search/cli/src/applications";
import type { ApplicationRepository } from "../../../.agents/job-search/cli/src/application-repository";
import type { ApplicationDocumentRecord, ApplicationDocumentRepository } from "../../../.agents/job-search/cli/src/application-document-repository";
import type { CandidateApplicationAssociationRepository } from "../../../.agents/job-search/cli/src/coach-application-association-repository";
import type { CandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-repository";
import type { CoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-repository";
import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import type { CoachCandidate } from "../../../.agents/job-search/cli/src/coach-workspace";
import { readApplicationDocumentState, type ApplicationDocumentReadDependencies } from "./application-documents";

const applicationId = "application-1";
const candidateId = "candidate-1";
const timestamp = "2026-09-06T10:00:00.000Z";

const application = { id: applicationId } as unknown as ApplicationRecord;
const candidate = { id: candidateId, displayName: "Test Candidate" } as unknown as CoachCandidate;
const profile = { headline: "IT-supporttekniker" } as unknown as CandidateProfile;
const document = { id: "document-1", applicationId, documentType: "cv", version: 1 } as unknown as ApplicationDocumentRecord;

function dependencies(options: {
  association?: { candidateId: string; applicationId: string; createdAt: string } | null;
  candidateResult?: Awaited<ReturnType<CoachWorkspaceRepository["getCandidateById"]>>;
  profileResult?: Awaited<ReturnType<CandidateProfileRepository["getProfileByCandidateId"]>>;
  documentsResult?: Awaited<ReturnType<ApplicationDocumentRepository["listByApplication"]>>;
  applicationResult?: Awaited<ReturnType<ApplicationRepository["getById"]>>;
} = {}): ApplicationDocumentReadDependencies {
  const association = options.association === null
    ? undefined
    : options.association ?? { candidateId, applicationId, createdAt: timestamp };

  return {
    applicationRepository: {
      async create() { throw new Error("not used"); },
      async save() { throw new Error("not used"); },
      async getById() {
        return options.applicationResult ?? { ok: true, value: application };
      },
      async list() { return { ok: true, value: [application] }; },
      async remove() { throw new Error("not used"); },
    } as ApplicationRepository,
    associationRepository: {
      async create() { throw new Error("not used"); },
      async getByApplicationId() {
        return association === undefined
          ? { ok: false, error: { code: "NOT_FOUND", message: "missing association" } }
          : { ok: true, value: association };
      },
      async listByCandidateId() { return { ok: true, value: [association] }; },
      async deleteByApplicationId() { throw new Error("not used"); },
    } as CandidateApplicationAssociationRepository,
    candidateRepository: {
      async createCandidate() { throw new Error("not used"); },
      async getCandidateById() {
        return options.candidateResult ?? { ok: true, value: candidate };
      },
      async listCandidates() { return { ok: true, value: [candidate] }; },
    } as CoachWorkspaceRepository,
    profileRepository: {
      async saveProfile() { throw new Error("not used"); },
      async getProfileByCandidateId() {
        return options.profileResult ?? { ok: true, value: { candidateId, profile } };
      },
      async listProfiles() { return { ok: true, value: [] }; },
    } as CandidateProfileRepository,
    documentRepository: {
      async create() { throw new Error("not used"); },
      async getById() { throw new Error("not used"); },
      async listByApplication() {
        return options.documentsResult ?? { ok: true, value: [] };
      },
      async listVersions() { throw new Error("not used"); },
      async getLatest() { throw new Error("not used"); },
      async deleteByApplication() { throw new Error("not used"); },
    } as ApplicationDocumentRepository,
  };
}

describe("application document read boundary", () => {
  it("loads an application with no documents and an explicit candidate profile", async () => {
    const result = await readApplicationDocumentState(applicationId, dependencies());

    expect(result).toEqual({
      ok: true,
      application,
      candidate,
      profile,
      documents: [],
      associationMissing: false,
    });
  });

  it("returns an explicit missing-association state without creating candidate data", async () => {
    const result = await readApplicationDocumentState(applicationId, dependencies({ association: null }));

    expect(result).toMatchObject({ ok: true, associationMissing: true, candidate: null, profile: null, documents: [] });
  });

  it("preserves an explicit missing-profile state", async () => {
    const result = await readApplicationDocumentState(applicationId, dependencies({
      profileResult: { ok: false, error: { code: "NOT_FOUND", message: "missing profile" } },
    }));

    expect(result).toMatchObject({ ok: true, associationMissing: false, candidate, profile: null });
  });

  it("loads existing document records without generating or changing them", async () => {
    const result = await readApplicationDocumentState(applicationId, dependencies({
      documentsResult: { ok: true, value: [document] },
    }));

    expect(result).toMatchObject({ ok: true, documents: [document] });
  });

  it("fails safely for missing applications and unavailable document storage", async () => {
    const missingApplication = await readApplicationDocumentState(applicationId, dependencies({
      applicationResult: { ok: false, error: { code: "NOT_FOUND", message: "missing application" } },
    }));
    const unavailableDocuments = await readApplicationDocumentState(applicationId, dependencies({
      documentsResult: { ok: false, error: { code: "READ_FAILURE", message: "filesystem detail" } },
    }));

    expect(missingApplication).toEqual({ ok: false, code: "APPLICATION_NOT_FOUND", message: "Ansökan hittades inte." });
    expect(unavailableDocuments).toEqual({ ok: false, code: "DOCUMENT_REPOSITORY_UNAVAILABLE", message: "Dokumentarkivet kunde inte läsas." });
  });

  it("rejects an empty application ID before repository access", async () => {
    const result = await readApplicationDocumentState(" ", dependencies());

    expect(result).toEqual({ ok: false, code: "INVALID_APPLICATION_ID", message: "Ansökans ID saknas." });
  });
});
