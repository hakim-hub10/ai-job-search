import type {
  CandidateOutcomeAnalytics,
  CandidateOutcomeConversionMetric,
} from "./candidate-outcome-analytics"
import type {
  CandidateActivityAnalytics,
  CandidateActivityAnalyticsCounts,
} from "./candidate-activity-analytics"
import type {
  CandidateTimeAnalytics,
  CandidateTimeMetric,
} from "./candidate-time-analytics"
import type { CoachActivityKind } from "./coach-activity"

export interface CoachPortfolioAnalyticsPeriod {
  startAt: string
  endAt: string
  endExclusive: true
}

export interface CoachPortfolioCandidateCounts {
  total: number
  withApplications: number
  withFollowUps: number
  withCoachActivities: number
}

export interface CoachPortfolioApplicationCounts {
  total: number
  reachedApplied: number
  reachedInterview: number
  reachedOffer: number
  rejected: number
  withdrawn: number
  closed: number
}

export interface CoachPortfolioAnalytics {
  period: CoachPortfolioAnalyticsPeriod
  asOf: string

  candidates: CoachPortfolioCandidateCounts

  applications: CoachPortfolioApplicationCounts & {
    funnel: {
      applicationToApplied: CandidateOutcomeConversionMetric
      appliedToInterview: CandidateOutcomeConversionMetric
      interviewToOffer: CandidateOutcomeConversionMetric
    }
  }

  followUps: {
    total: number
    completed: number
    incomplete: number

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

  coachActivities: CandidateActivityAnalyticsCounts & {
    stateAsOf: {
      total: number
      planned: number
      completed: number
      cancelled: number
    }

    byKind: Record<CoachActivityKind, CandidateActivityAnalyticsCounts>

    completionTiming: {
      createdToCompletion: CandidateTimeMetric
      plannedToCompletion: CandidateTimeMetric
    }
  }

  applicationTiming: {
    timeToApplied: CandidateTimeMetric
    timeToInterview: CandidateTimeMetric
    timeToOffer: CandidateTimeMetric
  }
}

export interface CreateCoachPortfolioAnalyticsInput {
  period: {
    startAt: string
    endAt: string
  }
  asOf: string
  outcomes: CandidateOutcomeAnalytics[]
  activities: CandidateActivityAnalytics[]
  times: CandidateTimeAnalytics[]
}

export type CoachPortfolioAnalyticsErrorCode =
  | "INVALID_TIMESTAMP"
  | "INVALID_PERIOD"
  | "MALFORMED_ANALYTICS_INPUT"
  | "CANDIDATE_SET_MISMATCH"
  | "ANALYTICS_CONTEXT_MISMATCH"

export interface CoachPortfolioAnalyticsError {
  code: CoachPortfolioAnalyticsErrorCode
  message: string
}

export type CoachPortfolioAnalyticsResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CoachPortfolioAnalyticsError }

const ACTIVITY_KINDS: CoachActivityKind[] = [
  "applyForJob",
  "updateCv",
  "contactEmployer",
  "attendInterview",
  "completeCourseStep",
  "coachingMeeting",
]

function failure<T>(
  code: CoachPortfolioAnalyticsErrorCode,
  message: string,
): CoachPortfolioAnalyticsResult<T> {
  return { ok: false, error: { code, message } }
}

function isUtcIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false
  }

  if (!value.endsWith("Z")) {
    return false
  }

  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function samePeriod(
  value: { startAt: string; endAt: string },
  period: { startAt: string; endAt: string },
): boolean {
  return value.startAt === period.startAt && value.endAt === period.endAt
}

function conversion(
  numerator: number,
  denominator: number,
): CandidateOutcomeConversionMetric {
  return {
    numerator,
    denominator,
    rate: denominator === 0 ? null : numerator / denominator,
  }
}

function emptyTimeMetric(): CandidateTimeMetric {
  return {
    count: 0,
    totalMilliseconds: 0,
    averageMilliseconds: null,
  }
}

function aggregateTimeMetrics(metrics: CandidateTimeMetric[]): CandidateTimeMetric {
  const count = metrics.reduce((sum, metric) => sum + metric.count, 0)
  const totalMilliseconds = metrics.reduce(
    (sum, metric) => sum + metric.totalMilliseconds,
    0,
  )

  return {
    count,
    totalMilliseconds,
    averageMilliseconds:
      count === 0 ? null : totalMilliseconds / count,
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

function addActivityCounts(
  target: CandidateActivityAnalyticsCounts,
  source: CandidateActivityAnalyticsCounts,
): void {
  target.total += source.total
  target.planned += source.planned
  target.completed += source.completed
  target.cancelled += source.cancelled
}

function hasUniqueCandidateIds(
  values: Array<{ candidateId: string }>,
): boolean {
  const ids = values.map((value) => value.candidateId)
  return new Set(ids).size === ids.length
}

function sameCandidateSet(
  left: Array<{ candidateId: string }>,
  right: Array<{ candidateId: string }>,
): boolean {
  if (left.length !== right.length) {
    return false
  }

  const rightIds = new Set(right.map((value) => value.candidateId))
  return left.every((value) => rightIds.has(value.candidateId))
}

export function createCoachPortfolioAnalytics(
  input: CreateCoachPortfolioAnalyticsInput,
): CoachPortfolioAnalyticsResult<CoachPortfolioAnalytics> {
  if (
    !input ||
    typeof input !== "object" ||
    !input.period ||
    typeof input.period !== "object" ||
    !Array.isArray(input.outcomes) ||
    !Array.isArray(input.activities) ||
    !Array.isArray(input.times)
  ) {
    return failure(
      "MALFORMED_ANALYTICS_INPUT",
      "Portfolio analytics input is malformed.",
    )
  }

  const { startAt, endAt } = input.period

  if (
    !isUtcIsoTimestamp(startAt) ||
    !isUtcIsoTimestamp(endAt) ||
    !isUtcIsoTimestamp(input.asOf)
  ) {
    return failure(
      "INVALID_TIMESTAMP",
      "Portfolio analytics requires valid UTC ISO timestamps.",
    )
  }

  if (Date.parse(startAt) >= Date.parse(endAt)) {
    return failure(
      "INVALID_PERIOD",
      "Portfolio analytics period must have startAt before endAt.",
    )
  }

  if (
    !hasUniqueCandidateIds(input.outcomes) ||
    !hasUniqueCandidateIds(input.activities) ||
    !hasUniqueCandidateIds(input.times)
  ) {
    return failure(
      "MALFORMED_ANALYTICS_INPUT",
      "Candidate analytics inputs must not contain duplicate candidate IDs.",
    )
  }

  if (
    !sameCandidateSet(input.outcomes, input.activities) ||
    !sameCandidateSet(input.outcomes, input.times)
  ) {
    return failure(
      "CANDIDATE_SET_MISMATCH",
      "Outcome, activity, and time analytics must describe the same candidates.",
    )
  }

  for (const outcome of input.outcomes) {
    if (!samePeriod(outcome.period, input.period)) {
      return failure(
        "ANALYTICS_CONTEXT_MISMATCH",
        "Candidate outcome analytics period does not match the portfolio period.",
      )
    }
  }

  for (const activity of input.activities) {
    if (!samePeriod(activity.period, input.period)) {
      return failure(
        "ANALYTICS_CONTEXT_MISMATCH",
        "Candidate activity analytics period does not match the portfolio period.",
      )
    }
  }

  for (const time of input.times) {
    if (
      !samePeriod(time.period, input.period) ||
      time.asOf !== input.asOf
    ) {
      return failure(
        "ANALYTICS_CONTEXT_MISMATCH",
        "Candidate time analytics context does not match the portfolio context.",
      )
    }
  }

  const activityByCandidate = new Map(
    input.activities.map((value) => [value.candidateId, value]),
  )
  const timeByCandidate = new Map(
    input.times.map((value) => [value.candidateId, value]),
  )

  const applicationCounts: CoachPortfolioApplicationCounts = {
    total: 0,
    reachedApplied: 0,
    reachedInterview: 0,
    reachedOffer: 0,
    rejected: 0,
    withdrawn: 0,
    closed: 0,
  }

  const followUps = {
    total: 0,
    completed: 0,
    incomplete: 0,
    stateAsOf: {
      total: 0,
      open: 0,
      overdue: 0,
      completed: 0,
    },
  }

  const coachActivities = emptyActivityCounts()
  const coachActivityStateAsOf = {
    total: 0,
    planned: 0,
    completed: 0,
    cancelled: 0,
  }

  const byKind = Object.fromEntries(
    ACTIVITY_KINDS.map((kind) => [kind, emptyActivityCounts()]),
  ) as Record<CoachActivityKind, CandidateActivityAnalyticsCounts>

  let withApplications = 0
  let withFollowUps = 0
  let withCoachActivities = 0

  const timeToApplied: CandidateTimeMetric[] = []
  const timeToInterview: CandidateTimeMetric[] = []
  const timeToOffer: CandidateTimeMetric[] = []
  const followUpCreatedToCompletion: CandidateTimeMetric[] = []
  const followUpDueDateDelta: CandidateTimeMetric[] = []
  const activityCreatedToCompletion: CandidateTimeMetric[] = []
  const activityPlannedToCompletion: CandidateTimeMetric[] = []

  for (const outcome of input.outcomes) {
    const activity = activityByCandidate.get(outcome.candidateId)
    const time = timeByCandidate.get(outcome.candidateId)

    if (!activity || !time) {
      return failure(
        "CANDIDATE_SET_MISMATCH",
        "Candidate analytics inputs are incomplete.",
      )
    }

    if (outcome.applications.total > 0) {
      withApplications += 1
    }

    if (activity.followUps.total > 0) {
      withFollowUps += 1
    }

    if (activity.coachActivities.total > 0) {
      withCoachActivities += 1
    }

    applicationCounts.total += outcome.applications.total
    applicationCounts.reachedApplied += outcome.applications.reachedApplied
    applicationCounts.reachedInterview += outcome.applications.reachedInterview
    applicationCounts.reachedOffer += outcome.applications.reachedOffer
    applicationCounts.rejected += outcome.applications.rejected
    applicationCounts.withdrawn += outcome.applications.withdrawn
    applicationCounts.closed += outcome.applications.closed

    followUps.total += activity.followUps.total
    followUps.completed += activity.followUps.completed
    followUps.incomplete += activity.followUps.incomplete

    followUps.stateAsOf.total += time.followUps.stateAsOf.total
    followUps.stateAsOf.open += time.followUps.stateAsOf.open
    followUps.stateAsOf.overdue += time.followUps.stateAsOf.overdue
    followUps.stateAsOf.completed += time.followUps.stateAsOf.completed

    addActivityCounts(coachActivities, activity.coachActivities)

    coachActivityStateAsOf.total += time.coachActivities.stateAsOf.total
    coachActivityStateAsOf.planned += time.coachActivities.stateAsOf.planned
    coachActivityStateAsOf.completed += time.coachActivities.stateAsOf.completed
    coachActivityStateAsOf.cancelled += time.coachActivities.stateAsOf.cancelled

    for (const kind of ACTIVITY_KINDS) {
      addActivityCounts(
        byKind[kind],
        activity.coachActivities.byKind[kind],
      )
    }

    timeToApplied.push(time.applications.timeToApplied)
    timeToInterview.push(time.applications.timeToInterview)
    timeToOffer.push(time.applications.timeToOffer)

    followUpCreatedToCompletion.push(
      time.followUps.completionTiming.createdToCompletion,
    )
    followUpDueDateDelta.push(
      time.followUps.completionTiming.dueDateDelta,
    )

    activityCreatedToCompletion.push(
      time.coachActivities.completionTiming.createdToCompletion,
    )
    activityPlannedToCompletion.push(
      time.coachActivities.completionTiming.plannedToCompletion,
    )
  }

  return {
    ok: true,
    value: {
      period: {
        startAt,
        endAt,
        endExclusive: true,
      },
      asOf: input.asOf,

      candidates: {
        total: input.outcomes.length,
        withApplications,
        withFollowUps,
        withCoachActivities,
      },

      applications: {
        ...applicationCounts,
        funnel: {
          applicationToApplied: conversion(
            applicationCounts.reachedApplied,
            applicationCounts.total,
          ),
          appliedToInterview: conversion(
            applicationCounts.reachedInterview,
            applicationCounts.reachedApplied,
          ),
          interviewToOffer: conversion(
            applicationCounts.reachedOffer,
            applicationCounts.reachedInterview,
          ),
        },
      },

      followUps: {
        ...followUps,
        completionTiming: {
          createdToCompletion: aggregateTimeMetrics(
            followUpCreatedToCompletion,
          ),
          dueDateDelta: aggregateTimeMetrics(
            followUpDueDateDelta,
          ),
        },
      },

      coachActivities: {
        ...coachActivities,
        stateAsOf: coachActivityStateAsOf,
        byKind,
        completionTiming: {
          createdToCompletion: aggregateTimeMetrics(
            activityCreatedToCompletion,
          ),
          plannedToCompletion: aggregateTimeMetrics(
            activityPlannedToCompletion,
          ),
        },
      },

      applicationTiming: {
        timeToApplied:
          timeToApplied.length === 0
            ? emptyTimeMetric()
            : aggregateTimeMetrics(timeToApplied),
        timeToInterview:
          timeToInterview.length === 0
            ? emptyTimeMetric()
            : aggregateTimeMetrics(timeToInterview),
        timeToOffer:
          timeToOffer.length === 0
            ? emptyTimeMetric()
            : aggregateTimeMetrics(timeToOffer),
      },
    },
  }
}
