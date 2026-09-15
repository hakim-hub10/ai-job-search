import { documentQualityProfile, professionalDocumentGenerator, resolveDocumentLanguage } from "./professional-documents";
import type { DocumentLanguage } from "../../../.agents/job-search/cli/src/application-documents";
import { createApplicationDocumentStorageWorkflow } from "../../../.agents/job-search/cli/src/application-document-storage-workflow";
import { generateProfessionalDocument, type ProfessionalWriterGeneratorUsed, type ProfessionalWriterFallbackReason } from "./professional-writer";
import type { ApplicationRepository } from "../../../.agents/job-search/cli/src/application-repository";
import type { ApplicationDocumentRecord, ApplicationDocumentRepository } from "../../../.agents/job-search/cli/src/application-document-repository";
import type { CandidateApplicationAssociationRepository } from "../../../.agents/job-search/cli/src/coach-application-association-repository";
import type { CoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-repository";
import type { CandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-repository";
import { mergeBaseCvIntoProfile, type CandidateBaseCv } from "./candidate-base-cv";
import { isApplicationAnalysisStale } from "./application-reanalysis";

export interface CreateCoverLetterInput {
  applicationId: string;
  language?: DocumentLanguage;
  /** The authenticated account's own verified email, shown in the cover letter's header when supplied. Never invented when omitted. */
  email?: string;
}

export type CreateCoverLetterFailureCode =
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
  | "STALE_ANALYSIS"
  | "TAILORING_FAILED"
  | "DOCUMENT_STORAGE_FAILURE";

export interface CreateCoverLetterFailure {
  ok: false;
  code: CreateCoverLetterFailureCode;
  message: string;
}

export interface CreateCoverLetterSuccess {
  ok: true;
  document: ApplicationDocumentRecord;
  /** Which generator actually produced the saved document - never rendered into the letter itself, only for internal/UI diagnostics. */
  generatorUsed: ProfessionalWriterGeneratorUsed;
  /** Present only when the AI writer was tried and failed, and generation fell back to the deterministic generator. */
  fallbackReason?: ProfessionalWriterFallbackReason;
}

export type CreateCoverLetterResult =
  | CreateCoverLetterSuccess
  | CreateCoverLetterFailure;

export interface CreateCoverLetterDependencies {
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
  code: CreateCoverLetterFailureCode,
  message: string,
): CreateCoverLetterFailure {
  return { ok: false, code, message };
}

/** Creates an application-scoped cover letter from the same approved candidate + Base CV evidence universe as createTailoredCv. */
export async function createCoverLetter(
  input: CreateCoverLetterInput,
  dependencies: CreateCoverLetterDependencies,
): Promise<CreateCoverLetterResult> {
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

  // See createTailoredCv's identical guard - one shared staleness rule for both document types,
  // applied equally to a brand new document and to a regenerated version.
  if (isApplicationAnalysisStale(application.value, profile.value.profile.updatedAt)) {
    return failure(
      "STALE_ANALYSIS",
      "Din profil har ändrats sedan den senaste analysen. Analysera om jobbet först för att använda din senaste profil i de anpassade dokumenten.",
    );
  }

  const baseCv = await dependencies.baseCvRepository.getByCandidateId(candidate.value.id);
  if (!baseCv.ok) {
    return baseCv.error.code === "NOT_FOUND"
      ? failure("BASE_CV_NOT_FOUND", "Grund-CV saknas.")
      : failure("BASE_CV_STORAGE_FAILURE", "Grund-CV-lagringen kunde inte läsas.");
  }

  const sourceProfile = mergeBaseCvIntoProfile(profile.value.profile, baseCv.value);
  const { result: generated, generatorUsed, fallbackReason } = await generateProfessionalDocument({
    application: application.value,
    candidateDocumentInput: { matchingProfile: documentQualityProfile(sourceProfile), identity: { fullName: candidate.value.displayName, ...(input.email?.trim() ? { email: input.email.trim() } : {}) } },
    tailoringOptions: { type: "coverLetter", language: resolveDocumentLanguage(input.language, application.value.jobSnapshot.description), maxEvidenceItems: 200 },
    generationOptions: { untrustedJobDescription: application.value.jobSnapshot.description ?? undefined },
  }, professionalDocumentGenerator);

  if (!generated.ok) {
    return failure("TAILORING_FAILED", "Det personliga brevet kunde inte skapas.");
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
    return failure("DOCUMENT_STORAGE_FAILURE", "Det personliga brevet kunde inte sparas.");
  }

  return { ok: true, document: stored.value, generatorUsed, ...(fallbackReason ? { fallbackReason } : {}) };
}
