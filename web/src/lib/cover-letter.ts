import {
  generateApplicationDocument,
  type ApplicationDocumentGenerator,
} from "../../../.agents/job-search/cli/src/index";
import { createApplicationDocumentStorageWorkflow } from "../../../.agents/job-search/cli/src/application-document-storage-workflow";
import type { ApplicationRepository } from "../../../.agents/job-search/cli/src/application-repository";
import type { ApplicationDocumentRecord, ApplicationDocumentRepository } from "../../../.agents/job-search/cli/src/application-document-repository";
import type { CandidateApplicationAssociationRepository } from "../../../.agents/job-search/cli/src/coach-application-association-repository";
import type { CoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-repository";
import type { CandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-repository";

export interface CreateCoverLetterInput {
  applicationId: string;
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
}

export type CreateCoverLetterResult =
  | CreateCoverLetterSuccess
  | CreateCoverLetterFailure;

export interface CreateCoverLetterDependencies {
  applicationRepository: ApplicationRepository;
  associationRepository: CandidateApplicationAssociationRepository;
  candidateRepository: CoachWorkspaceRepository;
  profileRepository: CandidateProfileRepository;
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

const deterministicCoverLetterGenerator: ApplicationDocumentGenerator = {
  async generate(request) {
    const sections = new Map<string, {
      id: string;
      kind: (typeof request.selectedEvidence)[number]["kind"];
      claims: Array<{
        id: string;
        kind: "candidateFact";
        provenance: "verbatim";
        text: string;
        evidenceIds: string[];
      }>;
    }>();

    for (const evidence of request.selectedEvidence) {
      const section = sections.get(evidence.kind) ?? {
        id: `deterministic:${evidence.kind}`,
        kind: evidence.kind,
        claims: [],
      };
      section.claims.push({
        id: `deterministic:${evidence.id}`,
        kind: "candidateFact",
        provenance: "verbatim",
        text: evidence.content,
        evidenceIds: [evidence.id],
      });
      sections.set(evidence.kind, section);
    }

    return {
      ok: true,
      value: {
        applicationId: request.applicationId,
        type: request.type,
        language: request.language,
        sections: [
          {
            id: "deterministic:context",
            kind: "context" as const,
            claims: [
              {
                id: "deterministic:cover-letter-context",
                kind: "neutralContext" as const,
                provenance: "neutral" as const,
                text: "Strukturerad disposition för personligt brev.",
                evidenceIds: [],
              },
            ],
          },
          ...sections.values(),
        ],
      },
    };
  },
};

/** Creates an application-scoped cover-letter outline from profile evidence only. */
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

  const generated = await generateApplicationDocument({
    application: application.value,
    candidateDocumentInput: { matchingProfile: profile.value.profile },
    tailoringOptions: { type: "coverLetter", language: "sv" },
    generator: deterministicCoverLetterGenerator,
  });

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

  return { ok: true, document: stored.value };
}
