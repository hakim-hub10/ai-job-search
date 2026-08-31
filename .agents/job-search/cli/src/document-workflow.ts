import type { ApplicationRecord } from "./applications"
import {
  buildApplicationDocumentFoundation,
  type CandidateDocumentInput,
  type DocumentFoundationError,
} from "./application-documents"
import {
  generateDocumentProposal,
  type ApplicationDocumentGenerator,
  type DocumentGenerationError,
  type DocumentGenerationOptions,
  type ProviderGenerationError,
} from "./document-generation"
import {
  renderGeneratedApplicationDocument,
  type GeneratedApplicationDocument,
  type GeneratedDocumentRenderResult,
  type RenderError,
} from "./document-rendering"
import { createTailoringPlan, type TailoringError, type TailoringOptions } from "./document-tailoring"

export interface GenerateApplicationDocumentInput {
  application: ApplicationRecord
  candidateDocumentInput: CandidateDocumentInput
  tailoringOptions: TailoringOptions
  generator: ApplicationDocumentGenerator
  generationOptions?: DocumentGenerationOptions
}

export interface GeneratedApplicationDocumentResult {
  document: GeneratedApplicationDocument
  renderedDocument: GeneratedDocumentRenderResult
}

export type GeneratedApplicationDocumentError =
  | { stage: "foundation"; error: DocumentFoundationError }
  | { stage: "tailoring"; error: TailoringError }
  | { stage: "generation"; error: ProviderGenerationError | DocumentGenerationError }
  | { stage: "conversion"; error: { code: "INVALID_GENERATED_DOCUMENT"; message: string } }
  | { stage: "rendering"; error: RenderError }

export type GeneratedApplicationDocumentWorkflowResult =
  | { ok: true; value: GeneratedApplicationDocumentResult }
  | { ok: false; error: GeneratedApplicationDocumentError }

function freeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child)
  return value
}

/** Converts only Phase 4.4.1-validated output into the public generated-document model. */
function toGeneratedApplicationDocument(
  applicationId: string,
  proposal: { applicationId: string; type: "cv" | "coverLetter"; language: "sv" | "en"; sections: GeneratedApplicationDocument["sections"] },
  requiresHumanReview: boolean,
  warnings: GeneratedApplicationDocument["warnings"],
): { ok: true; value: GeneratedApplicationDocument } | { ok: false; error: { code: "INVALID_GENERATED_DOCUMENT"; message: string } } {
  if (proposal.applicationId !== applicationId || !Array.isArray(proposal.sections)) {
    return { ok: false, error: { code: "INVALID_GENERATED_DOCUMENT", message: "Validated generated content does not preserve the application context." } }
  }
  return {
    ok: true,
    value: freeze({
      applicationId,
      documentType: proposal.type,
      language: proposal.language,
      sections: structuredClone(proposal.sections),
      requiresHumanReview,
      warnings: structuredClone(warnings),
    }),
  }
}

/**
 * Thin, provider-neutral, in-memory orchestration of the Phase 4 document
 * foundation, tailoring, validated generation, and generated Markdown stages.
 */
export async function generateApplicationDocument(
  input: GenerateApplicationDocumentInput,
): Promise<GeneratedApplicationDocumentWorkflowResult> {
  const foundation = buildApplicationDocumentFoundation(input.application, input.candidateDocumentInput)
  if (!foundation.ok) return { ok: false, error: { stage: "foundation", error: foundation.error } }

  const plan = createTailoringPlan(foundation.value, input.tailoringOptions)
  if (!plan.ok) return { ok: false, error: { stage: "tailoring", error: plan.error } }

  const generated = await generateDocumentProposal(foundation.value, plan.value, input.generator, input.generationOptions)
  if (!generated.ok) return { ok: false, error: { stage: "generation", error: generated.error } }

  const document = toGeneratedApplicationDocument(
    foundation.value.applicationContext.applicationId,
    generated.value.proposal,
    generated.value.requiresHumanReview,
    plan.value.warnings,
  )
  if (!document.ok) return { ok: false, error: { stage: "conversion", error: document.error } }

  const rendered = renderGeneratedApplicationDocument(document.value)
  if (!rendered.ok) return { ok: false, error: { stage: "rendering", error: rendered.error } }
  return { ok: true, value: { document: document.value, renderedDocument: rendered.value } }
}
