import type { ApplicationStatus } from "./applications"
import type { CoachActivityKind, CoachActivity } from "./coach-activity"
import type { CandidateFollowUp } from "./coach-candidate-follow-up"

export interface CandidateActivityReportPeriod {
  startAt: string
  endAt: string
  endExclusive: true
}

export type CandidateActivityReportEventKind =
  | "applicationCreated"
  | "applicationStatusChanged"
  | "followUpCreated"
  | "followUpCompleted"
  | "coachActivityPlanned"
  | "coachActivityCompleted"
  | "coachActivityCancelled"

export interface CandidateActivityReportEventBase {
  kind: CandidateActivityReportEventKind
  timestamp: string
}

export type CandidateActivityReportEvent =
  | (CandidateActivityReportEventBase & { kind: "applicationCreated"; applicationId: string; status: ApplicationStatus })
  | (CandidateActivityReportEventBase & { kind: "applicationStatusChanged"; applicationId: string; status: ApplicationStatus })
  | (CandidateActivityReportEventBase & { kind: "followUpCreated"; followUpId: string; applicationId?: string })
  | (CandidateActivityReportEventBase & { kind: "followUpCompleted"; followUpId: string; applicationId?: string })
  | (CandidateActivityReportEventBase & { kind: "coachActivityPlanned"; activityId: string; activityKind: CoachActivityKind; applicationId?: string })
  | (CandidateActivityReportEventBase & { kind: "coachActivityCompleted"; activityId: string; activityKind: CoachActivityKind; applicationId?: string })
  | (CandidateActivityReportEventBase & { kind: "coachActivityCancelled"; activityId: string; activityKind: CoachActivityKind; applicationId?: string })

export type CandidateActivityReportSummary = Record<CandidateActivityReportEventKind, number>

export interface CandidateActivityReport {
  candidateId: string
  period: CandidateActivityReportPeriod
  summary: CandidateActivityReportSummary
  events: CandidateActivityReportEvent[]
}

export interface CreateCandidateActivityReportInput {
  candidateId: string
  period: { startAt: string; endAt: string }
  applications: Array<{
    id: string
    status: ApplicationStatus
    createdAt: string
    statusHistory: Array<{ status: ApplicationStatus; timestamp: string }>
  }>
  followUps: CandidateFollowUp[]
  activities: CoachActivity[]
}

export type CandidateActivityReportErrorCode =
  | "INVALID_CANDIDATE_ID"
  | "INVALID_TIMESTAMP"
  | "INVALID_PERIOD"
  | "MALFORMED_REPORT_INPUT"

export interface CandidateActivityReportError {
  code: CandidateActivityReportErrorCode
  message: string
}

export type CandidateActivityReportResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CandidateActivityReportError }

const EVENT_KINDS: CandidateActivityReportEventKind[] = [
  "applicationCreated",
  "applicationStatusChanged",
  "followUpCreated",
  "followUpCompleted",
  "coachActivityPlanned",
  "coachActivityCompleted",
  "coachActivityCancelled",
]

function failure<T>(code: CandidateActivityReportErrorCode, message: string): CandidateActivityReportResult<T> {
  return { ok: false, error: { code, message } }
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    && !Number.isNaN(Date.parse(value))
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function eventIdentifier(event: CandidateActivityReportEvent): string {
  if (event.kind === "applicationCreated" || event.kind === "applicationStatusChanged") return event.applicationId
  if (event.kind === "followUpCreated" || event.kind === "followUpCompleted") return event.followUpId
  return event.activityId
}

function compareEvents(a: CandidateActivityReportEvent, b: CandidateActivityReportEvent): number {
  return a.timestamp.localeCompare(b.timestamp)
    || EVENT_KINDS.indexOf(a.kind) - EVENT_KINDS.indexOf(b.kind)
    || eventIdentifier(a).localeCompare(eventIdentifier(b))
    || (a.kind === "applicationStatusChanged" && b.kind === "applicationStatusChanged" ? a.status.localeCompare(b.status) : 0)
}

function withinPeriod(timestamp: string, period: { startAt: string; endAt: string }): boolean {
  const value = Date.parse(timestamp)
  return value >= Date.parse(period.startAt) && value < Date.parse(period.endAt)
}

function emptySummary(): CandidateActivityReportSummary {
  return Object.fromEntries(EVENT_KINDS.map((kind) => [kind, 0])) as CandidateActivityReportSummary
}

export function createCandidateActivityReport(
  input: CreateCandidateActivityReportInput,
): CandidateActivityReportResult<CandidateActivityReport> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return failure("MALFORMED_REPORT_INPUT", "Candidate activity report input must be an object.")
  if (!hasText(input.candidateId)) return failure("INVALID_CANDIDATE_ID", "Report candidate IDs must be non-empty strings.")
  if (!isTimestamp(input.period?.startAt) || !isTimestamp(input.period?.endAt)) return failure("INVALID_TIMESTAMP", "Report period boundaries must be valid UTC ISO timestamps.")
  if (Date.parse(input.period.startAt) >= Date.parse(input.period.endAt)) return failure("INVALID_PERIOD", "Report period start must precede period end.")

  const events: CandidateActivityReportEvent[] = []
  for (const application of input.applications) {
    if (!hasText(application.id) || !isTimestamp(application.createdAt)) return failure("MALFORMED_REPORT_INPUT", "Report applications are malformed.")
    events.push({ kind: "applicationCreated", timestamp: application.createdAt, applicationId: application.id, status: application.status })
    for (const event of application.statusHistory) {
      if (!isTimestamp(event.timestamp)) return failure("MALFORMED_REPORT_INPUT", "Application status history contains an invalid timestamp.")
      events.push({ kind: "applicationStatusChanged", timestamp: event.timestamp, applicationId: application.id, status: event.status })
    }
  }
  for (const followUp of input.followUps) {
    events.push({ kind: "followUpCreated", timestamp: followUp.createdAt, followUpId: followUp.id, ...(followUp.applicationId ? { applicationId: followUp.applicationId } : {}) })
    if (followUp.completedAt !== undefined) events.push({ kind: "followUpCompleted", timestamp: followUp.completedAt, followUpId: followUp.id, ...(followUp.applicationId ? { applicationId: followUp.applicationId } : {}) })
  }
  for (const activity of input.activities) {
    if (activity.status === "planned" && activity.plannedAt !== undefined) events.push({ kind: "coachActivityPlanned", timestamp: activity.plannedAt, activityId: activity.id, activityKind: activity.kind, ...(activity.applicationId ? { applicationId: activity.applicationId } : {}) })
    if (activity.status === "completed" && activity.completedAt !== undefined) events.push({ kind: "coachActivityCompleted", timestamp: activity.completedAt, activityId: activity.id, activityKind: activity.kind, ...(activity.applicationId ? { applicationId: activity.applicationId } : {}) })
    if (activity.status === "cancelled") events.push({ kind: "coachActivityCancelled", timestamp: activity.updatedAt, activityId: activity.id, activityKind: activity.kind, ...(activity.applicationId ? { applicationId: activity.applicationId } : {}) })
  }

  const included = events.filter((event) => withinPeriod(event.timestamp, input.period)).sort(compareEvents)
  const summary = emptySummary()
  for (const event of included) summary[event.kind] += 1
  return {
    ok: true,
    value: {
      candidateId: input.candidateId,
      period: { startAt: input.period.startAt, endAt: input.period.endAt, endExclusive: true },
      summary,
      events: structuredClone(included),
    },
  }
}