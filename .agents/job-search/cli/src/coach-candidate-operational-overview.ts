import type { CoachActivity, CoachActivityKind, CoachActivityStatus } from "./coach-activity"
import type { CoachGoal, CoachGoalStatus } from "./coach-goal"
import type { CoachNote } from "./coach-note"
import type { CandidateOverview } from "./coach-candidate-overview"
import type { CoachCandidate } from "./coach-workspace"

export interface CoachNoteSummary {
  id: string
  createdAt: string
  updatedAt: string
}

export interface CoachGoalSummary {
  id: string
  title: string
  dueAt?: string
  status: CoachGoalStatus
  overdue: boolean
}

export interface CoachActivitySummary {
  id: string
  kind: CoachActivityKind
  status: CoachActivityStatus
  plannedAt?: string
  completedAt?: string
  applicationId?: string
}

export interface CandidateOperationalOverview {
  candidate: CoachCandidate
  overview: CandidateOverview
  notes: CoachNoteSummary[]
  goals: CoachGoalSummary[]
  activities: CoachActivitySummary[]
  goalCounts: {
    planned: number
    inProgress: number
    completed: number
    cancelled: number
    overdue: number
  }
  activityCounts: {
    planned: number
    completed: number
    cancelled: number
  }
  nextPlannedActivity: CoachActivitySummary | null
}

export type CandidateOperationalOverviewErrorCode = "INVALID_CANDIDATE_ID" | "INVALID_TIMESTAMP" | "MALFORMED_OPERATIONAL_OVERVIEW_INPUT"
export interface CandidateOperationalOverviewError { code: CandidateOperationalOverviewErrorCode; message: string }
export type CandidateOperationalOverviewResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CandidateOperationalOverviewError }

function failure<T>(code: CandidateOperationalOverviewErrorCode, message: string): CandidateOperationalOverviewResult<T> { return { ok: false, error: { code, message } } }
function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) && !Number.isNaN(Date.parse(value))
}
function compareNotes(a: CoachNote, b: CoachNote): number { return b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id) }
function compareGoals(a: CoachGoal, b: CoachGoal): number { return (a.dueAt ?? "9999-12-31T23:59:59.999Z").localeCompare(b.dueAt ?? "9999-12-31T23:59:59.999Z") || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id) }
function compareActivities(a: CoachActivity, b: CoachActivity): number { return (a.plannedAt ?? a.createdAt).localeCompare(b.plannedAt ?? b.createdAt) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id) }

export interface CreateCandidateOperationalOverviewInput {
  candidate: CoachCandidate
  overview: CandidateOverview
  notes: CoachNote[]
  goals: CoachGoal[]
  activities: CoachActivity[]
  asOf: string
}

export function createCandidateOperationalOverview(
  input: CreateCandidateOperationalOverviewInput,
): CandidateOperationalOverviewResult<CandidateOperationalOverview> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return failure("MALFORMED_OPERATIONAL_OVERVIEW_INPUT", "Operational overview input must be an object.")
  if (!input.candidate || typeof input.candidate.id !== "string" || input.candidate.id.trim().length === 0) return failure("INVALID_CANDIDATE_ID", "Operational overview candidate IDs must be non-empty strings.")
  if (!isTimestamp(input.asOf)) return failure("INVALID_TIMESTAMP", "Operational overview reference timestamps must be valid UTC ISO timestamps.")
  if (input.overview.candidate.id !== input.candidate.id) return failure("MALFORMED_OPERATIONAL_OVERVIEW_INPUT", "Operational overview candidate records do not match.")

  const notes = [...input.notes].sort(compareNotes).map(({ id, createdAt, updatedAt }) => ({ id, createdAt, updatedAt }))
  const goals: CoachGoalSummary[] = []
  const goalCounts = { planned: 0, inProgress: 0, completed: 0, cancelled: 0, overdue: 0 }
  for (const goal of [...input.goals].sort(compareGoals)) {
    const overdue = goal.status !== "completed" && goal.status !== "cancelled" && goal.dueAt !== undefined && Date.parse(goal.dueAt) < Date.parse(input.asOf)
    goalCounts[goal.status] += 1
    if (overdue) goalCounts.overdue += 1
    goals.push({ id: goal.id, title: goal.title, ...(goal.dueAt !== undefined ? { dueAt: goal.dueAt } : {}), status: goal.status, overdue })
  }

  const activities = [...input.activities].sort(compareActivities).map(({ id, kind, status, plannedAt, completedAt, applicationId }) => ({
    id,
    kind,
    status,
    ...(plannedAt !== undefined ? { plannedAt } : {}),
    ...(completedAt !== undefined ? { completedAt } : {}),
    ...(applicationId !== undefined ? { applicationId } : {}),
  }))
  const activityCounts = { planned: 0, completed: 0, cancelled: 0 }
  for (const activity of activities) activityCounts[activity.status] += 1
  const nextPlannedActivity = activities.find((activity) => activity.status === "planned" && activity.plannedAt !== undefined) ?? null

  return {
    ok: true,
    value: {
      candidate: structuredClone(input.candidate),
      overview: structuredClone(input.overview),
      notes: structuredClone(notes),
      goals: structuredClone(goals),
      activities: structuredClone(activities),
      goalCounts,
      activityCounts,
      nextPlannedActivity: nextPlannedActivity ? structuredClone(nextPlannedActivity) : null,
    },
  }
}