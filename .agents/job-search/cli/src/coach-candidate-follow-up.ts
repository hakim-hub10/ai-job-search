export type CandidateFollowUpState = "open" | "overdue" | "completed"

export interface CandidateFollowUp {
  id: string
  candidateId: string
  applicationId?: string
  dueAt: string
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export interface CreateCandidateFollowUpInput {
  id: string
  candidateId: string
  applicationId?: string
  dueAt: string
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export interface CompleteCandidateFollowUpInput {
  completedAt: string
}

export type CandidateFollowUpErrorCode =
  | "INVALID_FOLLOW_UP_ID"
  | "INVALID_CANDIDATE_ID"
  | "INVALID_APPLICATION_ID"
  | "INVALID_TIMESTAMP"
  | "TIMESTAMP_OUT_OF_ORDER"
  | "MALFORMED_FOLLOW_UP_INPUT"

export interface CandidateFollowUpError {
  code: CandidateFollowUpErrorCode
  message: string
}

export type CandidateFollowUpResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CandidateFollowUpError }

function failure<T>(code: CandidateFollowUpErrorCode, message: string): CandidateFollowUpResult<T> {
  return { ok: false, error: { code, message } }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    && !Number.isNaN(Date.parse(value))
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join(",") === keys.sort().join(",")
}

function validateShape(value: unknown): CandidateFollowUpResult<CandidateFollowUp> {
  if (!isObject(value)) return failure("MALFORMED_FOLLOW_UP_INPUT", "Candidate follow-up input must be an object.")
  const keys = ["candidateId", "createdAt", "dueAt", "id", "updatedAt"]
  if (value.applicationId !== undefined) keys.push("applicationId")
  if (value.completedAt !== undefined) keys.push("completedAt")
  if (!exactKeys(value, keys)) return failure("MALFORMED_FOLLOW_UP_INPUT", "Candidate follow-up fields are malformed.")
  if (!hasText(value.id)) return failure("INVALID_FOLLOW_UP_ID", "Follow-up IDs must be non-empty strings.")
  if (!hasText(value.candidateId)) return failure("INVALID_CANDIDATE_ID", "Candidate follow-up IDs must be non-empty strings.")
  if (value.applicationId !== undefined && !hasText(value.applicationId)) {
    return failure("INVALID_APPLICATION_ID", "Application follow-up IDs must be non-empty strings.")
  }
  if (!isTimestamp(value.dueAt) || !isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) {
    return failure("INVALID_TIMESTAMP", "Follow-up timestamps must be valid UTC ISO timestamps.")
  }
  if (value.completedAt !== undefined && !isTimestamp(value.completedAt)) {
    return failure("INVALID_TIMESTAMP", "Follow-up timestamps must be valid UTC ISO timestamps.")
  }
  if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
    return failure("TIMESTAMP_OUT_OF_ORDER", "Follow-up update timestamps cannot precede creation timestamps.")
  }
  if (value.completedAt !== undefined && Date.parse(value.completedAt) < Date.parse(value.createdAt)) {
    return failure("TIMESTAMP_OUT_OF_ORDER", "Follow-up completion timestamps cannot precede creation timestamps.")
  }
  return { ok: true, value: structuredClone(value) as unknown as CandidateFollowUp }
}

export function createCandidateFollowUp(
  input: CreateCandidateFollowUpInput,
): CandidateFollowUpResult<CandidateFollowUp> {
  return validateShape(input)
}

export function validateCandidateFollowUp(value: unknown): CandidateFollowUpResult<CandidateFollowUp> {
  return validateShape(value)
}

export function completeCandidateFollowUp(
  followUp: CandidateFollowUp,
  input: CompleteCandidateFollowUpInput,
): CandidateFollowUpResult<CandidateFollowUp> {
  const valid = validateShape(followUp)
  if (!valid.ok) return valid
  if (!isTimestamp(input?.completedAt)) return failure("INVALID_TIMESTAMP", "Follow-up timestamps must be valid UTC ISO timestamps.")
  if (Date.parse(input.completedAt) < Date.parse(valid.value.updatedAt)) {
    return failure("TIMESTAMP_OUT_OF_ORDER", "Follow-up completion timestamps cannot precede update timestamps.")
  }
  return {
    ok: true,
    value: {
      ...valid.value,
      updatedAt: input.completedAt,
      completedAt: input.completedAt,
    },
  }
}

export function deriveCandidateFollowUpState(
  followUp: CandidateFollowUp,
  asOf: string,
): CandidateFollowUpResult<CandidateFollowUpState> {
  const valid = validateShape(followUp)
  if (!valid.ok) return valid
  if (!isTimestamp(asOf)) return failure("INVALID_TIMESTAMP", "Follow-up reference timestamps must be valid UTC ISO timestamps.")
  if (valid.value.completedAt !== undefined) return { ok: true, value: "completed" }
  return { ok: true, value: Date.parse(valid.value.dueAt) < Date.parse(asOf) ? "overdue" : "open" }
}