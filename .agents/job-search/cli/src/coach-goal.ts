export type CoachGoalStatus = "planned" | "inProgress" | "completed" | "cancelled"

export interface CoachGoal {
  id: string
  candidateId: string
  title: string
  description?: string
  dueAt?: string
  status: CoachGoalStatus
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export interface CreateCoachGoalInput {
  id: string
  candidateId: string
  title: string
  description?: string
  dueAt?: string
  createdAt: string
}

export interface UpdateCoachGoalInput {
  title?: string
  description?: string
  dueAt?: string
  updatedAt: string
}

export interface TransitionCoachGoalInput { status: CoachGoalStatus; updatedAt: string }
export type CoachGoalErrorCode = "INVALID_GOAL_ID" | "INVALID_CANDIDATE_ID" | "EMPTY_GOAL_TITLE" | "INVALID_STATUS" | "INVALID_TIMESTAMP" | "TIMESTAMP_OUT_OF_ORDER" | "INVALID_TRANSITION" | "MALFORMED_GOAL_INPUT"
export interface CoachGoalError { code: CoachGoalErrorCode; message: string }
export type CoachGoalResult<T> = { ok: true; value: T } | { ok: false; error: CoachGoalError }

const STATUSES: CoachGoalStatus[] = ["planned", "inProgress", "completed", "cancelled"]
function failure<T>(code: CoachGoalErrorCode, message: string): CoachGoalResult<T> { return { ok: false, error: { code, message } } }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function hasText(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 }
function isTimestamp(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) && !Number.isNaN(Date.parse(value)) }
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).sort().join(",") === keys.sort().join(",") }

function validate(value: unknown): CoachGoalResult<CoachGoal> {
  if (!isObject(value)) return failure("MALFORMED_GOAL_INPUT", "Coach goal input must be an object.")
  const keys = ["candidateId", "createdAt", "id", "status", "title", "updatedAt"]
  if (value.description !== undefined) keys.push("description")
  if (value.dueAt !== undefined) keys.push("dueAt")
  if (value.completedAt !== undefined) keys.push("completedAt")
  if (!exactKeys(value, keys)) return failure("MALFORMED_GOAL_INPUT", "Coach goal fields are malformed.")
  if (!hasText(value.id)) return failure("INVALID_GOAL_ID", "Coach goal IDs must be non-empty strings.")
  if (!hasText(value.candidateId)) return failure("INVALID_CANDIDATE_ID", "Coach goal candidate IDs must be non-empty strings.")
  if (!hasText(value.title)) return failure("EMPTY_GOAL_TITLE", "Coach goal titles must contain non-whitespace text.")
  if (!STATUSES.includes(value.status as CoachGoalStatus)) return failure("INVALID_STATUS", "Coach goal status is not supported.")
  if (value.description !== undefined && typeof value.description !== "string") return failure("MALFORMED_GOAL_INPUT", "Coach goal descriptions must be strings.")
  if ((value.dueAt !== undefined && !isTimestamp(value.dueAt)) || !isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt) || (value.completedAt !== undefined && !isTimestamp(value.completedAt))) return failure("INVALID_TIMESTAMP", "Coach goal timestamps must be valid UTC ISO timestamps.")
  if (Date.parse(value.updatedAt) < Date.parse(value.createdAt) || (value.completedAt !== undefined && Date.parse(value.completedAt) < Date.parse(value.createdAt))) return failure("TIMESTAMP_OUT_OF_ORDER", "Coach goal timestamps are out of order.")
  if (value.status === "completed" && value.completedAt === undefined) return failure("INVALID_TRANSITION", "Completed goals must have a completion timestamp.")
  if (value.status !== "completed" && value.completedAt !== undefined) return failure("INVALID_TRANSITION", "Only completed goals may have a completion timestamp.")
  return { ok: true, value: structuredClone(value) as unknown as CoachGoal }
}

export function createCoachGoal(input: CreateCoachGoalInput): CoachGoalResult<CoachGoal> {
  return validate({ ...input, status: "planned", updatedAt: input?.createdAt })
}
export function validateCoachGoal(value: unknown): CoachGoalResult<CoachGoal> { return validate(value) }
export function updateCoachGoal(goal: CoachGoal, input: UpdateCoachGoalInput): CoachGoalResult<CoachGoal> {
  const current = validate(goal)
  if (!current.ok) return current
  if (input.title !== undefined && !hasText(input.title)) return failure("EMPTY_GOAL_TITLE", "Coach goal titles must contain non-whitespace text.")
  if (input.description !== undefined && typeof input.description !== "string") return failure("MALFORMED_GOAL_INPUT", "Coach goal descriptions must be strings.")
  if (input.dueAt !== undefined && !isTimestamp(input.dueAt)) return failure("INVALID_TIMESTAMP", "Coach goal due dates must be valid UTC ISO timestamps.")
  if (!isTimestamp(input?.updatedAt)) return failure("INVALID_TIMESTAMP", "Coach goal timestamps must be valid UTC ISO timestamps.")
  if (Date.parse(input.updatedAt) < Date.parse(current.value.updatedAt)) return failure("TIMESTAMP_OUT_OF_ORDER", "Coach goal updates cannot precede the current update.")
  return { ok: true, value: { ...current.value, ...(input.title !== undefined ? { title: input.title } : {}), ...(input.description !== undefined ? { description: input.description } : {}), ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}), updatedAt: input.updatedAt } }
}
export function transitionCoachGoal(goal: CoachGoal, input: TransitionCoachGoalInput): CoachGoalResult<CoachGoal> {
  const current = validate(goal)
  if (!current.ok) return current
  if (!STATUSES.includes(input?.status)) return failure("INVALID_STATUS", "Coach goal status is not supported.")
  if (!isTimestamp(input?.updatedAt)) return failure("INVALID_TIMESTAMP", "Coach goal timestamps must be valid UTC ISO timestamps.")
  if (Date.parse(input.updatedAt) < Date.parse(current.value.updatedAt)) return failure("TIMESTAMP_OUT_OF_ORDER", "Coach goal transitions cannot precede the current update.")
  if (current.value.status === "completed" || current.value.status === "cancelled") return failure("INVALID_TRANSITION", "Terminal coach goals cannot transition again.")
  if (input.status === "completed") return { ok: true, value: { ...current.value, status: input.status, updatedAt: input.updatedAt, completedAt: input.updatedAt } }
  if (input.status === "cancelled") return { ok: true, value: { ...current.value, status: input.status, updatedAt: input.updatedAt } }
  return { ok: true, value: { ...current.value, status: input.status, updatedAt: input.updatedAt } }
}