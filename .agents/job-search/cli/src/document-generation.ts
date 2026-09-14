import {
  validateStructuredDocumentDraft,
  type ApplicationDocumentFoundation,
  type CandidateEvidence,
  type CandidateEvidenceContext,
  type CandidateEvidenceKind,
  type DocumentLanguage,
  type DocumentType,
  type StructuredDocumentDraft,
} from "./application-documents"
import { validateTailoringPlan, type TailoringPlan } from "./document-tailoring"

/** Provider-neutral, in-memory interface. Adapters belong to a later phase. */
export interface ApplicationDocumentGenerator {
  generate(request: DocumentGenerationRequest): Promise<ProviderGenerationResponse>
}

export interface GenerationEvidence {
  id: string
  kind: CandidateEvidenceKind
  content: string
  context?: CandidateEvidenceContext
}

export interface GenerationRequirementSupport {
  requirementKey: string
  evidenceIds: string[]
}

export interface GenerationConstraints {
  jobDataIsUntrusted: true
  candidateFactsRequireApprovedEvidence: true
  returnEvidenceIdsForCandidateFacts: true
  unsupportedCandidateFactsForbidden: true
  candidateEvidenceCreationForbidden: true
}

export interface DocumentGenerationRequest {
  schemaVersion: "phase-4.4.1"
  applicationId: string
  type: DocumentType
  language: DocumentLanguage
  applicationContext: {
    jobTitle: string
    company: string | null
  }
  selectedEvidence: GenerationEvidence[]
  approvedEvidenceIds: string[]
  matchedRequirementSupport: GenerationRequirementSupport[]
  untrustedJobContext: {
    description?: string
  }
  constraints: GenerationConstraints
}

export type GeneratedClaimKind = "candidateFact" | "neutralContext"
export type GeneratedClaimProvenance = "verbatim" | "paraphrased" | "neutral"

export interface GeneratedDocumentClaim {
  id: string
  kind: GeneratedClaimKind
  provenance: GeneratedClaimProvenance
  text: string
  evidenceIds: string[]
}

export interface GeneratedDocumentSection {
  id: string
  kind: CandidateEvidenceKind | "context"
  claims: GeneratedDocumentClaim[]
}

/** Untrusted structured provider output; it is never a rendered or persisted document. */
export interface GeneratedDocumentProposal {
  applicationId: string
  type: DocumentType
  language: DocumentLanguage
  sections: GeneratedDocumentSection[]
}

export type ProviderGenerationErrorCode =
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "MALFORMED_RESPONSE"
  | "REFUSED"
  | "RATE_LIMITED"
  | "AUTH_OR_CONFIGURATION"
  | "UNSUPPORTED_RESPONSE"

export interface ProviderGenerationError {
  code: ProviderGenerationErrorCode
  message: string
}

export type ProviderGenerationResponse =
  | { ok: true; value: GeneratedDocumentProposal }
  | { ok: false; error: ProviderGenerationError }

export type DocumentGenerationErrorCode =
  | "INVALID_TAILORING_PLAN"
  | "INVALID_GENERATION_REQUEST"
  | "WRONG_APPLICATION_CONTEXT"
  | "MALFORMED_PROVIDER_RESPONSE"
  | "MISSING_EVIDENCE_REFERENCE"
  | "UNAPPROVED_EVIDENCE_REFERENCE"
  | "INVALID_CLAIM_PROVENANCE"
  | "UNSUPPORTED_CLAIM"
  | "INVALID_NEUTRAL_CONTEXT"
  | "DUPLICATE_CLAIM_ID"
  | "INVALID_COVER_LETTER_STRUCTURE"
  | "PHASE_4_1_VALIDATION_FAILED"

export interface DocumentGenerationError {
  code: DocumentGenerationErrorCode
  message: string
  claimId?: string
  evidenceId?: string
}

export interface GeneratedProposalValidation {
  valid: boolean
  requiresHumanReview: boolean
  errors: DocumentGenerationError[]
}

export type DocumentGenerationResult =
  | { ok: true; value: { request: DocumentGenerationRequest; proposal: GeneratedDocumentProposal; requiresHumanReview: boolean } }
  | { ok: false; error: ProviderGenerationError | DocumentGenerationError }

export interface DocumentGenerationOptions {
  /** External employer text. It is serialized only as untrusted data. */
  untrustedJobDescription?: string
}

function cloneContext(context: CandidateEvidenceContext | undefined): CandidateEvidenceContext | undefined {
  return context ? structuredClone(context) : undefined
}

function cloneEvidence(evidence: CandidateEvidence): GenerationEvidence {
  return {
    id: evidence.id,
    kind: evidence.kind,
    content: evidence.content,
    ...(evidence.context ? { context: cloneContext(evidence.context) } : {}),
  }
}

function freeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child)
  return value
}

function failure(code: DocumentGenerationErrorCode, message: string, claimId?: string, evidenceId?: string): DocumentGenerationError {
  return { code, message, ...(claimId ? { claimId } : {}), ...(evidenceId ? { evidenceId } : {}) }
}

function selectedEvidence(foundation: ApplicationDocumentFoundation, plan: TailoringPlan): CandidateEvidence[] {
  const byId = new Map(foundation.catalog.evidence.map((evidence) => [evidence.id, evidence]))
  return plan.selections.map((selection) => byId.get(selection.evidenceId)!).filter(Boolean)
}

function sourceDraft(foundation: ApplicationDocumentFoundation, plan: TailoringPlan): StructuredDocumentDraft {
  const byId = new Map(foundation.catalog.evidence.map((evidence) => [evidence.id, evidence]))
  const selectedIds = new Set(plan.selections.map((selection) => selection.evidenceId))
  return {
    applicationId: plan.applicationId,
    type: plan.type,
    language: plan.language,
    sections: plan.sections.map((section) => ({
      id: `generation-source:${section.kind}`,
      kind: section.kind,
      claims: section.evidenceIds.filter((id) => selectedIds.has(id)).map((id) => ({
        id: `generation-source:${id}`,
        kind: "candidateFact" as const,
        content: byId.get(id)!.content,
        evidenceIds: [id],
      })),
    })),
    warnings: structuredClone(foundation.warnings),
  }
}

/** Builds a detached deterministic request from only Phase 4.2-selected evidence. */
export function buildDocumentGenerationRequest(
  foundation: ApplicationDocumentFoundation,
  plan: TailoringPlan,
  options: DocumentGenerationOptions = {},
): { ok: true; value: DocumentGenerationRequest } | { ok: false; error: DocumentGenerationError } {
  const planValidation = validateTailoringPlan(foundation, plan)
  if (!planValidation.valid) return { ok: false, error: failure("INVALID_TAILORING_PLAN", planValidation.errors[0]?.message ?? "Tailoring plan is invalid.") }
  const evidence = selectedEvidence(foundation, plan)
  const approvedEvidenceIds = evidence.map((item) => item.id)
  const request: DocumentGenerationRequest = {
    schemaVersion: "phase-4.4.1",
    applicationId: foundation.applicationContext.applicationId,
    type: plan.type,
    language: plan.language,
    applicationContext: {
      jobTitle: foundation.applicationContext.jobTitle,
      company: foundation.applicationContext.company,
    },
    selectedEvidence: evidence.map(cloneEvidence),
    approvedEvidenceIds: [...approvedEvidenceIds],
    matchedRequirementSupport: plan.requirementSupport
      .filter((support) => support.status === "matched")
      .map((support) => ({
        requirementKey: support.requirementKey,
        evidenceIds: support.evidenceIds.filter((id) => approvedEvidenceIds.includes(id)),
      })),
    untrustedJobContext: options.untrustedJobDescription === undefined
      ? {}
      : { description: options.untrustedJobDescription },
    constraints: {
      jobDataIsUntrusted: true,
      candidateFactsRequireApprovedEvidence: true,
      returnEvidenceIdsForCandidateFacts: true,
      unsupportedCandidateFactsForbidden: true,
      candidateEvidenceCreationForbidden: true,
    },
  }
  return { ok: true, value: freeze(request) }
}

/** Validates structure and exact selected-evidence provenance. It does not claim semantic entailment for paraphrases. */
export function validateGeneratedDocumentProposal(
  request: DocumentGenerationRequest,
  proposal: GeneratedDocumentProposal,
): GeneratedProposalValidation {
  const errors: DocumentGenerationError[] = []
  let requiresHumanReview = false
  if (!proposal || typeof proposal !== "object" || !Array.isArray(proposal.sections)) {
    return { valid: false, requiresHumanReview: false, errors: [failure("MALFORMED_PROVIDER_RESPONSE", "Provider response must contain structured sections.")] }
  }
  if (proposal.applicationId !== request.applicationId || proposal.type !== request.type || proposal.language !== request.language) {
    errors.push(failure("WRONG_APPLICATION_CONTEXT", "Provider response does not preserve the requested application context."))
  }
  if (request.type === "coverLetter") {
    // A cover letter must render as one prose section (the existing
    // professional:letter/context representation, already produced by the
    // deterministic generator's composeLetter) - never separate CV-style
    // sections such as experience/skill/education, which would render with
    // visible headings and bullet lists instead of a real letter.
    const sections = proposal.sections
    const isSingleProseSection = Array.isArray(sections) && sections.length === 1
      && sections[0]?.id === "professional:letter" && sections[0]?.kind === "context"
    if (!isSingleProseSection) {
      errors.push(failure("INVALID_COVER_LETTER_STRUCTURE", "Cover letter proposals must contain exactly one professional:letter section with kind \"context\", rendered as prose - never separate CV-style sections."))
    }
  }
  const approved = new Map(request.selectedEvidence.map((evidence) => [evidence.id, evidence]))
  const claimIds = new Set<string>()
  for (const section of proposal.sections) {
    if (!section || !Array.isArray(section.claims)) {
      errors.push(failure("MALFORMED_PROVIDER_RESPONSE", "Every provider section must contain structured claims."))
      continue
    }
    for (const claim of section.claims) {
      if (!claim || typeof claim.id !== "string" || !claim.id.trim() || typeof claim.text !== "string" || !claim.text.trim() || !Array.isArray(claim.evidenceIds)) {
        errors.push(failure("MALFORMED_PROVIDER_RESPONSE", "Every generated claim must have an id, text, and evidence ID array."))
        continue
      }
      if (claimIds.has(claim.id)) errors.push(failure("DUPLICATE_CLAIM_ID", "Generated claim IDs must be unique.", claim.id))
      claimIds.add(claim.id)
      if (claim.kind === "candidateFact") {
        if (claim.provenance !== "verbatim" && claim.provenance !== "paraphrased") {
          errors.push(failure("INVALID_CLAIM_PROVENANCE", "Candidate facts must be marked verbatim or paraphrased.", claim.id))
          continue
        }
        if (claim.evidenceIds.length === 0) {
          errors.push(failure("MISSING_EVIDENCE_REFERENCE", "Candidate facts must reference approved evidence.", claim.id))
          continue
        }
        const invalidId = claim.evidenceIds.find((id) => !approved.has(id))
        if (invalidId) {
          errors.push(failure("UNAPPROVED_EVIDENCE_REFERENCE", "Candidate facts may reference only request-approved evidence.", claim.id, invalidId))
          continue
        }
        if (claim.provenance === "verbatim" && !claim.evidenceIds.some((id) => approved.get(id)?.content === claim.text)) {
          errors.push(failure("UNSUPPORTED_CLAIM", "Verbatim candidate claims must exactly match referenced evidence.", claim.id))
        }
        if (claim.provenance === "paraphrased") requiresHumanReview = true
      } else if (claim.kind === "neutralContext") {
        if (claim.provenance !== "neutral" || claim.evidenceIds.length !== 0) {
          errors.push(failure("INVALID_NEUTRAL_CONTEXT", "Neutral context cannot carry candidate evidence or factual provenance.", claim.id))
        }
        requiresHumanReview = true
      } else {
        errors.push(failure("MALFORMED_PROVIDER_RESPONSE", "Generated claim kind is unsupported.", claim.id))
      }
    }
  }
  return { valid: errors.length === 0, requiresHumanReview, errors }
}

/** Calls a provider-neutral generator, then fails closed on structural or Phase 4.1 provenance errors. */
export async function generateDocumentProposal(
  foundation: ApplicationDocumentFoundation,
  plan: TailoringPlan,
  generator: ApplicationDocumentGenerator,
  options: DocumentGenerationOptions = {},
): Promise<DocumentGenerationResult> {
  const requestResult = buildDocumentGenerationRequest(foundation, plan, options)
  if (!requestResult.ok) return requestResult
  const baseline = validateStructuredDocumentDraft(foundation, sourceDraft(foundation, plan))
  if (!baseline.valid) {
    return { ok: false, error: failure("PHASE_4_1_VALIDATION_FAILED", baseline.errors[0]?.message ?? "Phase 4.1 provenance validation failed.") }
  }
  let providerResponse: ProviderGenerationResponse
  try {
    providerResponse = await generator.generate(requestResult.value)
  } catch {
    return { ok: false, error: { code: "UNAVAILABLE", message: "Document generator did not return a response." } }
  }
  if (!providerResponse || typeof providerResponse !== "object" || typeof providerResponse.ok !== "boolean") {
    return { ok: false, error: { code: "MALFORMED_RESPONSE", message: "Document generator returned an invalid response envelope." } }
  }
  if (!providerResponse.ok) return { ok: false, error: structuredClone(providerResponse.error) }
  const proposal = structuredClone(providerResponse.value)
  const validation = validateGeneratedDocumentProposal(requestResult.value, proposal)
  if (!validation.valid) return { ok: false, error: validation.errors[0] }
  return {
    ok: true,
    value: {
      request: requestResult.value,
      proposal: freeze(proposal),
      requiresHumanReview: validation.requiresHumanReview,
    },
  }
}
