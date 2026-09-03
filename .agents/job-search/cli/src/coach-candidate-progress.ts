import type { ApplicationRecord, ApplicationStatus } from "./applications"
import { deriveCandidateFollowUpState, type CandidateFollowUp } from "./coach-candidate-follow-up"

const APPLICATION_STATUSES: ApplicationStatus[] = ["saved", "preparing", "applied", "interview", "offer", "rejected", "withdrawn", "closed"]

export interface CandidateActivity {
  applicationId: string
  kind: "status" | "note"
  timestamp: string
}

export interface CandidateProgressSummary {
  candidateId: string
  applicationCount: number
  statusCounts: Record<ApplicationStatus, number>
  latestActivity: CandidateActivity | null
  openFollowUpCount: number
  overdueFollowUpCount: number
}

export type CandidateProgressErrorCode = "INVALID_CANDIDATE_ID" | "INVALID_TIMESTAMP" | "MALFORMED_PROGRESS_INPUT"

export interface CandidateProgressError {
  code: CandidateProgressErrorCode
  message: string
}

export type CandidateProgressResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CandidateProgressError }

function failure<T>(code: CandidateProgressErrorCode, message: string): CandidateProgressResult<T> {
  return { ok: false, error: { code, message } }
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    && !Number.isNaN(Date.parse(value))
}

function compareActivities(a: CandidateActivity, b: CandidateActivity): number {
  return b.timestamp.localeCompare(a.timestamp)
    || a.applicationId.localeCompare(b.applicationId)
    || (a.kind === b.kind ? 0 : a.kind === "status" ? -1 : 1)
}

export interface CreateCandidateProgressSummaryInput {
  candidateId: string
  applications: ApplicationRecord[]
  followUps: CandidateFollowUp[]
  asOf: string
}

export function createCandidateProgressSummary(
  input: CreateCandidateProgressSummaryInput,
): CandidateProgressResult<CandidateProgressSummary> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return failure("MALFORMED_PROGRESS_INPUT", "Candidate progress input must be an object.")
  if (typeof input.candidateId !== "string" || input.candidateId.trim().length === 0) return failure("INVALID_CANDIDATE_ID", "Candidate progress IDs must be non-empty strings.")
  if (!isTimestamp(input.asOf)) return failure("INVALID_TIMESTAMP", "Progress reference timestamps must be valid UTC ISO timestamps.")

  const statusCounts = Object.fromEntries(APPLICATION_STATUSES.map((status) => [status, 0])) as Record<ApplicationStatus, number>
  const activities: CandidateActivity[] = []
  for (const application of input.applications) {
    if (!APPLICATION_STATUSES.includes(application.status)) return failure("MALFORMED_PROGRESS_INPUT", "Progress applications contain an unsupported status.")
    statusCounts[application.status] += 1
    for (const event of application.statusHistory) activities.push({ applicationId: application.id, kind: "status", timestamp: event.timestamp })
    for (const note of application.notes) activities.push({ applicationId: application.id, kind: "note", timestamp: note.createdAt })
  }

  let openFollowUpCount = 0
  let overdueFollowUpCount = 0
  for (const followUp of input.followUps) {
    const state = deriveCandidateFollowUpState(followUp, input.asOf)
    if (!state.ok) return failure("MALFORMED_PROGRESS_INPUT", state.error.message)
    if (state.value === "open") openFollowUpCount += 1
    if (state.value === "overdue") overdueFollowUpCount += 1
  }

  activities.sort(compareActivities)
  return {
    ok: true,
    value: {
      candidateId: input.candidateId,
      applicationCount: input.applications.length,
      statusCounts,
      latestActivity: activities[0] ? structuredClone(activities[0]) : null,
      openFollowUpCount,
      overdueFollowUpCount,
    },
  }
}