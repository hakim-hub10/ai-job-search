import { documentQualityProfile, documentQualityExclusions, createProfessionalDocumentGenerator, resolveDocumentLanguage } from "./professional-documents";
import type { SkillReviewItem } from "./profile-quality";
import type { DocumentLanguage } from "../../../.agents/job-search/cli/src/application-documents";
import {
  generateApplicationDocument,
} from "../../../.agents/job-search/cli/src/index";
import { createApplicationDocumentStorageWorkflow } from "../../../.agents/job-search/cli/src/application-document-storage-workflow";
import type { ApplicationRepository } from "../../../.agents/job-search/cli/src/application-repository";
import type { ApplicationDocumentRecord, ApplicationDocumentRepository } from "../../../.agents/job-search/cli/src/application-document-repository";
import type { CandidateApplicationAssociationRepository } from "../../../.agents/job-search/cli/src/coach-application-association-repository";
import type { CoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-repository";
import type { CandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-repository";
import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import type { CandidateBaseCv } from "./candidate-base-cv";

export interface CreateTailoredCvInput {
  applicationId: string;
  language?: DocumentLanguage;
}

export type CreateTailoredCvFailureCode =
  | "INVALID_APPLICATION_ID"
  | "APPLICATION_NOT_FOUND"
  | "APPLICATION_STORAGE_FAILURE"
  | "ASSOCIATION_NOT_FOUND"
  | "ASSOCIATION_STORAGE_FAILURE"
  | "CANDIDATE_NOT_FOUND"
  | "CANDIDATE_STORAGE_FAILURE"
  | "PROFILE_NOT_FOUND"
  | "PROFILE_STORAGE_FAILURE"
  | "BASE_CV_NOT_FOUND"
  | "BASE_CV_STORAGE_FAILURE"
  | "TAILORING_FAILED"
  | "DOCUMENT_STORAGE_FAILURE";

export interface CreateTailoredCvFailure {
  ok: false;
  code: CreateTailoredCvFailureCode;
  message: string;
}

export interface CreateTailoredCvSuccess {
  ok: true;
  document: ApplicationDocumentRecord;
  /** Approved profile evidence excluded from the CV as likely pollution (see documentQualityProfile), with the reason for each - never silently lost. */
  excludedProfileEvidence: SkillReviewItem[];
}

export type CreateTailoredCvResult =
  | CreateTailoredCvSuccess
  | CreateTailoredCvFailure;

export interface CreateTailoredCvDependencies {
  applicationRepository: ApplicationRepository;
  associationRepository: CandidateApplicationAssociationRepository;
  candidateRepository: CoachWorkspaceRepository;
  profileRepository: CandidateProfileRepository;
  baseCvRepository: {
    getByCandidateId(candidateId: string): Promise<
      | { ok: true; value: CandidateBaseCv }
      | { ok: false; error: { code: string; message: string } }
    >;
  };
  documentRepository: ApplicationDocumentRepository;
  createId?: () => string;
  now?: () => string;
}

function failure(
  code: CreateTailoredCvFailureCode,
  message: string,
): CreateTailoredCvFailure {
  return { ok: false, code, message };
}

function profileForBaseCv(
  profile: CandidateProfile,
  baseCv: CandidateBaseCv,
): CandidateProfile {
  return {
    ...structuredClone(profile),
    headline: baseCv.visibility.headline ? baseCv.headline : "",
    ...(baseCv.visibility.summary
      ? { summary: baseCv.summary }
      : { summary: undefined }),
    workExperience: baseCv.visibility.workExperience
      ? structuredClone(baseCv.workExperience)
      : [],
    education: baseCv.visibility.education ? structuredClone(baseCv.education) : [],
    skills: {
      technical: baseCv.visibility.technicalSkills
        ? [...baseCv.technicalSkills]
        : [],
      soft: baseCv.visibility.softSkills ? [...baseCv.softSkills] : [],
    },
    certifications: baseCv.visibility.certifications
      ? [...baseCv.certifications]
      : [],
    languages: baseCv.visibility.languages ? structuredClone(baseCv.languages) : [],
  };
}

/** Creates an application-scoped CV using only trusted profile/Base CV evidence. */
export async function createTailoredCv(
  input: CreateTailoredCvInput,
  dependencies: CreateTailoredCvDependencies,
): Promise<CreateTailoredCvResult> {
  const applicationId = input.applicationId.trim();
  if (!applicationId) return failure("INVALID_APPLICATION_ID", "Ansökans ID saknas.");

  const application = await dependencies.applicationRepository.getById(applicationId);
  if (!application.ok) {
    return application.error.code === "NOT_FOUND"
      ? failure("APPLICATION_NOT_FOUND", "Ansökan hittades inte.")
      : failure("APPLICATION_STORAGE_FAILURE", "Ansökningsarkivet kunde inte läsas.");
  }

  const association = await dependencies.associationRepository.getByApplicationId(applicationId);
  if (!association.ok) {
    return association.error.code === "NOT_FOUND"
      ? failure("ASSOCIATION_NOT_FOUND", "Ansökan saknar kandidatkoppling.")
      : failure("ASSOCIATION_STORAGE_FAILURE", "Kandidatkopplingen kunde inte läsas.");
  }

  const candidate = await dependencies.candidateRepository.getCandidateById(association.value.candidateId);
  if (!candidate.ok) {
    return candidate.error.code === "NOT_FOUND"
      ? failure("CANDIDATE_NOT_FOUND", "Den kopplade kandidaten hittades inte.")
      : failure("CANDIDATE_STORAGE_FAILURE", "Kandidatregistret kunde inte läsas.");
  }

  const profile = await dependencies.profileRepository.getProfileByCandidateId(candidate.value.id);
  if (!profile.ok) {
    return profile.error.code === "NOT_FOUND"
      ? failure("PROFILE_NOT_FOUND", "Kandidatprofil saknas.")
      : failure("PROFILE_STORAGE_FAILURE", "Kandidatprofilen kunde inte läsas.");
  }

  const baseCv = await dependencies.baseCvRepository.getByCandidateId(candidate.value.id);
  if (!baseCv.ok) {
    return baseCv.error.code === "NOT_FOUND"
      ? failure("BASE_CV_NOT_FOUND", "Grund-CV saknas.")
      : failure("BASE_CV_STORAGE_FAILURE", "Grund-CV-lagringen kunde inte läsas.");
  }

  const sourceProfile = profileForBaseCv(profile.value.profile, baseCv.value);
  const excludedProfileEvidence = documentQualityExclusions(sourceProfile);
  const generated = await generateApplicationDocument({
    application: application.value,
    candidateDocumentInput: {
      matchingProfile: documentQualityProfile(sourceProfile),
      identity: { fullName: candidate.value.displayName },
    },
    tailoringOptions: { type: "cv", language: resolveDocumentLanguage(input.language, application.value.jobSnapshot.description), maxEvidenceItems: 200 },
    generator: createProfessionalDocumentGenerator({ composeSummary: baseCv.value.visibility.summary || !baseCv.value.summary?.trim() }),
    generationOptions: { untrustedJobDescription: application.value.jobSnapshot.description ?? undefined },
  });

  if (!generated.ok) {
    return failure("TAILORING_FAILED", "Det anpassade CV:t kunde inte skapas.");
  }

  const stored = await createApplicationDocumentStorageWorkflow(
    dependencies.applicationRepository,
    dependencies.documentRepository,
  ).saveGeneratedApplicationDocument({
    documentId: dependencies.createId?.() ?? crypto.randomUUID(),
    createdAt: dependencies.now?.() ?? new Date().toISOString(),
    generatedDocument: generated.value.document,
    renderedDocument: generated.value.renderedDocument,
  });

  if (!stored.ok) {
    return failure("DOCUMENT_STORAGE_FAILURE", "Det anpassade CV:t kunde inte sparas.");
  }

  return { ok: true, document: stored.value, excludedProfileEvidence };
}
