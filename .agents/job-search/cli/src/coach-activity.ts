export type CoachActivityKind = "applyForJob" | "updateCv" | "contactEmployer" | "attendInterview" | "completeCourseStep" | "coachingMeeting"
export type CoachActivityStatus = "planned" | "completed" | "cancelled"

export interface CoachActivity {
  id: string
  candidateId: string
  kind: CoachActivityKind
  status: CoachActivityStatus
  plannedAt?: string
  completedAt?: string
  applicationId?: string
  createdAt: string
  updatedAt: string
}
export interface CreateCoachActivityInput { id: string; candidateId: string; kind: CoachActivityKind; plannedAt?: string; applicationId?: string; createdAt: string }
export interface UpdateCoachActivityInput { plannedAt?: string; updatedAt: string }
export interface TransitionCoachActivityInput { status: CoachActivityStatus; updatedAt: string }
export type CoachActivityErrorCode = "INVALID_ACTIVITY_ID" | "INVALID_CANDIDATE_ID" | "INVALID_APPLICATION_ID" | "INVALID_KIND" | "INVALID_STATUS" | "INVALID_TIMESTAMP" | "TIMESTAMP_OUT_OF_ORDER" | "INVALID_TRANSITION" | "MALFORMED_ACTIVITY_INPUT"
export interface CoachActivityError { code: CoachActivityErrorCode; message: string }
export type CoachActivityResult<T> = { ok: true; value: T } | { ok: false; error: CoachActivityError }

const KINDS: CoachActivityKind[] = ["applyForJob", "updateCv", "contactEmployer", "attendInterview", "completeCourseStep", "coachingMeeting"]
const STATUSES: CoachActivityStatus[] = ["planned", "completed", "cancelled"]
function failure<T>(code: CoachActivityErrorCode, message: string): CoachActivityResult<T> { return { ok: false, error: { code, message } } }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function hasText(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 }
function isTimestamp(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) && !Number.isNaN(Date.parse(value)) }
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).sort().join(",") === keys.sort().join(",") }
function validate(value: unknown): CoachActivityResult<CoachActivity> {
  if (!isObject(value)) return failure("MALFORMED_ACTIVITY_INPUT", "Coach activity input must be an object.")
  const keys = ["candidateId", "createdAt", "id", "kind", "status", "updatedAt"]
  if (value.plannedAt !== undefined) keys.push("plannedAt")
  if (value.completedAt !== undefined) keys.push("completedAt")
  if (value.applicationId !== undefined) keys.push("applicationId")
  if (!exactKeys(value, keys)) return failure("MALFORMED_ACTIVITY_INPUT", "Coach activity fields are malformed.")
  if (!hasText(value.id)) return failure("INVALID_ACTIVITY_ID", "Coach activity IDs must be non-empty strings.")
  if (!hasText(value.candidateId)) return failure("INVALID_CANDIDATE_ID", "Coach activity candidate IDs must be non-empty strings.")
  if (!KINDS.includes(value.kind as CoachActivityKind)) return failure("INVALID_KIND", "Coach activity kind is not supported.")
  if (!STATUSES.includes(value.status as CoachActivityStatus)) return failure("INVALID_STATUS", "Coach activity status is not supported.")
  if (value.applicationId !== undefined && !hasText(value.applicationId)) return failure("INVALID_APPLICATION_ID", "Activity application IDs must be non-empty strings.")
  if ((value.plannedAt !== undefined && !isTimestamp(value.plannedAt)) || (value.completedAt !== undefined && !isTimestamp(value.completedAt)) || !isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) return failure("INVALID_TIMESTAMP", "Coach activity timestamps must be valid UTC ISO timestamps.")
  if (Date.parse(value.updatedAt) < Date.parse(value.createdAt) || (value.completedAt !== undefined && Date.parse(value.completedAt) < Date.parse(value.createdAt))) return failure("TIMESTAMP_OUT_OF_ORDER", "Coach activity timestamps are out of order.")
  if (value.status === "completed" && value.completedAt === undefined) return failure("INVALID_TRANSITION", "Completed activities must have a completion timestamp.")
  if (value.status !== "completed" && value.completedAt !== undefined) return failure("INVALID_TRANSITION", "Only completed activities may have a completion timestamp.")
  return { ok: true, value: structuredClone(value) as unknown as CoachActivity }
}
export function createCoachActivity(input: CreateCoachActivityInput): CoachActivityResult<CoachActivity> { return validate({ ...input, status: "planned", updatedAt: input?.createdAt }) }
export function validateCoachActivity(value: unknown): CoachActivityResult<CoachActivity> { return validate(value) }
export function updateCoachActivity(activity: CoachActivity, input: UpdateCoachActivityInput): CoachActivityResult<CoachActivity> {
  const current = validate(activity)
  if (!current.ok) return current
  if (input.plannedAt !== undefined && !isTimestamp(input.plannedAt)) return failure("INVALID_TIMESTAMP", "Coach activity planned dates must be valid UTC ISO timestamps.")
  if (!isTimestamp(input?.updatedAt)) return failure("INVALID_TIMESTAMP", "Coach activity timestamps must be valid UTC ISO timestamps.")
  if (Date.parse(input.updatedAt) < Date.parse(current.value.updatedAt)) return failure("TIMESTAMP_OUT_OF_ORDER", "Coach activity updates cannot precede the current update.")
  return { ok: true, value: { ...current.value, ...(input.plannedAt !== undefined ? { plannedAt: input.plannedAt } : {}), updatedAt: input.updatedAt } }
}
export function transitionCoachActivity(activity: CoachActivity, input: TransitionCoachActivityInput): CoachActivityResult<CoachActivity> {
  const current = validate(activity)
  if (!current.ok) return current
  if (!STATUSES.includes(input?.status)) return failure("INVALID_STATUS", "Coach activity status is not supported.")
  if (!isTimestamp(input?.updatedAt)) return failure("INVALID_TIMESTAMP", "Coach activity timestamps must be valid UTC ISO timestamps.")
  if (Date.parse(input.updatedAt) < Date.parse(current.value.updatedAt)) return failure("TIMESTAMP_OUT_OF_ORDER", "Coach activity transitions cannot precede the current update.")
  if (current.value.status === "completed" || current.value.status === "cancelled") return failure("INVALID_TRANSITION", "Terminal coach activities cannot transition again.")
  if (input.status === "completed") return { ok: true, value: { ...current.value, status: input.status, updatedAt: input.updatedAt, completedAt: input.updatedAt } }
  return { ok: true, value: { ...current.value, status: input.status, updatedAt: input.updatedAt } }
}