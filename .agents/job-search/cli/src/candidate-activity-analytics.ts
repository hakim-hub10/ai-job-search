import type { CandidateFollowUp } from "./coach-candidate-follow-up"
import type { CoachActivity, CoachActivityKind } from "./coach-activity"

export interface CandidateActivityAnalyticsPeriod {
  startAt: string
  endAt: string
  endExclusive: true
}

export interface CandidateActivityConversionMetric {
  numerator: number
  denominator: number
  rate: number | null
}

export interface CandidateActivityAnalyticsCounts {
  total: number
  planned: number
  completed: number
  cancelled: number
}

export interface CandidateActivityAnalytics {
  candidateId: string
  period: CandidateActivityAnalyticsPeriod
  followUps: {
    total: number
    completed: number
    incomplete: number
    completion: CandidateActivityConversionMetric
  }
  coachActivities: CandidateActivityAnalyticsCounts & {
    completion: CandidateActivityConversionMetric
    byKind: Record<CoachActivityKind, CandidateActivityAnalyticsCounts>
  }
}

export interface CreateCandidateActivityAnalyticsInput {
  candidateId: string
  period: {
    startAt: string
    endAt: string
  }
  followUps: CandidateFollowUp[]
  activities: CoachActivity[]
}

export type CandidateActivityAnalyticsErrorCode =
  | "INVALID_CANDIDATE_ID"
  | "INVALID_TIMESTAMP"
  | "INVALID_PERIOD"
  | "MALFORMED_ANALYTICS_INPUT"

export interface CandidateActivityAnalyticsError {
  code: CandidateActivityAnalyticsErrorCode
  message: string
}

export type CandidateActivityAnalyticsResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CandidateActivityAnalyticsError }

const ACTIVITY_KINDS: CoachActivityKind[] = [
  "applyForJob",
  "updateCv",
  "contactEmployer",
  "attendInterview",
  "completeCourseStep",
  "coachingMeeting",
]

const ACTIVITY_STATUSES = new Set([
  "planned",
  "completed",
  "cancelled",
])

function failure<T>(
  code: CandidateActivityAnalyticsErrorCode,
  message: string,
): CandidateActivityAnalyticsResult<T> {
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

function withinPeriod(
  timestamp: string,
  period: { startAt: string; endAt: string },
): boolean {
  const value = Date.parse(timestamp)
  return value >= Date.parse(period.startAt)
    && value < Date.parse(period.endAt)
}

function conversionMetric(
  numerator: number,
  denominator: number,
): CandidateActivityConversionMetric {
  return {
    numerator,
    denominator,
    rate: denominator === 0 ? null : numerator / denominator,
  }
}

function emptyActivityCounts(): CandidateActivityAnalyticsCounts {
  return {
    total: 0,
    planned: 0,
    completed: 0,
    cancelled: 0,
  }
}

function createKindCounts(): Record<
  CoachActivityKind,
  CandidateActivityAnalyticsCounts
> {
  return {
    applyForJob: emptyActivityCounts(),
    updateCv: emptyActivityCounts(),
    contactEmployer: emptyActivityCounts(),
    attendInterview: emptyActivityCounts(),
    completeCourseStep: emptyActivityCounts(),
    coachingMeeting: emptyActivityCounts(),
  }
}

export function createCandidateActivityAnalytics(
  input: CreateCandidateActivityAnalyticsInput,
): CandidateActivityAnalyticsResult<CandidateActivityAnalytics> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return failure(
      "MALFORMED_ANALYTICS_INPUT",
      "Candidate activity analytics input must be an object.",
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
  ) {
    return failure(
      "INVALID_TIMESTAMP",
      "Analytics period boundaries must be valid UTC ISO timestamps.",
    )
  }

  if (Date.parse(input.period.startAt) >= Date.parse(input.period.endAt)) {
    return failure(
      "INVALID_PERIOD",
      "Analytics period start must precede period end.",
    )
  }

  if (!Array.isArray(input.followUps) || !Array.isArray(input.activities)) {
    return failure(
      "MALFORMED_ANALYTICS_INPUT",
      "Analytics follow-ups and activities must be arrays.",
    )
  }

  for (const followUp of input.followUps) {
    if (
      !followUp
      || typeof followUp !== "object"
      || !hasText(followUp.id)
      || !hasText(followUp.candidateId)
      || !isTimestamp(followUp.createdAt)
      || (followUp.completedAt !== undefined
        && !isTimestamp(followUp.completedAt))
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
      || !ACTIVITY_KINDS.includes(activity.kind)
      || !ACTIVITY_STATUSES.has(activity.status)
      || (activity.completedAt !== undefined
        && !isTimestamp(activity.completedAt))
    ) {
      return failure(
        "MALFORMED_ANALYTICS_INPUT",
        "Analytics activities contain malformed records.",
      )
    }

    if (
      (activity.status === "completed" && activity.completedAt === undefined)
      || (activity.status !== "completed"
        && activity.completedAt !== undefined)
    ) {
      return failure(
        "MALFORMED_ANALYTICS_INPUT",
        "Analytics activity completion state is malformed.",
      )
    }
  }

  const cohortFollowUps = input.followUps.filter((followUp) =>
    withinPeriod(followUp.createdAt, input.period)
  )

  const completedFollowUps = cohortFollowUps.filter(
    (followUp) => followUp.completedAt !== undefined,
  ).length

  const cohortActivities = input.activities.filter((activity) =>
    withinPeriod(activity.createdAt, input.period)
  )

  const activityCounts = emptyActivityCounts()
  const byKind = createKindCounts()

  for (const activity of cohortActivities) {
    activityCounts.total += 1
    activityCounts[activity.status] += 1

    const kindCounts = byKind[activity.kind]
    kindCounts.total += 1
    kindCounts[activity.status] += 1
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
      followUps: {
        total: cohortFollowUps.length,
        completed: completedFollowUps,
        incomplete: cohortFollowUps.length - completedFollowUps,
        completion: conversionMetric(
          completedFollowUps,
          cohortFollowUps.length,
        ),
      },
      coachActivities: {
        ...activityCounts,
        completion: conversionMetric(
          activityCounts.completed,
          activityCounts.total,
        ),
        byKind,
      },
    },
  }
}
