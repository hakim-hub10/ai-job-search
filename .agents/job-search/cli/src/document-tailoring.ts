import type {
  ApplicationDocumentFoundation,
  CandidateEvidence,
  CandidateEvidenceKind,
  DocumentLanguage,
  DocumentType,
  DocumentWarning,
  RequirementEvidenceContext,
} from "./application-documents"
import type { RequirementImportance } from "./requirements"

export type TailoringReasonCode =
  | "supports_matched_requirement"
  | "requirement_importance"
  | "secondary_candidate_evidence"
  | "candidate_supplied_motivation"
  | "user_preferred_evidence"

export interface TailoringReason {
  code: TailoringReasonCode
  requirementKey?: string
}

export interface TailoringOptions {
  type: DocumentType
  language: DocumentLanguage
  maxEvidenceItems?: number
  excludedEvidenceIds?: string[]
  preferredEvidenceIds?: string[]
}

export interface TailoringSelection {
  evidenceId: string
  kind: CandidateEvidenceKind
  section: CandidateEvidenceKind
  emphasis: "primary" | "secondary"
  reasons: TailoringReason[]
  supportingRequirementKeys: string[]
  experienceGroupId?: string
}

export interface TailoringSection {
  kind: CandidateEvidenceKind
  evidenceIds: string[]
}

export interface TailoringRequirementSupport {
  requirementKey: string
  status: RequirementEvidenceContext["status"]
  evidenceIds: string[]
}

export type TailoringWarningCode = "SPARSE_RELEVANT_EVIDENCE" | "EXCLUSION_REDUCES_REQUIREMENT_COVERAGE"
export interface TailoringWarning {
  code: TailoringWarningCode
  message: string
  requirementKey?: string
}

export interface TailoringPlan {
  applicationId: string
  type: DocumentType
  language: DocumentLanguage
  selections: TailoringSelection[]
  sections: TailoringSection[]
  requirementSupport: TailoringRequirementSupport[]
  warnings: Array<DocumentWarning | TailoringWarning>
}

export type TailoringErrorCode =
  | "MALFORMED_DOCUMENT_FOUNDATION"
  | "INVALID_TAILORING_OPTIONS"
  | "INVALID_EXCLUSION_ID"
  | "INVALID_PREFERRED_EVIDENCE_ID"
  | "INVALID_TAILORING_PLAN"
  | "UNKNOWN_SELECTED_EVIDENCE"
  | "DUPLICATE_SELECTED_EVIDENCE"
  | "EXCLUDED_EVIDENCE_SELECTED"
  | "INVALID_REQUIREMENT_SUPPORT"
  | "WRONG_APPLICATION_CONTEXT"

export interface TailoringError {
  code: TailoringErrorCode
  message: string
  evidenceId?: string
  requirementKey?: string
}

export type TailoringResult<T> = { ok: true; value: T } | { ok: false; error: TailoringError }
export interface TailoringValidationResult { valid: boolean; errors: TailoringError[] }

const SECTION_ORDER: CandidateEvidenceKind[] = [
  "identity", "summary", "skill", "experience", "achievement", "project", "education", "certification", "language", "motivation", "other",
]
const IMPORTANCE_ORDER: Record<RequirementImportance, number> = {
  required: 0, preferred: 1, useful: 2, optional: 3, unspecified: 4,
}

function failure<T>(code: TailoringErrorCode, message: string, evidenceId?: string): TailoringResult<T> {
  return { ok: false, error: { code, message, ...(evidenceId ? { evidenceId } : {}) } }
}

function validFoundation(foundation: ApplicationDocumentFoundation): boolean {
  return Boolean(foundation?.applicationContext?.applicationId && Array.isArray(foundation.catalog?.evidence) && Array.isArray(foundation.requirements))
}

function supports(evidenceId: string, requirements: RequirementEvidenceContext[]): RequirementEvidenceContext[] {
  return requirements.filter((requirement) => requirement.status === "matched" && requirement.evidenceIds.includes(evidenceId))
}

function relatedToNonMatchedRequirement(evidence: CandidateEvidence, requirements: RequirementEvidenceContext[]): boolean {
  const statusByKey = new Map(requirements.map((requirement) => [requirement.requirement.identity.key, requirement.status]))
  return evidence.requirementKeys.some((key) => {
    const status = statusByKey.get(key)
    return status !== undefined && status !== "matched"
  })
}

function experienceGroupId(evidence: CandidateEvidence): string | undefined {
  if (evidence.kind !== "experience" && evidence.kind !== "achievement" && evidence.kind !== "project") return undefined
  const context = evidence.context
  if (!context?.employer && !context?.role) return undefined
  return [context.employer ?? "", context.role ?? "", context.startDate ?? "", context.endDate ?? ""].join("\u0001")
}

function isComparableDate(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/u.test(value)
}

function importanceFor(evidenceId: string, requirements: RequirementEvidenceContext[]): number {
  const values = supports(evidenceId, requirements).map((requirement) => IMPORTANCE_ORDER[requirement.requirement.importance])
  return values.length ? Math.min(...values) : Number.MAX_SAFE_INTEGER
}

function compareEvidence(a: CandidateEvidence, b: CandidateEvidence, foundation: ApplicationDocumentFoundation, preferred: Set<string>): number {
  const aSupport = supports(a.id, foundation.requirements)
  const bSupport = supports(b.id, foundation.requirements)
  if (Boolean(aSupport.length) !== Boolean(bSupport.length)) return bSupport.length - aSupport.length
  const aImportance = importanceFor(a.id, foundation.requirements)
  const bImportance = importanceFor(b.id, foundation.requirements)
  if (aImportance !== bImportance) return aImportance - bImportance
  if (preferred.has(a.id) !== preferred.has(b.id)) return preferred.has(a.id) ? -1 : 1
  const aSection = SECTION_ORDER.indexOf(a.kind)
  const bSection = SECTION_ORDER.indexOf(b.kind)
  if (aSection !== bSection) return aSection - bSection
  return a.id.localeCompare(b.id)
}

function createReasons(evidence: CandidateEvidence, foundation: ApplicationDocumentFoundation, preferred: Set<string>): TailoringReason[] {
  const matched = supports(evidence.id, foundation.requirements)
  const reasons: TailoringReason[] = []
  for (const requirement of matched) {
    reasons.push({ code: "supports_matched_requirement", requirementKey: requirement.requirement.identity.key })
    if (requirement.requirement.importance !== "unspecified") reasons.push({ code: "requirement_importance", requirementKey: requirement.requirement.identity.key })
  }
  if (evidence.kind === "motivation") reasons.push({ code: "candidate_supplied_motivation" })
  if (preferred.has(evidence.id)) reasons.push({ code: "user_preferred_evidence" })
  if (reasons.length === 0) reasons.push({ code: "secondary_candidate_evidence" })
  return reasons
}

function sortExperienceSelections(selections: TailoringSelection[], catalog: CandidateEvidence[], foundation: ApplicationDocumentFoundation, preferred: Set<string>): TailoringSelection[] {
  const byId = new Map(catalog.map((evidence) => [evidence.id, evidence]))
  return [...selections].sort((a, b) => {
    const aEvidence = byId.get(a.evidenceId)!
    const bEvidence = byId.get(b.evidenceId)!
    if (a.experienceGroupId && b.experienceGroupId && a.experienceGroupId !== b.experienceGroupId) {
      const aDate = aEvidence.context?.startDate
      const bDate = bEvidence.context?.startDate
      if (isComparableDate(aDate) && isComparableDate(bDate) && aDate !== bDate) return bDate.localeCompare(aDate)
    }
    return compareEvidence(aEvidence, bEvidence, foundation, preferred)
  })
}

/** Creates an offline, evidence-only selection and ordering plan. */
export function createTailoringPlan(
  foundation: ApplicationDocumentFoundation,
  options: TailoringOptions,
): TailoringResult<TailoringPlan> {
  if (!validFoundation(foundation)) return failure("MALFORMED_DOCUMENT_FOUNDATION", "Tailoring requires a valid Phase 4.1 document foundation.")
  if (!options || (options.type !== "cv" && options.type !== "coverLetter") || (options.language !== "sv" && options.language !== "en")
    || (options.maxEvidenceItems !== undefined && (!Number.isInteger(options.maxEvidenceItems) || options.maxEvidenceItems < 1))) {
    return failure("INVALID_TAILORING_OPTIONS", "Tailoring options must use a supported document type, language, and positive integer evidence limit.")
  }
  const catalogIds = new Set(foundation.catalog.evidence.map((evidence) => evidence.id))
  const excluded = new Set(options.excludedEvidenceIds ?? [])
  const preferred = new Set(options.preferredEvidenceIds ?? [])
  const invalidExclusion = [...excluded].find((id) => !catalogIds.has(id))
  if (invalidExclusion) return failure("INVALID_EXCLUSION_ID", `Excluded evidence ID "${invalidExclusion}" does not exist.`, invalidExclusion)
  const invalidPreference = [...preferred].find((id) => !catalogIds.has(id))
  if (invalidPreference) return failure("INVALID_PREFERRED_EVIDENCE_ID", `Preferred evidence ID "${invalidPreference}" does not exist.`, invalidPreference)

  const eligible = foundation.catalog.evidence
    .filter((evidence) => !excluded.has(evidence.id) && !relatedToNonMatchedRequirement(evidence, foundation.requirements))
    .sort((a, b) => compareEvidence(a, b, foundation, preferred))
  const limit = options.maxEvidenceItems ?? (options.type === "coverLetter" ? 4 : eligible.length)
  const selected = eligible.slice(0, limit)
  const selections = selected.map((evidence) => ({
    evidenceId: evidence.id,
    kind: evidence.kind,
    section: evidence.kind,
    emphasis: supports(evidence.id, foundation.requirements).length ? "primary" as const : "secondary" as const,
    reasons: createReasons(evidence, foundation, preferred),
    supportingRequirementKeys: supports(evidence.id, foundation.requirements).map((requirement) => requirement.requirement.identity.key),
    ...(experienceGroupId(evidence) ? { experienceGroupId: experienceGroupId(evidence) } : {}),
  }))
  const grouped = new Map<CandidateEvidenceKind, TailoringSelection[]>()
  for (const selection of selections) grouped.set(selection.section, [...(grouped.get(selection.section) ?? []), selection])
  const sections = [...grouped.entries()]
    .sort(([a], [b]) => SECTION_ORDER.indexOf(a) - SECTION_ORDER.indexOf(b))
    .map(([kind, items]) => ({
      kind,
      evidenceIds: (kind === "experience" || kind === "achievement" || kind === "project")
        ? sortExperienceSelections(items, foundation.catalog.evidence, foundation, preferred).map((item) => item.evidenceId)
        : items.map((item) => item.evidenceId),
    }))
  const support = foundation.requirements.map((requirement) => ({
    requirementKey: requirement.requirement.identity.key,
    status: requirement.status,
    evidenceIds: requirement.status === "matched"
      ? requirement.evidenceIds.filter((id) => selections.some((selection) => selection.evidenceId === id))
      : [],
  }))
  const warnings: Array<DocumentWarning | TailoringWarning> = structuredClone(foundation.warnings)
  if (selections.filter((selection) => selection.emphasis === "primary").length === 0) {
    warnings.push({ code: "SPARSE_RELEVANT_EVIDENCE", message: "No selected candidate evidence directly supports a matched job requirement." })
  }
  for (const requirement of foundation.requirements) {
    if (requirement.status === "matched" && requirement.evidenceIds.some((id) => excluded.has(id))) {
      warnings.push({ code: "EXCLUSION_REDUCES_REQUIREMENT_COVERAGE", message: "Excluded evidence reduces matched requirement coverage.", requirementKey: requirement.requirement.identity.key })
    }
  }
  return {
    ok: true,
    value: {
      applicationId: foundation.applicationContext.applicationId,
      type: options.type,
      language: options.language,
      selections,
      sections,
      requirementSupport: support,
      warnings,
    },
  }
}

/** Validates plan references and context; it complements Phase 4.1 claim provenance validation. */
export function validateTailoringPlan(
  foundation: ApplicationDocumentFoundation,
  plan: TailoringPlan,
  options?: Pick<TailoringOptions, "excludedEvidenceIds">,
): TailoringValidationResult {
  const errors: TailoringError[] = []
  if (!validFoundation(foundation) || !plan) return { valid: false, errors: [{ code: "INVALID_TAILORING_PLAN", message: "Tailoring plan and foundation must be valid." }] }
  if (plan.applicationId !== foundation.applicationContext.applicationId) errors.push({ code: "WRONG_APPLICATION_CONTEXT", message: "Tailoring plan applicationId does not match the foundation." })
  const byId = new Map(foundation.catalog.evidence.map((evidence) => [evidence.id, evidence]))
  const selectedIds = new Set<string>()
  const excluded = new Set(options?.excludedEvidenceIds ?? [])
  for (const selection of plan.selections) {
    const evidence = byId.get(selection.evidenceId)
    const duplicate = selectedIds.has(selection.evidenceId)
    if (duplicate) errors.push({ code: "DUPLICATE_SELECTED_EVIDENCE", message: "Evidence may be selected only once.", evidenceId: selection.evidenceId })
    if (!evidence) errors.push({ code: "UNKNOWN_SELECTED_EVIDENCE", message: "Tailoring selection references unknown evidence.", evidenceId: selection.evidenceId })
    else if (excluded.has(selection.evidenceId)) errors.push({ code: "EXCLUDED_EVIDENCE_SELECTED", message: "Excluded evidence cannot be selected.", evidenceId: selection.evidenceId })
    else if (selection.kind !== evidence.kind || selection.section !== evidence.kind || relatedToNonMatchedRequirement(evidence, foundation.requirements)) {
      errors.push({ code: "INVALID_TAILORING_PLAN", message: "Tailoring selection does not preserve evidence category or matched-requirement safety.", evidenceId: selection.evidenceId })
    }
    selectedIds.add(selection.evidenceId)
  }
  const requirementByKey = new Map(foundation.requirements.map((requirement) => [requirement.requirement.identity.key, requirement]))
  for (const support of plan.requirementSupport) {
    const requirement = requirementByKey.get(support.requirementKey)
    if (!requirement || support.status !== requirement.status || (support.status !== "matched" && support.evidenceIds.length > 0)
      || support.evidenceIds.some((id) => !selectedIds.has(id) || !requirement.evidenceIds.includes(id))) {
      errors.push({ code: "INVALID_REQUIREMENT_SUPPORT", message: "Requirement support must reference selected evidence for a matched requirement.", requirementKey: support.requirementKey })
    }
  }
  return { valid: errors.length === 0, errors }
}
