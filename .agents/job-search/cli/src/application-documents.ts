import type { ApplicationRecord } from "./applications"
import type { CandidateProfile } from "./profile"
import {
  createRequirementDescriptor,
  createRequirementIdentity,
  type RequirementCategory,
  type RequirementDescriptor,
} from "./requirements"

export type CandidateEvidenceKind =
  | "identity"
  | "summary"
  | "experience"
  | "skill"
  | "education"
  | "certification"
  | "language"
  | "project"
  | "achievement"
  | "motivation"
  | "other"

export interface CandidateEvidenceContext {
  employer?: string
  role?: string
  location?: string
  startDate?: string
  endDate?: string
}

/** A caller-supplied requirement relationship; its canonical key is derived mechanically. */
export interface CandidateEvidenceRequirement {
  category: RequirementCategory
  value: string
}

/** Candidate-supplied, claim-supporting material. IDs are caller controlled. */
export interface CandidateDocumentEvidence {
  id: string
  kind: CandidateEvidenceKind
  content: string
  context?: CandidateEvidenceContext
  relatedRequirements?: CandidateEvidenceRequirement[]
}

export interface CandidateDocumentIdentity {
  fullName?: string
  email?: string
  phone?: string
  location?: string
  links?: string[]
}

/**
 * Deliberately separate from CandidateProfile: this is the document source of
 * truth, while matchingProfile remains a Phase 2 input and relevance signal.
 */
export interface CandidateDocumentInput {
  matchingProfile?: CandidateProfile
  identity?: CandidateDocumentIdentity
  evidence?: CandidateDocumentEvidence[]
}

export interface CandidateEvidence extends CandidateDocumentEvidence {
  source: "candidateDocumentInput" | "matchingProfile"
  requirementKeys: string[]
}

export interface CandidateEvidenceCatalog {
  evidence: CandidateEvidence[]
}

export type DocumentRequirementStatus = "matched" | "missing" | "conflicting" | "unknown"

export interface RequirementEvidenceContext {
  requirement: RequirementDescriptor
  status: DocumentRequirementStatus
  evidenceIds: string[]
}

export type DocumentWarningCode =
  | "SPARSE_CANDIDATE_EVIDENCE"
  | "UNSUPPORTED_JOB_REQUIREMENT"
  | "LOW_JOB_EVIDENCE_CONFIDENCE"
  | "MISSING_MOTIVATION"

export interface DocumentWarning {
  code: DocumentWarningCode
  message: string
  requirementKey?: string
}

export type DocumentFoundationErrorCode =
  | "INVALID_CANDIDATE_DOCUMENT_INPUT"
  | "DUPLICATE_EVIDENCE_ID"
  | "MALFORMED_APPLICATION_CONTEXT"
  | "UNSUPPORTED_LANGUAGE"
  | "INVALID_DOCUMENT_DRAFT"
  | "MISSING_EVIDENCE_REFERENCE"
  | "UNKNOWN_EVIDENCE_ID"
  | "UNSUPPORTED_CLAIM"
  | "WRONG_APPLICATION_CONTEXT"

export interface DocumentFoundationError {
  code: DocumentFoundationErrorCode
  message: string
  claimId?: string
  evidenceId?: string
}

export type DocumentFoundationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DocumentFoundationError }

export interface ApplicationDocumentContext {
  applicationId: string
  jobId: string
  source: string
  sourceId: string | null
  jobTitle: string
  company: string | null
  confidence: number
  confidenceLabel: "high" | "medium" | "low"
}

export interface ApplicationDocumentFoundation {
  applicationContext: ApplicationDocumentContext
  catalog: CandidateEvidenceCatalog
  requirements: RequirementEvidenceContext[]
  warnings: DocumentWarning[]
}

export type DocumentType = "cv" | "coverLetter"
export type DocumentLanguage = "sv" | "en"

export interface DocumentClaim {
  id: string
  kind: "candidateFact" | "neutralContext"
  content: string
  evidenceIds: string[]
}

export interface DocumentDraftSection {
  id: string
  kind: CandidateEvidenceKind | "context"
  claims: DocumentClaim[]
}

/** Structured preparation data only. It is not rendered prose or a final document. */
export interface StructuredDocumentDraft {
  applicationId: string
  type: DocumentType
  language: DocumentLanguage
  sections: DocumentDraftSection[]
  warnings: DocumentWarning[]
}

export interface CreateStructuredDocumentDraftInput {
  type: DocumentType
  language: string
}

export interface DocumentValidationResult {
  valid: boolean
  errors: DocumentFoundationError[]
  warnings: DocumentWarning[]
}

function failure<T>(code: DocumentFoundationErrorCode, message: string): DocumentFoundationResult<T> {
  return { ok: false, error: { code, message } }
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function cloneContext(context: CandidateEvidenceContext | undefined): CandidateEvidenceContext | undefined {
  return context ? structuredClone(context) : undefined
}

function requirementKeys(requirements: CandidateEvidenceRequirement[] | undefined): string[] {
  if (!requirements) return []
  return requirements.map(({ category, value }) => createRequirementIdentity(category, value).key)
}

function profileEvidence(profile: CandidateProfile): CandidateDocumentEvidence[] {
  const result: CandidateDocumentEvidence[] = []
  const add = (id: string, kind: CandidateEvidenceKind, content: string, relatedRequirements?: CandidateEvidenceRequirement[], context?: CandidateEvidenceContext) => {
    if (hasText(content)) result.push({ id, kind, content, ...(relatedRequirements ? { relatedRequirements } : {}), ...(context ? { context } : {}) })
  }

  add("profile:headline", "summary", profile.headline)
  if (profile.summary) add("profile:summary", "summary", profile.summary)
  profile.skills.technical.forEach((skill, index) => add(`profile:technical-skill:${index}`, "skill", skill, [{ category: "skill", value: skill }]))
  profile.skills.soft.forEach((skill, index) => add(`profile:soft-skill:${index}`, "skill", skill, [{ category: "skill", value: skill }]))
  profile.workExperience.forEach((experience, index) => {
    const content = experience.summary?.trim() || `${experience.title} at ${experience.company}`
    add(`profile:experience:${index}`, "experience", content, undefined, {
      employer: experience.company,
      role: experience.title,
      location: experience.location,
      startDate: experience.startDate,
      endDate: experience.endDate,
    })
  })
  profile.education.forEach((education, index) => add(`profile:education:${index}`, "education", `${education.degree} in ${education.field}, ${education.institution}`))
  profile.certifications.forEach((certification, index) => add(`profile:certification:${index}`, "certification", certification, [{ category: "certification", value: certification }]))
  profile.languages.forEach((language, index) => add(`profile:language:${index}`, "language", `${language.name}: ${language.level}`, [{ category: "language", value: language.name }]))
  return result
}

function identityEvidence(identity: CandidateDocumentIdentity | undefined): CandidateDocumentEvidence[] {
  if (!identity) return []
  const fields: Array<[string, string | undefined]> = [
    ["full-name", identity.fullName],
    ["email", identity.email],
    ["phone", identity.phone],
    ["location", identity.location],
  ]
  const evidence = fields.flatMap(([field, content]) => hasText(content)
    ? [{ id: `document:identity:${field}`, kind: "identity" as const, content }]
    : [])
  return [
    ...evidence,
    ...(identity.links ?? []).flatMap((link, index) => hasText(link)
      ? [{ id: `document:identity:link:${index}`, kind: "identity" as const, content: link }]
      : []),
  ]
}

/** Builds a detached, deterministic catalog from candidate data only. */
export function buildCandidateEvidenceCatalog(input: CandidateDocumentInput): DocumentFoundationResult<CandidateEvidenceCatalog> {
  if (!input || typeof input !== "object") {
    return failure("INVALID_CANDIDATE_DOCUMENT_INPUT", "Candidate document input must be an object.")
  }
  const supplied = input.evidence ?? []
  if (!Array.isArray(supplied)) {
    return failure("INVALID_CANDIDATE_DOCUMENT_INPUT", "Candidate document evidence must be an array when provided.")
  }

  const sourceEntries: Array<{ source: CandidateEvidence["source"]; entry: CandidateDocumentEvidence }> = [
    ...identityEvidence(input.identity).map((entry) => ({ source: "candidateDocumentInput" as const, entry })),
    ...supplied.map((entry) => ({ source: "candidateDocumentInput" as const, entry })),
    ...(input.matchingProfile ? profileEvidence(input.matchingProfile).map((entry) => ({ source: "matchingProfile" as const, entry })) : []),
  ]

  const ids = new Set<string>()
  const evidence: CandidateEvidence[] = []
  for (const { source, entry } of sourceEntries) {
    if (!hasText(entry?.id) || !hasText(entry?.content)) {
      return failure("INVALID_CANDIDATE_DOCUMENT_INPUT", "Every candidate evidence item must have a non-empty id and content.")
    }
    if (ids.has(entry.id)) {
      return failure("DUPLICATE_EVIDENCE_ID", `Candidate evidence ID "${entry.id}" is duplicated.`)
    }
    if (entry.relatedRequirements?.some((requirement) => !hasText(requirement.value))) {
      return failure("INVALID_CANDIDATE_DOCUMENT_INPUT", "Related candidate requirements must have non-empty values.")
    }
    ids.add(entry.id)
    evidence.push({
      id: entry.id,
      kind: entry.kind,
      content: entry.content,
      ...(entry.context ? { context: cloneContext(entry.context) } : {}),
      ...(entry.relatedRequirements ? { relatedRequirements: structuredClone(entry.relatedRequirements) } : {}),
      source,
      requirementKeys: requirementKeys(entry.relatedRequirements),
    })
  }

  return { ok: true, value: { evidence } }
}

function isApplicationContext(record: ApplicationRecord): boolean {
  return hasText(record?.id)
    && hasText(record?.jobSnapshot?.id)
    && hasText(record.jobSnapshot.title)
    && typeof record.analysisSnapshot?.scoringResult?.confidence === "number"
    && (record.analysisSnapshot.scoringResult.confidenceLabel === "high"
      || record.analysisSnapshot.scoringResult.confidenceLabel === "medium"
      || record.analysisSnapshot.scoringResult.confidenceLabel === "low")
}

function technicalRequirementStatus(record: ApplicationRecord, skill: string): DocumentRequirementStatus {
  const evidence = [
    ...record.analysisSnapshot.matchingResult.matched,
    ...record.analysisSnapshot.matchingResult.missing,
    ...record.analysisSnapshot.matchingResult.conflicting,
    ...record.analysisSnapshot.matchingResult.unknown,
  ].find((item) => item.dimension === "technicalSkills")
  if (!evidence) return "unknown"
  if (evidence.requirementCoverage?.matchedRequirements.includes(skill)) return "matched"
  if (evidence.requirementCoverage?.missingRequirements.includes(skill)) return "missing"
  return evidence.status
}

function buildRequirementContext(record: ApplicationRecord, catalog: CandidateEvidenceCatalog): RequirementEvidenceContext[] {
  return record.jobSnapshot.skills.map((skill) => {
    const requirement = createRequirementDescriptor("skill", skill)
    const status = technicalRequirementStatus(record, skill)
    const evidenceIds = status === "matched"
      ? catalog.evidence.filter((item) => item.requirementKeys.includes(requirement.identity.key)).map((item) => item.id)
      : []
    return { requirement, status, evidenceIds }
  })
}

function buildWarnings(record: ApplicationRecord, catalog: CandidateEvidenceCatalog, requirements: RequirementEvidenceContext[]): DocumentWarning[] {
  const warnings: DocumentWarning[] = []
  if (catalog.evidence.length < 3) {
    warnings.push({ code: "SPARSE_CANDIDATE_EVIDENCE", message: "Candidate document evidence is sparse; no missing facts were inferred." })
  }
  if (record.analysisSnapshot.scoringResult.confidence < 0.5) {
    warnings.push({ code: "LOW_JOB_EVIDENCE_CONFIDENCE", message: "Job evidence coverage is low; document targeting is limited by sparse job information." })
  }
  for (const requirement of requirements) {
    if (requirement.status !== "matched" || requirement.evidenceIds.length === 0) {
      warnings.push({
        code: "UNSUPPORTED_JOB_REQUIREMENT",
        message: `No candidate evidence supports job requirement "${requirement.requirement.identity.original}".`,
        requirementKey: requirement.requirement.identity.key,
      })
    }
  }
  return warnings
}

/** Combines immutable application context with candidate-only evidence; it never performs job enrichment. */
export function buildApplicationDocumentFoundation(
  record: ApplicationRecord,
  input: CandidateDocumentInput,
): DocumentFoundationResult<ApplicationDocumentFoundation> {
  if (!isApplicationContext(record)) {
    return failure("MALFORMED_APPLICATION_CONTEXT", "Application document preparation requires a valid application snapshot.")
  }
  const catalogResult = buildCandidateEvidenceCatalog(input)
  if (!catalogResult.ok) return catalogResult
  const catalog = catalogResult.value
  const requirements = buildRequirementContext(record, catalog)
  const scoring = record.analysisSnapshot.scoringResult
  return {
    ok: true,
    value: {
      applicationContext: {
        applicationId: record.id,
        jobId: record.jobSnapshot.id,
        source: record.jobSnapshot.source,
        sourceId: record.jobSnapshot.sourceId,
        jobTitle: record.jobSnapshot.title,
        company: record.jobSnapshot.company,
        confidence: scoring.confidence,
        confidenceLabel: scoring.confidenceLabel,
      },
      catalog,
      requirements,
      warnings: buildWarnings(record, catalog, requirements),
    },
  }
}

function sectionKind(kind: CandidateEvidenceKind): CandidateEvidenceKind {
  return kind
}

/** Creates deterministic, evidence-verbatim claim units. No prose, rendering, or AI is involved. */
export function createStructuredDocumentDraft(
  foundation: ApplicationDocumentFoundation,
  input: CreateStructuredDocumentDraftInput,
): DocumentFoundationResult<StructuredDocumentDraft> {
  if (input?.language !== "sv" && input?.language !== "en") {
    return failure("UNSUPPORTED_LANGUAGE", "Phase 4.1 supports only " + "\"sv\" and \"en\" document language identifiers.")
  }
  if (input.type !== "cv" && input.type !== "coverLetter") {
    return failure("INVALID_DOCUMENT_DRAFT", "Document type must be \"cv\" or \"coverLetter\".")
  }

  const prioritizedIds = foundation.requirements.flatMap((requirement) => requirement.evidenceIds)
  const selectedIds = [...new Set([...prioritizedIds, ...foundation.catalog.evidence.map((item) => item.id)])]
  const nonMatchedRequirementKeys = new Set(
    foundation.requirements
      .filter((requirement) => requirement.status !== "matched")
      .map((requirement) => requirement.requirement.identity.key),
  )
  // Candidate evidence remains in the catalog, but a fact explicitly linked to
  // a non-matched job requirement is not promoted into this job's draft.
  const selected = selectedIds
    .flatMap((id) => foundation.catalog.evidence.filter((item) => item.id === id))
    .filter((item) => !item.requirementKeys.some((key) => nonMatchedRequirementKeys.has(key)))
  const sections: DocumentDraftSection[] = []
  for (const evidence of selected) {
    let section = sections.find((item) => item.kind === sectionKind(evidence.kind))
    if (!section) {
      section = { id: `section:${evidence.kind}`, kind: sectionKind(evidence.kind), claims: [] }
      sections.push(section)
    }
    section.claims.push({
      id: `claim:${evidence.id}`,
      kind: "candidateFact",
      content: evidence.content,
      evidenceIds: [evidence.id],
    })
  }
  const warnings = [
    ...foundation.warnings,
    ...(input.type === "coverLetter" && !selected.some((item) => item.kind === "motivation")
      ? [{ code: "MISSING_MOTIVATION" as const, message: "No candidate-supplied motivation is available; none was invented." }]
      : []),
  ]
  return {
    ok: true,
    value: {
      applicationId: foundation.applicationContext.applicationId,
      type: input.type,
      language: input.language,
      sections,
      warnings,
    },
  }
}

/**
 * Validates provenance structurally. Phase 4.1 factual claims must be
 * evidence-verbatim, so unsupported rewrites cannot become valid silently.
 */
export function validateStructuredDocumentDraft(
  foundation: ApplicationDocumentFoundation,
  draft: StructuredDocumentDraft,
): DocumentValidationResult {
  const errors: DocumentFoundationError[] = []
  if (draft?.applicationId !== foundation.applicationContext.applicationId) {
    errors.push({ code: "WRONG_APPLICATION_CONTEXT", message: "Draft applicationId does not match the document foundation." })
  }
  const evidenceById = new Map(foundation.catalog.evidence.map((evidence) => [evidence.id, evidence]))
  const requirementStatusByKey = new Map(
    foundation.requirements.map((requirement) => [requirement.requirement.identity.key, requirement.status]),
  )
  for (const section of draft?.sections ?? []) {
    for (const claim of section.claims) {
      if (claim.kind !== "candidateFact") continue
      if (claim.evidenceIds.length === 0) {
        errors.push({ code: "MISSING_EVIDENCE_REFERENCE", message: "Candidate claims must reference candidate evidence.", claimId: claim.id })
        continue
      }
      const referenced = claim.evidenceIds.map((id) => evidenceById.get(id))
      const unknownId = claim.evidenceIds.find((id) => !evidenceById.has(id))
      if (unknownId) {
        errors.push({ code: "UNKNOWN_EVIDENCE_ID", message: `Claim references unknown candidate evidence ID "${unknownId}".`, claimId: claim.id, evidenceId: unknownId })
        continue
      }
      if (!referenced.some((evidence) => evidence?.content === claim.content)) {
        errors.push({ code: "UNSUPPORTED_CLAIM", message: "Candidate claim content is not supported verbatim by its referenced evidence.", claimId: claim.id })
      }
      if (referenced.some((evidence) => evidence?.requirementKeys.some((key) => {
        const status = requirementStatusByKey.get(key)
        return status !== undefined && status !== "matched"
      }))) {
        errors.push({ code: "UNSUPPORTED_CLAIM", message: "Candidate claim is linked to a non-matched job requirement and cannot be promoted into this draft.", claimId: claim.id })
      }
    }
  }
  return { valid: errors.length === 0, errors, warnings: structuredClone(foundation.warnings) }
}
