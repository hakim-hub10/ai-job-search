import { resolve } from "node:path";

import {
  buildCandidateEvidenceCatalog,
  renderGeneratedApplicationDocument,
  type ApplicationRecord,
  type CandidateEvidence,
  type DocumentType,
} from "../../../.agents/job-search/cli/src/index";
import { createApplicationDocumentStorageWorkflow } from "../../../.agents/job-search/cli/src/application-document-storage-workflow";
import type { ApplicationRepository } from "../../../.agents/job-search/cli/src/application-repository";
import type { ApplicationDocumentRecord, ApplicationDocumentRepository } from "../../../.agents/job-search/cli/src/application-document-repository";
import type { CandidateApplicationAssociationRepository } from "../../../.agents/job-search/cli/src/coach-application-association-repository";
import type { CoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-repository";
import type { CandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-repository";
import { createFileApplicationRepository } from "../../../.agents/job-search/cli/src/application-file-repository";
import { createFileApplicationDocumentRepository } from "../../../.agents/job-search/cli/src/application-document-file-repository";
import { createFileCandidateApplicationAssociationRepository } from "../../../.agents/job-search/cli/src/coach-application-association-file-repository";
import { resolveCoachRepositoryPaths } from "../../../.agents/job-search/cli/src/coach-cli-paths";
import { createFileCoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-file-repository";
import { createFileCandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-file-repository";
import { decodeDocumentEntities } from "./document-presentation";

export const MAX_DOCUMENT_EDIT_LENGTH = 20_000;
export const DOCUMENT_TYPES = ["cv", "coverLetter"] as const;
export const REWRITE_MODES = ["improve", "shorten", "professional", "jobTailored"] as const;

export type DocumentRewriteMode = typeof REWRITE_MODES[number];

export interface DocumentEditorDependencies {
  applicationRepository: ApplicationRepository;
  associationRepository: CandidateApplicationAssociationRepository;
  candidateRepository: CoachWorkspaceRepository;
  profileRepository: CandidateProfileRepository;
  documentRepository: ApplicationDocumentRepository;
}

export function createConfiguredDocumentEditorDependencies(): DocumentEditorDependencies | null {
  const coachDir = process.env.COACH_DIR?.trim();
  const applicationRepositoryPath = process.env.APPLICATION_REPOSITORY?.trim();
  const documentRepositoryPath = process.env.APPLICATION_DOCUMENT_REPOSITORY?.trim();
  if (!coachDir || !applicationRepositoryPath || !documentRepositoryPath) return null;
  const paths = resolveCoachRepositoryPaths(resolve(coachDir));
  return {
    applicationRepository: createFileApplicationRepository(resolve(applicationRepositoryPath)),
    associationRepository: createFileCandidateApplicationAssociationRepository(paths.associations),
    candidateRepository: createFileCoachWorkspaceRepository(paths.candidates),
    profileRepository: createFileCandidateProfileRepository(paths.candidateProfiles),
    documentRepository: createFileApplicationDocumentRepository(resolve(documentRepositoryPath)),
  };
}

export interface DocumentEditorState {
  applicationId: string;
  documentType: DocumentType;
  candidateId: string;
  language?: "sv" | "en";
  currentVersion: number;
  currentContent: string;
}

export type DocumentEditorFailureCode =
  | "INVALID_APPLICATION_ID"
  | "UNSUPPORTED_DOCUMENT_TYPE"
  | "APPLICATION_NOT_FOUND"
  | "APPLICATION_STORAGE_FAILURE"
  | "ASSOCIATION_NOT_FOUND"
  | "ASSOCIATION_STORAGE_FAILURE"
  | "CANDIDATE_NOT_FOUND"
  | "CANDIDATE_STORAGE_FAILURE"
  | "PROFILE_NOT_FOUND"
  | "PROFILE_STORAGE_FAILURE"
  | "DOCUMENT_NOT_FOUND"
  | "DOCUMENT_STORAGE_FAILURE"
  | "CONTENT_EMPTY"
  | "CONTENT_TOO_LARGE"
  | "INVALID_REWRITE_MODE"
  | "AI_UNAVAILABLE"
  | "AI_FAILED"
  | "AI_PROPOSAL_INVALID";

export interface DocumentEditorFailure {
  ok: false;
  code: DocumentEditorFailureCode;
  message: string;
}

export interface DocumentEditorSuccess<T> {
  ok: true;
  value: T;
}

export type DocumentEditorResult<T> =
  | DocumentEditorSuccess<T>
  | DocumentEditorFailure;

export interface SaveDocumentEditInput {
  applicationId: string;
  documentType: string;
  content: string;
}

export interface AiRewriteRequest {
  applicationId: string;
  documentType: string;
  mode: string;
  currentDraft: string;
}

export interface AiRewriteProposal {
  content: string;
  evidenceIds: string[];
}

export interface DocumentRewriteProviderRequest {
  language?: "sv" | "en";
  mode: DocumentRewriteMode;
  currentContent: string;
  candidateEvidence: CandidateEvidence[];
  application: ApplicationRecord;
  applicationId: string;
  documentType: DocumentType;
  applicationContext: {
    jobTitle: string;
    company: string | null;
  };
  untrustedJobContext: {
    title: string;
    company: string | null;
    description: string | null;
  };
}

export interface DocumentRewriteProvider {
  rewrite(request: DocumentRewriteProviderRequest): Promise<
    | { ok: true; value: AiRewriteProposal }
    | { ok: false; message: string }
  >;
}

function failure(code: DocumentEditorFailureCode, message: string): DocumentEditorFailure {
  return { ok: false, code, message };
}

function documentType(value: string): DocumentType | null {
  return DOCUMENT_TYPES.includes(value as DocumentType) ? value as DocumentType : null;
}

function rewriteMode(value: string): DocumentRewriteMode | null {
  return REWRITE_MODES.includes(value as DocumentRewriteMode) ? value as DocumentRewriteMode : null;
}

async function loadEditorState(
  applicationIdInput: string,
  documentTypeInput: string,
  dependencies: DocumentEditorDependencies,
): Promise<DocumentEditorResult<DocumentEditorState & { application: ApplicationRecord }>> {
  const applicationId = applicationIdInput.trim();
  const type = documentType(documentTypeInput);
  if (!applicationId) return failure("INVALID_APPLICATION_ID", "Ansökans ID saknas.");
  if (!type) return failure("UNSUPPORTED_DOCUMENT_TYPE", "Dokumenttypen stöds inte.");

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
  const documents = await dependencies.documentRepository.listVersions(applicationId, type);
  if (!documents.ok) return failure("DOCUMENT_STORAGE_FAILURE", "Dokumentarkivet kunde inte läsas.");
  const latest = documents.value.at(-1);
  if (!latest) return failure("DOCUMENT_NOT_FOUND", "Dokumentet hittades inte.");

  return {
    ok: true,
    value: {
      applicationId,
      documentType: type,
      candidateId: candidate.value.id,
      language: latest.language,
      currentVersion: latest.version,
      currentContent: decodeDocumentEntities(latest.renderedDocument.content),
      application: application.value,
    },
  };
}

export async function readDocumentEditorState(
  applicationId: string,
  documentTypeInput: string,
  dependencies: DocumentEditorDependencies,
): Promise<DocumentEditorResult<DocumentEditorState>> {
  const result = await loadEditorState(applicationId, documentTypeInput, dependencies);
  return result.ok ? { ok: true, value: result.value } : result;
}

export async function saveDocumentEdit(
  input: SaveDocumentEditInput,
  dependencies: DocumentEditorDependencies,
  options: { createId?: () => string; now?: () => string } = {},
): Promise<DocumentEditorResult<ApplicationDocumentRecord>> {
  if (!input.content.trim()) return failure("CONTENT_EMPTY", "Dokumenttexten får inte vara tom.");
  if (input.content.length > MAX_DOCUMENT_EDIT_LENGTH) return failure("CONTENT_TOO_LARGE", "Dokumenttexten är för lång.");
  const state = await loadEditorState(input.applicationId, input.documentType, dependencies);
  if (!state.ok) return state;
  const generatedDocument = {
    applicationId: state.value.applicationId,
    documentType: state.value.documentType,
    language: state.value.language ?? "sv",
    requiresHumanReview: true,
    warnings: [],
    sections: [{
      id: "manual:content",
      kind: "context" as const,
      claims: [{
        id: `manual:${state.value.documentType}:content`,
        kind: "neutralContext" as const,
        provenance: "neutral" as const,
        text: input.content.replace(/\r\n?/gu, "\n"),
        evidenceIds: [],
      }],
    }],
  };
  const rendered = renderGeneratedApplicationDocument(generatedDocument);
  if (!rendered.ok) return failure("DOCUMENT_STORAGE_FAILURE", "Dokumentet kunde inte förberedas.");
  const saved = await createApplicationDocumentStorageWorkflow(
    dependencies.applicationRepository,
    dependencies.documentRepository,
  ).saveGeneratedApplicationDocument({
    documentId: options.createId?.() ?? crypto.randomUUID(),
    createdAt: options.now?.() ?? new Date().toISOString(),
    generatedDocument,
    renderedDocument: rendered.value,
  });
  return saved.ok
    ? { ok: true, value: saved.value }
    : failure("DOCUMENT_STORAGE_FAILURE", "Dokumentet kunde inte sparas.");
}

export async function requestDocumentAiRewrite(
  input: AiRewriteRequest,
  dependencies: DocumentEditorDependencies,
  provider: DocumentRewriteProvider | null,
): Promise<DocumentEditorResult<AiRewriteProposal>> {
  const mode = rewriteMode(input.mode);
  if (!mode) return failure("INVALID_REWRITE_MODE", "AI-åtgärden stöds inte.");
  if (!input.currentDraft.trim()) return failure("CONTENT_EMPTY", "Dokumenttexten får inte vara tom.");
  if (input.currentDraft.length > MAX_DOCUMENT_EDIT_LENGTH) return failure("CONTENT_TOO_LARGE", "Dokumenttexten är för lång.");
  if (!provider) return failure("AI_UNAVAILABLE", "AI-assistans är inte konfigurerad.");
  const state = await loadEditorState(input.applicationId, input.documentType, dependencies);
  if (!state.ok) return state;
  const profile = await dependencies.profileRepository.getProfileByCandidateId(state.value.candidateId);
  if (!profile.ok) return failure("PROFILE_STORAGE_FAILURE", "Kandidatprofilen kunde inte läsas.");
  const catalog = buildCandidateEvidenceCatalog({ matchingProfile: profile.value.profile });
  if (!catalog.ok) return failure("AI_PROPOSAL_INVALID", "Kandidatunderlaget kunde inte valideras.");
  const response = await provider.rewrite({
    language: state.value.language,
    mode,
    currentContent: input.currentDraft,
    applicationId: state.value.applicationId,
    documentType: state.value.documentType,
    candidateEvidence: catalog.value.evidence,
    application: state.value.application,
    applicationContext: {
      jobTitle: state.value.application.jobSnapshot.title,
      company: state.value.application.jobSnapshot.company,
    },
    untrustedJobContext: {
      title: state.value.application.jobSnapshot.title,
      company: state.value.application.jobSnapshot.company,
      description: state.value.application.jobSnapshot.description,
    },
  });
  if (!response.ok) return failure("AI_FAILED", "AI-förslaget kunde inte skapas.");
  if (!response.value.content.trim() || response.value.content.length > MAX_DOCUMENT_EDIT_LENGTH) {
    return failure("AI_PROPOSAL_INVALID", "AI-förslaget kunde inte valideras.");
  }
  const evidenceIds = new Set(catalog.value.evidence.map((item) => item.id));
  if (!response.value.evidenceIds.every((id) => evidenceIds.has(id))) {
    return failure("AI_PROPOSAL_INVALID", "AI-förslaget hänvisar till okänt kandidatunderlag.");
  }
  return { ok: true, value: structuredClone(response.value) };
}
