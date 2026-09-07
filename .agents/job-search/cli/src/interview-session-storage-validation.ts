import { getInterviewSessionSummary, type InterviewSession } from "./interview-session"

// Strict storage schema supplements the domain's progression validation. Extra
// fields are rejected at every level so raw answers cannot hitchhike into storage.
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
const preparation = shape({
  applicationId: text,
  questionId: text,
  language: oneOf("sv", "en"),
  questionCategory: oneOf("general", "behavioral", "competency", "roleSpecific", "situational", "gapFocused", "motivation", "closing"),
  citedEvidence: array(shape({ evidenceId: text, status: oneOf("questionLinked", "candidateEvidenceOnly") })),
  questionEvidenceIds: array(text),
  requirementKeys: array(text),
  gapKeys: array(text),
  structuralChecks: shape({
    hasAnswerContent: boolean, hasEvidenceCitation: boolean, hasQuestionLinkedEvidence: boolean,
    star: oneOf("notApplicable", "notStructured", "partial", "complete"), semanticSupport: oneOf("notDetermined"),
  }),
  warnings: array(shape({
    code: oneOf("EMPTY_ANSWER", "SPARSE_ANSWER", "NO_EVIDENCE_CITED", "CANDIDATE_EVIDENCE_NOT_QUESTION_LINKED", "UNVERIFIED_PROTECTED_FACT", "STAR_FIELD_MISSING", "MISSING_REQUIREMENT_TRUTH_REMINDER", "POTENTIAL_GAP_CONTRADICTION", "UNKNOWN_REQUIREMENT_CAUTION", "CONFLICTING_REQUIREMENT_CAUTION", "MOTIVATION_NOT_EVIDENCE_GROUNDED", "SEMANTIC_SUPPORT_NOT_DETERMINED"), message: string,
  }, {
    evidenceId: string, requirementKey: string, starField: oneOf("situation", "task", "action", "result"),
    protectedFactKind: oneOf("percentage", "currency", "date", "duration", "number", "named"), protectedFactToken: string,
  })),
  improvementPrompts: array(shape({ code: oneOf("ADD_LINKED_EVIDENCE", "CLARIFY_PERSONAL_ACTION", "ADD_TRUTHFUL_RESULT_OR_OMIT_IT", "VERIFY_OR_REMOVE_PROTECTED_FACT", "ACKNOWLEDGE_DIRECT_EXPERIENCE_GAP", "CLARIFY_UNKNOWN_REQUIREMENT", "EXPLAIN_CONFLICT_TRUTHFULLY", "FORMULATE_OWN_MOTIVATION", "DISTINGUISH_SUPPORTED_AND_DEVELOPING_AREAS"), message: string }, { requirementKey: string })),
})
const skipped = shape({ status: oneOf("skipped"), questionId: text })
const submitted = shape({ status: oneOf("submitted"), questionId: text, answerFormat: oneOf("freeText", "star"), preparation })
const session = shape({
  id: text, applicationId: text, language: oneOf("sv", "en"),
  interviewType: oneOf("recruiterScreening", "hiringManager", "behavioral", "roleSpecific", "situational"),
  status: oneOf("inProgress", "completed"), planQuestionIds: array(text),
  currentQuestionIndex: (value) => Number.isInteger(value),
  turns: array((value) => skipped(value) || submitted(value)),
})

/** Accept unknown storage values only after full shape and domain validation. */
export function isPersistableInterviewSession(value: unknown): value is InterviewSession {
  if (!session(value)) return false
  // The structural check above establishes the shape; Phase 5 owns invariants.
  return getInterviewSessionSummary(value as InterviewSession).ok
}
