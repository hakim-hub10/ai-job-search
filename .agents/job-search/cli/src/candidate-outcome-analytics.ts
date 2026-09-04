import type { ApplicationRecord, ApplicationStatus } from "./applications"

export interface CandidateOutcomeAnalyticsPeriod {
  startAt: string
  endAt: string
  endExclusive: true
}

export interface CandidateOutcomeConversionMetric {
  numerator: number
  denominator: number
  rate: number | null
}

export interface CandidateOutcomeApplicationCounts {
  total: number
  reachedApplied: number
  reachedInterview: number
  reachedOffer: number
  rejected: number
  withdrawn: number
  closed: number
}

export interface CandidateOutcomeAnalytics {
  candidateId: string
  period: CandidateOutcomeAnalyticsPeriod
  applications: CandidateOutcomeApplicationCounts
  funnel: {
    applicationToApplied: CandidateOutcomeConversionMetric
    appliedToInterview: CandidateOutcomeConversionMetric
    interviewToOffer: CandidateOutcomeConversionMetric
  }
}

export interface CreateCandidateOutcomeAnalyticsInput {
  candidateId: string
  period: {
    startAt: string
    endAt: string
  }
  applications: ApplicationRecord[]
}

export type CandidateOutcomeAnalyticsErrorCode =
  | "INVALID_CANDIDATE_ID"
  | "INVALID_TIMESTAMP"
  | "INVALID_PERIOD"
  | "MALFORMED_ANALYTICS_INPUT"

export interface CandidateOutcomeAnalyticsError {
  code: CandidateOutcomeAnalyticsErrorCode
  message: string
}

export type CandidateOutcomeAnalyticsResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CandidateOutcomeAnalyticsError }

function failure<T>(
  code: CandidateOutcomeAnalyticsErrorCode,
  message: string,
): CandidateOutcomeAnalyticsResult<T> {
  return { ok: false, error: { code, message } }
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

const APPLICATION_STATUS_VALUES = new Set<ApplicationStatus>([
  "saved",
  "preparing",
  "applied",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
  "closed",
])

function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return typeof value === "string"
    && APPLICATION_STATUS_VALUES.has(value as ApplicationStatus)
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    && !Number.isNaN(Date.parse(value))
}

function withinPeriod(timestamp: string, period: { startAt: string; endAt: string }): boolean {
  const value = Date.parse(timestamp)
  return value >= Date.parse(period.startAt) && value < Date.parse(period.endAt)
}

function hasReachedStatus(
  statuses: Set<ApplicationStatus>,
  expected: ApplicationStatus[],
): boolean {
  return expected.some((status) => statuses.has(status))
}

function conversionMetric(
  numerator: number,
  denominator: number,
): CandidateOutcomeConversionMetric {
  return {
    numerator,
    denominator,
    rate: denominator === 0 ? null : numerator / denominator,
  }
}

/**
 * Derives factual application outcomes for a candidate cohort.
 *
 * Cohort membership is based on ApplicationRecord.createdAt within [startAt, endAt).
 * Once an application is included, its complete statusHistory is inspected so later
 * factual outcomes can still be reflected.
 */
export function createCandidateOutcomeAnalytics(
  input: CreateCandidateOutcomeAnalyticsInput,
): CandidateOutcomeAnalyticsResult<CandidateOutcomeAnalytics> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return failure("MALFORMED_ANALYTICS_INPUT", "Candidate outcome analytics input must be an object.")
  }

  if (!hasText(input.candidateId)) {
    return failure("INVALID_CANDIDATE_ID", "Candidate IDs must be non-empty strings.")
  }

  if (!isTimestamp(input.period?.startAt) || !isTimestamp(input.period?.endAt)) {
    return failure("INVALID_TIMESTAMP", "Analytics period boundaries must be valid UTC ISO timestamps.")
  }

  if (Date.parse(input.period.startAt) >= Date.parse(input.period.endAt)) {
    return failure("INVALID_PERIOD", "Analytics period start must precede period end.")
  }

  if (!Array.isArray(input.applications)) {
    return failure("MALFORMED_ANALYTICS_INPUT", "Candidate applications must be an array.")
  }

  for (const application of input.applications) {
    if (!application || typeof application !== "object" || !isTimestamp(application.createdAt)) {
      return failure(
        "MALFORMED_ANALYTICS_INPUT",
        "Application records must contain valid createdAt timestamps.",
      )
    }

    if (!Array.isArray(application.statusHistory)) {
      return failure("MALFORMED_ANALYTICS_INPUT", "Application status history must be an array.")
    }

    for (const event of application.statusHistory) {
      if (!event || typeof event !== "object" || !isApplicationStatus(event.status)) {
        return failure(
          "MALFORMED_ANALYTICS_INPUT",
          "Application status history contains malformed events.",
        )
      }
    }
  }

  const cohort = input.applications.filter((application) =>
    withinPeriod(application.createdAt, input.period),
  )

  let reachedApplied = 0
  let reachedInterview = 0
  let reachedOffer = 0
  let rejected = 0
  let withdrawn = 0
  let closed = 0

  for (const application of cohort) {
    const statuses = new Set<ApplicationStatus>()

    for (const event of application.statusHistory) {
      statuses.add(event.status)
    }

    if (hasReachedStatus(statuses, ["applied", "interview", "offer"])) reachedApplied += 1
    if (hasReachedStatus(statuses, ["interview", "offer"])) reachedInterview += 1
    if (statuses.has("offer")) reachedOffer += 1
    if (statuses.has("rejected")) rejected += 1
    if (statuses.has("withdrawn")) withdrawn += 1
    if (statuses.has("closed")) closed += 1
  }

  const applications: CandidateOutcomeApplicationCounts = {
    total: cohort.length,
    reachedApplied,
    reachedInterview,
    reachedOffer,
    rejected,
    withdrawn,
    closed,
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
      applications,
      funnel: {
        applicationToApplied: conversionMetric(reachedApplied, cohort.length),
        appliedToInterview: conversionMetric(reachedInterview, reachedApplied),
        interviewToOffer: conversionMetric(reachedOffer, reachedInterview),
      },
    },
  }
}
