export interface CoachNote {
  id: string
  candidateId: string
  text: string
  createdAt: string
  updatedAt: string
}

export interface CreateCoachNoteInput {
  id: string
  candidateId: string
  text: string
  createdAt: string
}

export interface UpdateCoachNoteInput {
  text: string
  updatedAt: string
}

export type CoachNoteErrorCode = "INVALID_NOTE_ID" | "INVALID_CANDIDATE_ID" | "EMPTY_NOTE" | "INVALID_TIMESTAMP" | "TIMESTAMP_OUT_OF_ORDER" | "MALFORMED_NOTE_INPUT"
export interface CoachNoteError { code: CoachNoteErrorCode; message: string }
export type CoachNoteResult<T> = { ok: true; value: T } | { ok: false; error: CoachNoteError }

function failure<T>(code: CoachNoteErrorCode, message: string): CoachNoteResult<T> { return { ok: false, error: { code, message } } }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function hasText(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 }
function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) && !Number.isNaN(Date.parse(value))
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).sort().join(",") === keys.sort().join(",") }

function validate(value: unknown): CoachNoteResult<CoachNote> {
  if (!isObject(value)) return failure("MALFORMED_NOTE_INPUT", "Coach note input must be an object.")
  if (!exactKeys(value, ["candidateId", "createdAt", "id", "text", "updatedAt"])) return failure("MALFORMED_NOTE_INPUT", "Coach note fields are malformed.")
  if (!hasText(value.id)) return failure("INVALID_NOTE_ID", "Coach note IDs must be non-empty strings.")
  if (!hasText(value.candidateId)) return failure("INVALID_CANDIDATE_ID", "Coach note candidate IDs must be non-empty strings.")
  if (!hasText(value.text)) return failure("EMPTY_NOTE", "Coach notes must contain non-whitespace text.")
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) return failure("INVALID_TIMESTAMP", "Coach note timestamps must be valid UTC ISO timestamps.")
  if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) return failure("TIMESTAMP_OUT_OF_ORDER", "Coach note updates cannot precede creation.")
  return { ok: true, value: structuredClone(value) as unknown as CoachNote }
}

export function createCoachNote(input: CreateCoachNoteInput): CoachNoteResult<CoachNote> {
  return validate({ ...input, updatedAt: input?.createdAt })
}

export function validateCoachNote(value: unknown): CoachNoteResult<CoachNote> { return validate(value) }

export function updateCoachNote(note: CoachNote, input: UpdateCoachNoteInput): CoachNoteResult<CoachNote> {
  const current = validate(note)
  if (!current.ok) return current
  if (!hasText(input?.text)) return failure("EMPTY_NOTE", "Coach notes must contain non-whitespace text.")
  if (!isTimestamp(input?.updatedAt)) return failure("INVALID_TIMESTAMP", "Coach note timestamps must be valid UTC ISO timestamps.")
  if (Date.parse(input.updatedAt) < Date.parse(current.value.updatedAt)) return failure("TIMESTAMP_OUT_OF_ORDER", "Coach note updates cannot precede the current update.")
  return { ok: true, value: { ...current.value, text: input.text, updatedAt: input.updatedAt } }
}