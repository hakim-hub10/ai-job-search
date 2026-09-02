export interface CoachCandidate {
  id: string
  displayName: string
  createdAt: string
  updatedAt: string
}

export interface CreateCoachCandidateInput {
  id: string
  displayName: string
  createdAt: string
}

export type CoachCandidateErrorCode =
  | "INVALID_CANDIDATE_ID"
  | "INVALID_DISPLAY_NAME"
  | "INVALID_TIMESTAMP"
  | "MALFORMED_CANDIDATE_INPUT"

export interface CoachCandidateError {
  code: CoachCandidateErrorCode
  message: string
}

export type CoachCandidateResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CoachCandidateError }

function failure<T>(code: CoachCandidateErrorCode, message: string): CoachCandidateResult<T> {
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

/** Creates detached organizational metadata without deriving candidate facts. */
export function createCoachCandidate(input: CreateCoachCandidateInput): CoachCandidateResult<CoachCandidate> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return failure("MALFORMED_CANDIDATE_INPUT", "Coach candidate input must be an object.")
  }
  if (!hasText(input.id)) return failure("INVALID_CANDIDATE_ID", "Coach candidate IDs must be non-empty strings.")
  if (!hasText(input.displayName)) return failure("INVALID_DISPLAY_NAME", "Coach candidate display names must be non-empty strings.")
  if (!isTimestamp(input.createdAt)) return failure("INVALID_TIMESTAMP", "Coach candidate timestamps must be valid UTC ISO timestamps.")
  return {
    ok: true,
    value: {
      id: input.id,
      displayName: input.displayName,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    },
  }
}
