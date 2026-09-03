export interface CandidateApplicationAssociation {
  candidateId: string
  applicationId: string
  createdAt: string
}

export interface CreateCandidateApplicationAssociationInput {
  candidateId: string
  applicationId: string
  createdAt: string
}

export type CandidateApplicationAssociationErrorCode =
  | "INVALID_CANDIDATE_ID"
  | "INVALID_APPLICATION_ID"
  | "INVALID_TIMESTAMP"
  | "MALFORMED_ASSOCIATION_INPUT"

export interface CandidateApplicationAssociationError {
  code: CandidateApplicationAssociationErrorCode
  message: string
}

export type CandidateApplicationAssociationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CandidateApplicationAssociationError }

function failure<T>(
  code: CandidateApplicationAssociationErrorCode,
  message: string,
): CandidateApplicationAssociationResult<T> {
  return { ok: false, error: { code, message } }
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    && !Number.isNaN(Date.parse(value))
}

/** Creates detached ownership metadata without copying candidate or application data. */
export function createCandidateApplicationAssociation(
  input: CreateCandidateApplicationAssociationInput,
): CandidateApplicationAssociationResult<CandidateApplicationAssociation> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return failure("MALFORMED_ASSOCIATION_INPUT", "Candidate application association input must be an object.")
  }
  if (!hasText(input.candidateId)) {
    return failure("INVALID_CANDIDATE_ID", "Candidate association IDs must be non-empty strings.")
  }
  if (!hasText(input.applicationId)) {
    return failure("INVALID_APPLICATION_ID", "Application association IDs must be non-empty strings.")
  }
  if (!isTimestamp(input.createdAt)) {
    return failure("INVALID_TIMESTAMP", "Association timestamps must be valid UTC ISO timestamps.")
  }
  return { ok: true, value: structuredClone(input) }
}
