import type { ApplicationRecord, ApplicationStatus } from "./applications"
import { createCandidateProgressSummary, type CandidateActivity, type CandidateProgressError, type CandidateProgressSummary } from "./coach-candidate-progress"
import { deriveCandidateFollowUpState, type CandidateFollowUp, type CandidateFollowUpState } from "./coach-candidate-follow-up"
import type { CoachCandidate } from "./coach-workspace"

export interface CandidateApplicationOverviewRow {
  applicationId: string
  status: ApplicationStatus
  createdAt: string
  updatedAt: string
  latestActivity: CandidateActivity | null
}

export interface CandidateFollowUpOverview {
  id: string
  applicationId?: string
  dueAt: string
  state: CandidateFollowUpState
}

export interface CandidateOverview {
  candidate: CoachCandidate
  applications: CandidateApplicationOverviewRow[]
  progress: CandidateProgressSummary
  followUps: CandidateFollowUpOverview[]
  overdueFollowUps: CandidateFollowUpOverview[]
  nextFollowUp: CandidateFollowUpOverview | null
}

export type CandidateOverviewErrorCode = "INVALID_CANDIDATE_ID" | "INVALID_TIMESTAMP" | "MALFORMED_OVERVIEW_INPUT"

export interface CandidateOverviewError {
  code: CandidateOverviewErrorCode
  message: string
}

export type CandidateOverviewResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CandidateOverviewError }

function failure<T>(code: CandidateOverviewErrorCode, message: string): CandidateOverviewResult<T> {
  return { ok: false, error: { code, message } }
}

function compareActivities(a: CandidateActivity, b: CandidateActivity): number {
  return b.timestamp.localeCompare(a.timestamp)
    || (a.kind === b.kind ? 0 : a.kind === "status" ? -1 : 1)
}

function latestActivity(application: ApplicationRecord): CandidateActivity | null {
  const activities = [
    ...application.statusHistory.map((event) => ({ applicationId: application.id, kind: "status" as const, timestamp: event.timestamp })),
    ...application.notes.map((note) => ({ applicationId: application.id, kind: "note" as const, timestamp: note.createdAt })),
  ]
  activities.sort(compareActivities)
  return activities[0] ? structuredClone(activities[0]) : null
}

function compareApplications(a: CandidateApplicationOverviewRow, b: CandidateApplicationOverviewRow): number {
  return b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || a.applicationId.localeCompare(b.applicationId)
}

function compareFollowUps(a: CandidateFollowUp, b: CandidateFollowUp): number {
  return a.dueAt.localeCompare(b.dueAt) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

export interface CreateCandidateOverviewInput {
  candidate: CoachCandidate
  applications: ApplicationRecord[]
  followUps: CandidateFollowUp[]
  asOf: string
}

export function createCandidateOverview(
  input: CreateCandidateOverviewInput,
): CandidateOverviewResult<CandidateOverview> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return failure("MALFORMED_OVERVIEW_INPUT", "Candidate overview input must be an object.")
  if (!input.candidate || typeof input.candidate.id !== "string" || input.candidate.id.trim().length === 0) return failure("INVALID_CANDIDATE_ID", "Candidate overview IDs must be non-empty strings.")

  const progress = createCandidateProgressSummary({ candidateId: input.candidate.id, applications: input.applications, followUps: input.followUps, asOf: input.asOf })
  if (!progress.ok) return failure(progress.error.code === "INVALID_TIMESTAMP" ? "INVALID_TIMESTAMP" : "MALFORMED_OVERVIEW_INPUT", progress.error.message)

  const applications = input.applications.map((application) => ({
    applicationId: application.id,
    status: application.status,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    latestActivity: latestActivity(application),
  })).sort(compareApplications)

  const followUps: CandidateFollowUpOverview[] = []
  for (const followUp of [...input.followUps].sort(compareFollowUps)) {
    const state = deriveCandidateFollowUpState(followUp, input.asOf)
    if (!state.ok) return failure(state.error.code === "INVALID_TIMESTAMP" ? "INVALID_TIMESTAMP" : "MALFORMED_OVERVIEW_INPUT", state.error.message)
    followUps.push({ id: followUp.id, ...(followUp.applicationId ? { applicationId: followUp.applicationId } : {}), dueAt: followUp.dueAt, state: state.value })
  }
  const actionable = followUps.filter((followUp) => followUp.state !== "completed")

  return {
    ok: true,
    value: {
      candidate: structuredClone(input.candidate),
      applications,
      progress: structuredClone(progress.value),
      followUps: structuredClone(followUps),
      overdueFollowUps: structuredClone(followUps.filter((followUp) => followUp.state === "overdue")),
      nextFollowUp: actionable[0] ? structuredClone(actionable[0]) : null,
    },
  }
}