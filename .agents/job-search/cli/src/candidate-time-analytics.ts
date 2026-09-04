import type { ApplicationRecord, ApplicationStatus } from "./applications"
import type { CandidateFollowUp } from "./coach-candidate-follow-up"
import type { CoachActivity, CoachActivityStatus } from "./coach-activity"

export interface CandidateTimeAnalyticsPeriod {
  startAt: string
  endAt: string
  endExclusive: true
}

export interface CandidateTimeMetric {
  count: number
  totalMilliseconds: number
  averageMilliseconds: number | null
}

export interface CandidateTimeAnalytics {
  candidateId: string
  period: CandidateTimeAnalyticsPeriod
  asOf: string

  applications: {
    timeToApplied: CandidateTimeMetric
    timeToInterview: CandidateTimeMetric
    timeToOffer: CandidateTimeMetric
  }

  followUps: {
    stateAsOf: {
      total: number
      open: number
      overdue: number
      completed: number
    }
    completionTiming: {
      createdToCompletion: CandidateTimeMetric
      dueDateDelta: CandidateTimeMetric
    }
  }

  coachActivities: {
    stateAsOf: {
      total: number
      planned: number
      completed: number
      cancelled: number
    }
    completionTiming: {
      createdToCompletion: CandidateTimeMetric
      plannedToCompletion: CandidateTimeMetric
    }
  }
}

export interface CreateCandidateTimeAnalyticsInput {
  candidateId: string
  period: {
    startAt: string
    endAt: string
  }
  asOf: string
  applications: ApplicationRecord[]
  followUps: CandidateFollowUp[]
  activities: CoachActivity[]
}

export type CandidateTimeAnalyticsErrorCode =
  | "INVALID_CANDIDATE_ID"
  | "INVALID_TIMESTAMP"
  | "INVALID_PERIOD"
  | "MALFORMED_ANALYTICS_INPUT"

export interface CandidateTimeAnalyticsError {
  code: CandidateTimeAnalyticsErrorCode
  message: string
}

export type CandidateTimeAnalyticsResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CandidateTimeAnalyticsError }

const APPLICATION_STATUSES = new Set<ApplicationStatus>([
  "saved",
  "preparing",
  "applied",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
  "closed",
])

const ACTIVITY_STATUSES = new Set<CoachActivityStatus>([
  "planned",
  "completed",
  "cancelled",
])

function failure<T>(
  code: CandidateTimeAnalyticsErrorCode,
  message: string,
): CandidateTimeAnalyticsResult<T> {
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

function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return typeof value === "string"
    && APPLICATION_STATUSES.has(value as ApplicationStatus)
}

function withinPeriod(
  timestamp: string,
  period: { startAt: string; endAt: string },
): boolean {
  const value = Date.parse(timestamp)
  return value >= Date.parse(period.startAt)
    && value < Date.parse(period.endAt)
}

function atOrBefore(timestamp: string, asOf: string): boolean {
  return Date.parse(timestamp) <= Date.parse(asOf)
}

function timingMetric(values: number[]): CandidateTimeMetric {
  const totalMilliseconds = values.reduce((sum, value) => sum + value, 0)

  return {
    count: values.length,
    totalMilliseconds,
    averageMilliseconds: values.length === 0
      ? null
      : totalMilliseconds / values.length,
  }
}

function firstMilestoneTimestamp(
  application: ApplicationRecord,
  statuses: ApplicationStatus[],
  asOf: string,
): string | null {
  let earliest: string | null = null

  for (const event of application.statusHistory) {
    if (!statuses.includes(event.status)) continue
    if (!atOrBefore(event.timestamp, asOf)) continue

    if (earliest === null || Date.parse(event.timestamp) < Date.parse(earliest)) {
      earliest = event.timestamp
    }
  }

  return earliest
}

export function createCandidateTimeAnalytics(
  input: CreateCandidateTimeAnalyticsInput,
): CandidateTimeAnalyticsResult<CandidateTimeAnalytics> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return failure(
      "MALFORMED_ANALYTICS_INPUT",
      "Candidate time analytics input must be an object.",
    )
  }

  if (!hasText(input.candidateId)) {
    return failure(
      "INVALID_CANDIDATE_ID",
      "Analytics candidate IDs must be non-empty strings.",
    )
  }

  if (
    !isTimestamp(input.period?.startAt)
    || !isTimestamp(input.period?.endAt)
    || !isTimestamp(input.asOf)
  ) {
    return failure(
      "INVALID_TIMESTAMP",
      "Analytics period and asOf values must be valid UTC ISO timestamps.",
    )
  }

  if (Date.parse(input.period.startAt) >= Date.parse(input.period.endAt)) {
    return failure(
      "INVALID_PERIOD",
      "Analytics period start must precede period end.",
    )
  }

  if (
    !Array.isArray(input.applications)
    || !Array.isArray(input.followUps)
    || !Array.isArray(input.activities)
  ) {
    return failure(
      "MALFORMED_ANALYTICS_INPUT",
      "Analytics applications, follow-ups and activities must be arrays.",
    )
  }

  for (const application of input.applications) {
    if (
      !application
      || typeof application !== "object"
      || !hasText(application.id)
      || !isTimestamp(application.createdAt)
      || !Array.isArray(application.statusHistory)
    ) {
      return failure(
        "MALFORMED_ANALYTICS_INPUT",
        "Analytics applications contain malformed records.",
      )
    }

    for (const event of application.statusHistory) {
      if (
        !event
        || typeof event !== "object"
        || !isApplicationStatus(event.status)
        || !isTimestamp(event.timestamp)
        || Date.parse(event.timestamp) < Date.parse(application.createdAt)
      ) {
        return failure(
          "MALFORMED_ANALYTICS_INPUT",
          "Application status history contains malformed or out-of-order events.",
        )
      }
    }
  }

  for (const followUp of input.followUps) {
    if (
      !followUp
      || typeof followUp !== "object"
      || !hasText(followUp.id)
      || !hasText(followUp.candidateId)
      || !isTimestamp(followUp.createdAt)
      || !isTimestamp(followUp.dueAt)
      || (
        followUp.completedAt !== undefined
        && (
          !isTimestamp(followUp.completedAt)
          || Date.parse(followUp.completedAt) < Date.parse(followUp.createdAt)
        )
      )
    ) {
      return failure(
        "MALFORMED_ANALYTICS_INPUT",
        "Analytics follow-ups contain malformed records.",
      )
    }
  }

  for (const activity of input.activities) {
    if (
      !activity
      || typeof activity !== "object"
      || !hasText(activity.id)
      || !hasText(activity.candidateId)
      || !isTimestamp(activity.createdAt)
      || !isTimestamp(activity.updatedAt)
      || Date.parse(activity.updatedAt) < Date.parse(activity.createdAt)
      || !ACTIVITY_STATUSES.has(activity.status)
      || (
        activity.plannedAt !== undefined
        && !isTimestamp(activity.plannedAt)
      )
      || (
        activity.completedAt !== undefined
        && (
          !isTimestamp(activity.completedAt)
          || Date.parse(activity.completedAt) < Date.parse(activity.createdAt)
        )
      )
      || (
        activity.status === "completed"
        && activity.completedAt === undefined
      )
      || (
        activity.status !== "completed"
        && activity.completedAt !== undefined
      )
    ) {
      return failure(
        "MALFORMED_ANALYTICS_INPUT",
        "Analytics coach activities contain malformed records.",
      )
    }
  }

  const applicationCohort = input.applications.filter((application) =>
    withinPeriod(application.createdAt, input.period),
  )

  const timeToAppliedValues: number[] = []
  const timeToInterviewValues: number[] = []
  const timeToOfferValues: number[] = []

  for (const application of applicationCohort) {
    if (!atOrBefore(application.createdAt, input.asOf)) continue

    const appliedAt = firstMilestoneTimestamp(
      application,
      ["applied", "interview", "offer"],
      input.asOf,
    )

    const interviewAt = firstMilestoneTimestamp(
      application,
      ["interview", "offer"],
      input.asOf,
    )

    const offerAt = firstMilestoneTimestamp(
      application,
      ["offer"],
      input.asOf,
    )

    if (appliedAt !== null) {
      timeToAppliedValues.push(
        Date.parse(appliedAt) - Date.parse(application.createdAt),
      )
    }

    if (interviewAt !== null) {
      timeToInterviewValues.push(
        Date.parse(interviewAt) - Date.parse(application.createdAt),
      )
    }

    if (offerAt !== null) {
      timeToOfferValues.push(
        Date.parse(offerAt) - Date.parse(application.createdAt),
      )
    }
  }

  const followUpCohort = input.followUps.filter((followUp) =>
    withinPeriod(followUp.createdAt, input.period),
  )

  let followUpOpen = 0
  let followUpOverdue = 0
  let followUpCompleted = 0
  let followUpTotal = 0

  const followUpCreatedToCompletionValues: number[] = []
  const followUpDueDateDeltaValues: number[] = []

  for (const followUp of followUpCohort) {
    if (!atOrBefore(followUp.createdAt, input.asOf)) continue

    followUpTotal += 1

    if (
      followUp.completedAt !== undefined
      && atOrBefore(followUp.completedAt, input.asOf)
    ) {
      followUpCompleted += 1

      followUpCreatedToCompletionValues.push(
        Date.parse(followUp.completedAt) - Date.parse(followUp.createdAt),
      )

      followUpDueDateDeltaValues.push(
        Date.parse(followUp.completedAt) - Date.parse(followUp.dueAt),
      )

      continue
    }

    if (Date.parse(followUp.dueAt) < Date.parse(input.asOf)) {
      followUpOverdue += 1
    } else {
      followUpOpen += 1
    }
  }

  const activityCohort = input.activities.filter((activity) =>
    withinPeriod(activity.createdAt, input.period),
  )

  let activityPlanned = 0
  let activityCompleted = 0
  let activityCancelled = 0
  let activityTotal = 0

  const activityCreatedToCompletionValues: number[] = []
  const activityPlannedToCompletionValues: number[] = []

  for (const activity of activityCohort) {
    if (!atOrBefore(activity.createdAt, input.asOf)) continue

    activityTotal += 1

    if (
      activity.status === "completed"
      && activity.completedAt !== undefined
      && atOrBefore(activity.completedAt, input.asOf)
    ) {
      activityCompleted += 1

      activityCreatedToCompletionValues.push(
        Date.parse(activity.completedAt) - Date.parse(activity.createdAt),
      )

      if (activity.plannedAt !== undefined) {
        activityPlannedToCompletionValues.push(
          Date.parse(activity.completedAt) - Date.parse(activity.plannedAt),
        )
      }

      continue
    }

    if (
      activity.status === "cancelled"
      && atOrBefore(activity.updatedAt, input.asOf)
    ) {
      activityCancelled += 1
      continue
    }

    activityPlanned += 1
  }

  return {
    ok: true,
    value: {
      candidateId: input.candidateId,
      period: {
        startAt: input.period.startAt,
        endAt: input.period.endAt,
        endExclusive: true,
      },
      asOf: input.asOf,

      applications: {
        timeToApplied: timingMetric(timeToAppliedValues),
        timeToInterview: timingMetric(timeToInterviewValues),
        timeToOffer: timingMetric(timeToOfferValues),
      },

      followUps: {
        stateAsOf: {
          total: followUpTotal,
          open: followUpOpen,
          overdue: followUpOverdue,
          completed: followUpCompleted,
        },
        completionTiming: {
          createdToCompletion: timingMetric(
            followUpCreatedToCompletionValues,
          ),
          dueDateDelta: timingMetric(
            followUpDueDateDeltaValues,
          ),
        },
      },

      coachActivities: {
        stateAsOf: {
          total: activityTotal,
          planned: activityPlanned,
          completed: activityCompleted,
          cancelled: activityCancelled,
        },
        completionTiming: {
          createdToCompletion: timingMetric(
            activityCreatedToCompletionValues,
          ),
          plannedToCompletion: timingMetric(
            activityPlannedToCompletionValues,
          ),
        },
      },
    },
  }
}
