import { resolve } from "node:path";

import type { ApplicationRecord } from "../../../.agents/job-search/cli/src/applications";
import { createFileApplicationRepository } from "../../../.agents/job-search/cli/src/application-file-repository";
import type { ApplicationRepository } from "../../../.agents/job-search/cli/src/application-repository";
import type { ApplicationDocumentRecord } from "../../../.agents/job-search/cli/src/application-document-repository";
import { createFileApplicationDocumentRepository } from "../../../.agents/job-search/cli/src/application-document-file-repository";
import type { ApplicationDocumentRepository } from "../../../.agents/job-search/cli/src/application-document-repository";
import { createFileCandidateApplicationAssociationRepository } from "../../../.agents/job-search/cli/src/coach-application-association-file-repository";
import type { CandidateApplicationAssociationRepository } from "../../../.agents/job-search/cli/src/coach-application-association-repository";
import { resolveCoachRepositoryPaths } from "../../../.agents/job-search/cli/src/coach-cli-paths";
import { createFileCoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-file-repository";
import type { CoachCandidate } from "../../../.agents/job-search/cli/src/coach-workspace";
import type { CoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-repository";
import { createFileCandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-file-repository";
import type { CandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-repository";
import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";

export type ApplicationDocumentReadFailureCode =
  | "INVALID_APPLICATION_ID"
  | "APPLICATION_NOT_FOUND"
  | "APPLICATION_STORAGE_FAILURE"
  | "ASSOCIATION_STORAGE_FAILURE"
  | "CANDIDATE_NOT_FOUND"
  | "CANDIDATE_STORAGE_FAILURE"
  | "PROFILE_STORAGE_FAILURE"
  | "DOCUMENT_REPOSITORY_UNAVAILABLE";

export interface ApplicationDocumentReadFailure {
  ok: false;
  code: ApplicationDocumentReadFailureCode;
  message: string;
}

export interface ApplicationDocumentReadSuccess {
  ok: true;
  application: ApplicationRecord;
  candidate: CoachCandidate | null;
  profile: CandidateProfile | null;
  documents: ApplicationDocumentRecord[];
  associationMissing: boolean;
}

export type ApplicationDocumentReadResult =
  | ApplicationDocumentReadSuccess
  | ApplicationDocumentReadFailure;

export interface ApplicationDocumentReadDependencies {
  applicationRepository: ApplicationRepository;
  associationRepository: CandidateApplicationAssociationRepository;
  candidateRepository: CoachWorkspaceRepository;
  profileRepository: CandidateProfileRepository;
  documentRepository: ApplicationDocumentRepository;
}

function failure(
  code: ApplicationDocumentReadFailureCode,
  message: string,
): ApplicationDocumentReadFailure {
  return { ok: false, code, message };
}

/** Reads document state without creating drafts, rendering, or calling providers. */
export async function readApplicationDocumentState(
  applicationId: string,
  dependencies: ApplicationDocumentReadDependencies,
): Promise<ApplicationDocumentReadResult> {
  const normalizedId = applicationId.trim();
  if (!normalizedId) {
    return failure("INVALID_APPLICATION_ID", "Ansökans ID saknas.");
  }

  const application = await dependencies.applicationRepository.getById(normalizedId);
  if (!application.ok) {
    return application.error.code === "NOT_FOUND"
      ? failure("APPLICATION_NOT_FOUND", "Ansökan hittades inte.")
      : failure("APPLICATION_STORAGE_FAILURE", "Ansökningsarkivet kunde inte läsas.");
  }

  const documents = await dependencies.documentRepository.listByApplication(normalizedId);
  if (!documents.ok) {
    return failure("DOCUMENT_REPOSITORY_UNAVAILABLE", "Dokumentarkivet kunde inte läsas.");
  }

  const association = await dependencies.associationRepository.getByApplicationId(normalizedId);
  if (!association.ok) {
    if (association.error.code === "NOT_FOUND") {
      return {
        ok: true,
        application: application.value,
        candidate: null,
        profile: null,
        documents: documents.value,
        associationMissing: true,
      };
    }
    return failure("ASSOCIATION_STORAGE_FAILURE", "Kandidatkopplingen kunde inte läsas.");
  }

  const candidate = await dependencies.candidateRepository.getCandidateById(
    association.value.candidateId,
  );
  if (!candidate.ok) {
    return candidate.error.code === "NOT_FOUND"
      ? failure("CANDIDATE_NOT_FOUND", "Den kopplade kandidaten hittades inte.")
      : failure("CANDIDATE_STORAGE_FAILURE", "Kandidatregistret kunde inte läsas.");
  }

  const profile = await dependencies.profileRepository.getProfileByCandidateId(
    candidate.value.id,
  );
  if (!profile.ok) {
    if (profile.error.code === "NOT_FOUND") {
      return {
        ok: true,
        application: application.value,
        candidate: candidate.value,
        profile: null,
        documents: documents.value,
        associationMissing: false,
      };
    }
    return failure("PROFILE_STORAGE_FAILURE", "Kandidatprofilen kunde inte läsas.");
  }

  return {
    ok: true,
    application: application.value,
    candidate: candidate.value,
    profile: profile.value.profile,
    documents: documents.value,
    associationMissing: false,
  };
}

export async function loadApplicationDocumentState(
  applicationId: string,
): Promise<ApplicationDocumentReadResult | { ok: false; code: "CONFIGURATION_MISSING"; message: string }> {
  const applicationRepositoryPath = process.env.APPLICATION_REPOSITORY;
  const coachDir = process.env.COACH_DIR;
  const documentRepositoryPath = process.env.APPLICATION_DOCUMENT_REPOSITORY;

  if (!applicationRepositoryPath || !coachDir || !documentRepositoryPath) {
    return {
      ok: false,
      code: "CONFIGURATION_MISSING",
      message: "Dokumentvyn är inte fullständigt konfigurerad.",
    };
  }

  const paths = resolveCoachRepositoryPaths(resolve(coachDir));
  return readApplicationDocumentState(applicationId, {
    applicationRepository: createFileApplicationRepository(resolve(applicationRepositoryPath)),
    associationRepository: createFileCandidateApplicationAssociationRepository(paths.associations),
    candidateRepository: createFileCoachWorkspaceRepository(paths.candidates),
    profileRepository: createFileCandidateProfileRepository(paths.candidateProfiles),
    documentRepository: createFileApplicationDocumentRepository(resolve(documentRepositoryPath)),
  });
}
