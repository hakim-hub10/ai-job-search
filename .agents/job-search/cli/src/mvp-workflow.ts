import {
  buildApplicationDocumentFoundation,
  type CandidateDocumentInput,
  type DocumentLanguage,
  type DocumentType,
} from "./application-documents"
import { createApplicationDocumentStorageWorkflow } from "./application-document-storage-workflow"
import { createApplicationWorkflow, type ApplicationWorkflowError } from "./application-workflow"
import type { ApplicationDocumentRepository } from "./application-document-repository"
import type { ApplicationRepository } from "./application-repository"
import { createTailoringPlan, type TailoringError, type TailoringOptions } from "./document-tailoring"
import { renderApplicationDocument, type RenderError, type RenderedDocument } from "./document-rendering"
import { generateApplicationDocument, type GeneratedApplicationDocumentWorkflowResult } from "./document-workflow"
import type { ApplicationDocumentGenerator } from "./document-generation"
import { analyzeJobs, type CareerAnalysisResult } from "./orchestrator"
import { enrichJobDetails, type JobDetailEnrichmentResult } from "./job-detail-enrichment"
import type { SearchRelevanceSelection } from "./search-relevance"
import { retrieveSearchAwareJobs, type SearchRetrievalPlan } from "./search-retrieval"
import type { CandidateProfile } from "./profile"
import type { RankedJob } from "./ranking"
import type { JobSourceAdapter, UnifiedSearchOptions, UnifiedSearchResponse } from "./types"

export interface MvpDocumentRequest {
  type: DocumentType
  language: DocumentLanguage
  maxEvidenceItems?: number
}

export interface MvpWorkflowInput {
  profile: CandidateProfile
  /** Explicit document facts only; a matching profile is intentionally not injected here. */
  documentEvidence: Omit<CandidateDocumentInput, "matchingProfile">
  search: UnifiedSearchOptions & { adapters: JobSourceAdapter[]; includeSourceStatus?: boolean }
  selectedRank: number
  application: { id: string; createdAt: string; allowDuplicate?: boolean }
  documents: MvpDocumentRequest[]
  generation?: { generator: ApplicationDocumentGenerator }
  saveDocuments?: boolean
  documentStorage?: { repository: ApplicationDocumentRepository; ids: string[]; createdAt: string }
}

export interface MvpWorkflowDependencies {
  searchJobs: (options: UnifiedSearchOptions & { adapters: JobSourceAdapter[]; includeSourceStatus?: boolean }) => Promise<UnifiedSearchResponse>
  applicationRepository: ApplicationRepository
  enrichJobDetails?: typeof enrichJobDetails
}

export interface MvpRenderedDocument {
  type: DocumentType
  rendered: RenderedDocument
  savedVersion?: number
}

export interface MvpWorkflowSuccess {
  ok: true
  search: UnifiedSearchResponse
  analysis: CareerAnalysisResult
  relevance: SearchRelevanceSelection
  retrievalPlan: SearchRetrievalPlan
  enrichment: JobDetailEnrichmentResult
  selectedJob: RankedJob
  application: import("./applications").ApplicationRecord
  documents: MvpRenderedDocument[]
  generatedDocuments: Array<{ type: DocumentType; result: GeneratedApplicationDocumentWorkflowResult }>
}

export type MvpWorkflowError =
  | { stage: "search"; code: "SEARCH_FAILURE" | "ALL_SOURCES_FAILED"; message: string }
  | { stage: "selection"; code: "NO_JOBS" | "NO_RELEVANT_JOBS" | "INVALID_SELECTION"; message: string }
  | { stage: "application"; error: ApplicationWorkflowError }
  | { stage: "foundation"; error: import("./application-documents").DocumentFoundationError }
  | { stage: "tailoring"; error: TailoringError }
  | { stage: "rendering"; error: RenderError }
  | { stage: "persistence"; code: "MISSING_DOCUMENT_STORAGE" | "INVALID_DOCUMENT_STORAGE"; message: string }
  | { stage: "persistence"; error: import("./application-document-storage-workflow").ApplicationDocumentStorageWorkflowError }

export type MvpWorkflowResult = MvpWorkflowSuccess | { ok: false; error: MvpWorkflowError; search?: UnifiedSearchResponse; analysis?: CareerAnalysisResult }

/**
 * I/O-free composition of existing Phase 1–4 APIs. IDs, times, repositories,
 * adapters, and search implementation are all supplied by the caller.
 */
export async function runMvpWorkflow(input: MvpWorkflowInput, dependencies: MvpWorkflowDependencies): Promise<MvpWorkflowResult> {
  let retrieval: Awaited<ReturnType<typeof retrieveSearchAwareJobs>>
  try {
    retrieval = await retrieveSearchAwareJobs(
      { search: input.search, targetRoles: input.profile.targetRoles },
      { searchJobs: dependencies.searchJobs },
    )
  } catch (error) {
    return { ok: false, error: { stage: "search", code: "SEARCH_FAILURE", message: error instanceof Error ? error.message : "Job search failed." } }
  }
  if (!retrieval.ok) return { ok: false, search: retrieval.search, error: { stage: "search", code: retrieval.error.code, message: retrieval.error.message } }
  const { search, relevance, eligibleJobs, plan: retrievalPlan } = retrieval.value
  if (search.jobs.length === 0) {
    return { ok: false, search, error: { stage: "selection", code: "NO_JOBS", message: "No usable jobs were found." } }
  }

  const enrichment = await (dependencies.enrichJobDetails ?? enrichJobDetails)(eligibleJobs, input.search.adapters)
  const analysis = analyzeJobs(input.profile, enrichment.jobs)
  if (eligibleJobs.length === 0) {
    return { ok: false, search, analysis, error: { stage: "selection", code: "NO_RELEVANT_JOBS", message: "No search-relevant jobs were found." } }
  }
  if (enrichment.jobs.length === 0) {
    return { ok: false, search, analysis, error: { stage: "selection", code: "NO_RELEVANT_JOBS", message: "No analyzable open jobs were found." } }
  }
  if (!Number.isInteger(input.selectedRank) || input.selectedRank < 0 || input.selectedRank >= analysis.rankedJobs.length) {
    return { ok: false, search, analysis, error: { stage: "selection", code: "INVALID_SELECTION", message: "Selected job rank is outside the ranked result set." } }
  }
  const selectedJob = analysis.rankedJobs[input.selectedRank]
  const applicationResult = await createApplicationWorkflow(dependencies.applicationRepository).startApplication({
    id: input.application.id,
    rankedJob: selectedJob,
    createdAt: input.application.createdAt,
    ...(input.application.allowDuplicate ? { allowDuplicate: true } : {}),
  })
  if (!applicationResult.ok) return { ok: false, search, analysis, error: { stage: "application", error: applicationResult.error } }

  // Do not pass matchingProfile: only explicit document evidence may support document claims.
  const foundation = buildApplicationDocumentFoundation(applicationResult.value, input.documentEvidence)
  if (!foundation.ok) return { ok: false, search, analysis, error: { stage: "foundation", error: foundation.error } }

  if (input.saveDocuments && !input.documentStorage) {
    return { ok: false, search, analysis, error: { stage: "persistence", code: "MISSING_DOCUMENT_STORAGE", message: "Document storage is required when document saving is requested." } }
  }
  if (input.saveDocuments && input.documentStorage!.ids.length !== input.documents.length) {
    return { ok: false, search, analysis, error: { stage: "persistence", code: "INVALID_DOCUMENT_STORAGE", message: "Every rendered document requires one caller-supplied document ID." } }
  }

  const renderedDocuments: MvpRenderedDocument[] = []
  const generatedDocuments: MvpWorkflowSuccess["generatedDocuments"] = []
  for (const [index, document] of input.documents.entries()) {
    const plan = createTailoringPlan(foundation.value, {
      type: document.type,
      language: document.language,
      ...(document.maxEvidenceItems === undefined ? {} : { maxEvidenceItems: document.maxEvidenceItems }),
    } satisfies TailoringOptions)
    if (!plan.ok) return { ok: false, search, analysis, error: { stage: "tailoring", error: plan.error } }
    const rendered = renderApplicationDocument(foundation.value, plan.value)
    if (!rendered.ok) return { ok: false, search, analysis, error: { stage: "rendering", error: rendered.error } }

    if (!input.saveDocuments) {
      renderedDocuments.push({ type: document.type, rendered: rendered.value })
      if (input.generation) {
        const generated = await generateApplicationDocument({
          application: applicationResult.value,
          candidateDocumentInput: input.documentEvidence,
          tailoringOptions: { type: document.type, language: document.language, ...(document.maxEvidenceItems === undefined ? {} : { maxEvidenceItems: document.maxEvidenceItems }) },
          generator: input.generation.generator,
          generationOptions: { untrustedJobDescription: selectedJob.job.description ?? undefined },
        })
        generatedDocuments.push({ type: document.type, result: generated })
      }
      continue
    }
    const storage = createApplicationDocumentStorageWorkflow(dependencies.applicationRepository, input.documentStorage!.repository)
    // Phase 4.5 stores validated generated documents, while this MVP path is deterministic Phase 4.3 rendering only.
    // Keep rendering in-memory instead of inventing a parallel persistence format.
    void storage
    return { ok: false, search, analysis, error: { stage: "persistence", code: "INVALID_DOCUMENT_STORAGE", message: "Deterministic Phase 4.3 drafts are rendered for review but are not Phase 4.5 generated-document records." } }
  }

  return { ok: true, search, relevance, retrievalPlan, enrichment, analysis, selectedJob, application: applicationResult.value, documents: renderedDocuments, generatedDocuments }
}
