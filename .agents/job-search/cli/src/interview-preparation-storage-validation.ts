import { buildCandidateEvidenceCatalog } from "./application-documents"
import { createRequirementIdentity } from "./requirements"
import type { InterviewPreparationRecord } from "./interview-preparation-repository"

// Validate storage shapes before calling domain helpers. Reject extra fields,
// including answer payloads, throughout the snapshot.
type Check = (value: unknown) => boolean
const text: Check = (value) => typeof value === "string" && value.trim().length > 0
const string: Check = (value) => typeof value === "string"
const boolean: Check = (value) => typeof value === "boolean"
const oneOf = (...values: string[]): Check => (value) => typeof value === "string" && values.includes(value)
const array = (check: Check): Check => (value) => Array.isArray(value) && Array.from(value).every(check)
function shape(required: Record<string, Check>, optional: Record<string, Check> = {}): Check {
  return (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const object = value as Record<string, unknown>
    return Object.keys(object).every((key) => Object.hasOwn(required, key) || Object.hasOwn(optional, key))
      && Object.entries(required).every(([key, check]) => Object.hasOwn(object, key) && check(object[key]))
      && Object.entries(optional).every(([key, check]) => !Object.hasOwn(object, key) || check(object[key]))
  }
}

const strings = array(text)
const category = oneOf("skill", "certification", "language", "experience", "education", "other")
const evidence = shape({
  id: text, kind: oneOf("identity", "summary", "experience", "skill", "education", "certification", "language", "project", "achievement", "motivation", "other"), content: text,
}, {
  context: shape({}, { employer: string, role: string, location: string, startDate: string, endDate: string }),
  relatedRequirements: array(shape({ category, value: text })),
})
const requirement = shape({
  requirement: shape({
    identity: shape({ key: text, original: text, normalized: text, category }),
    importance: oneOf("required", "preferred", "optional", "useful", "unspecified"),
  }),
  status: oneOf("matched", "missing", "conflicting", "unknown"), evidenceIds: strings,
})
const question = shape({
  id: text, category: oneOf("general", "behavioral", "competency", "roleSpecific", "situational", "gapFocused", "motivation", "closing"),
  prompt: string, rationale: string, requirementKeys: strings, evidenceIds: strings, gapKeys: strings,
})
const plan = shape({
  applicationId: text,
  job: shape({ jobId: text, source: text, sourceId: (v) => v === null || typeof v === "string", jobTitle: text, company: (v) => v === null || typeof v === "string" }),
  language: oneOf("sv", "en"),
  interviewType: oneOf("recruiterScreening", "hiringManager", "behavioral", "roleSpecific", "situational"),
  questions: array(question),
  starPrompts: array(shape({ questionId: text, evidenceIds: strings, situationPrompt: string, taskPrompt: string, actionPrompt: string, resultPrompt: string, warnings: array(string) })),
  warnings: array(shape({
    code: oneOf("SPARSE_CANDIDATE_EVIDENCE", "LOW_JOB_EVIDENCE_CONFIDENCE", "PARTIAL_REQUIREMENT_COVERAGE", "MISSING_REQUIREMENT_PREPARATION", "CONFLICTING_REQUIREMENT_PREPARATION", "UNKNOWN_REQUIREMENT_CONTEXT", "UNSUPPORTED_MATCHED_REQUIREMENT", "MISSING_MOTIVATION", "NO_SUPPORTED_STAR_RESULT"), message: string,
  }, { requirementKey: text, evidenceId: text })),
})
const record = shape({ id: text, applicationId: text, candidateId: text, plan, evidenceSnapshot: array(evidence), requirementContext: array(requirement) })
const unique = (values: string[]) => new Set(values).size === values.length

/** Full shape and referential integrity; never regenerates a historical plan. */
export function isInterviewPreparationRecord(value: unknown): value is InterviewPreparationRecord {
  if (!record(value)) return false
  // Every nested field has been checked above; now validate relationships using
  // existing domain evidence normalization and canonical requirement identity.
  const snapshot = value as InterviewPreparationRecord
  if (snapshot.plan.applicationId !== snapshot.applicationId) return false
  const catalog = buildCandidateEvidenceCatalog({ evidence: snapshot.evidenceSnapshot })
  if (!catalog.ok) return false
  const evidenceById = new Map(catalog.value.evidence.map((item) => [item.id, item]))
  const requirements = new Map(snapshot.requirementContext.map((item) => [item.requirement.identity.key, item]))
  // Equivalent repeated job requirements can be emitted by the foundation.
  // Preserve them exactly, but reject conflicting duplicate contexts.
  for (const context of snapshot.requirementContext) {
    const identity = context.requirement.identity
    const canonical = createRequirementIdentity(identity.category, identity.original)
    if (identity.key !== canonical.key || identity.normalized !== canonical.normalized) return false
    const duplicate = requirements.get(identity.key)!
    if (duplicate.status !== context.status || duplicate.requirement.importance !== context.requirement.importance
      || duplicate.requirement.identity.original !== identity.original
      || JSON.stringify(duplicate.evidenceIds) !== JSON.stringify(context.evidenceIds)) return false
    if (!unique(context.evidenceIds) || context.evidenceIds.some((id) => !evidenceById.get(id)?.requirementKeys.includes(identity.key))) return false
    if (context.status !== "matched" && context.evidenceIds.length !== 0) return false
  }
  const questions = new Map(snapshot.plan.questions.map((item) => [item.id, item]))
  if (questions.size === 0 || questions.size !== snapshot.plan.questions.length) return false
  for (const item of snapshot.plan.questions) {
    if (!unique(item.evidenceIds) || !unique(item.gapKeys) || !unique(item.requirementKeys)) return false
    if (item.evidenceIds.some((id) => !evidenceById.has(id))) return false
    for (const key of item.requirementKeys) {
      if (requirements.has(key)) continue
      // Phase 5 behavioral/motivation questions can carry candidate-only
      // relationships. Resolve through their evidence without promoting them
      // into job requirements. Other categories require job context.
      if (item.category !== "behavioral" && item.category !== "motivation") return false
      if (!item.evidenceIds.some((id) => evidenceById.get(id)!.requirementKeys.includes(key))) return false
    }
    for (const key of item.gapKeys) {
      const context = requirements.get(key)
      if (!item.requirementKeys.includes(key) || !context || (context.status !== "missing" && context.status !== "conflicting")) return false
    }
  }
  for (const star of snapshot.plan.starPrompts) {
    const linked = questions.get(star.questionId)
    if (!linked || !unique(star.evidenceIds) || star.evidenceIds.length === 0) return false
    if (star.evidenceIds.some((id) => !evidenceById.has(id) || !linked.evidenceIds.includes(id))) return false
  }
  for (const warning of snapshot.plan.warnings) {
    if (warning.evidenceId !== undefined && !evidenceById.has(warning.evidenceId)) return false
    if (warning.requirementKey !== undefined && !requirements.has(warning.requirementKey)) return false
  }
  return true
}
