import { describe, expect, test } from "bun:test"
import {
  createCoachPortfolioAnalytics,
  type CreateCoachPortfolioAnalyticsInput,
} from "../src/coach-portfolio-analytics"
import type { CandidateOutcomeAnalytics } from "../src/candidate-outcome-analytics"
import type { CandidateActivityAnalytics } from "../src/candidate-activity-analytics"
import type { CandidateTimeAnalytics } from "../src/candidate-time-analytics"

const period = {
  startAt: "2026-09-01T00:00:00.000Z",
  endAt: "2026-10-01T00:00:00.000Z",
}

const asOf = "2026-10-15T00:00:00.000Z"

function outcome(
  candidateId: string,
  overrides: Partial<CandidateOutcomeAnalytics["applications"]> = {},
): CandidateOutcomeAnalytics {
  const applications = {
    total: 0,
    reachedApplied: 0,
    reachedInterview: 0,
    reachedOffer: 0,
    rejected: 0,
    withdrawn: 0,
    closed: 0,
    ...overrides,
  }

  return {
    candidateId,
    period: {
      ...period,
      endExclusive: true,
    },
    applications,
    funnel: {
      applicationToApplied: {
        numerator: applications.reachedApplied,
        denominator: applications.total,
        rate:
          applications.total === 0
            ? null
            : applications.reachedApplied / applications.total,
      },
      appliedToInterview: {
        numerator: applications.reachedInterview,
        denominator: applications.reachedApplied,
        rate:
          applications.reachedApplied === 0
            ? null
            : applications.reachedInterview / applications.reachedApplied,
      },
      interviewToOffer: {
        numerator: applications.reachedOffer,
        denominator: applications.reachedInterview,
        rate:
          applications.reachedInterview === 0
            ? null
            : applications.reachedOffer / applications.reachedInterview,
      },
    },
  }
}

function activity(
  candidateId: string,
  overrides: {
    followUps?: Partial<CandidateActivityAnalytics["followUps"]>
    coachActivities?: Partial<CandidateActivityAnalytics["coachActivities"]>
  } = {},
): CandidateActivityAnalytics {
  const emptyCounts = {
    total: 0,
    planned: 0,
    completed: 0,
    cancelled: 0,
  }

  const byKind = {
    applyForJob: { ...emptyCounts },
    updateCv: { ...emptyCounts },
    contactEmployer: { ...emptyCounts },
    attendInterview: { ...emptyCounts },
    completeCourseStep: { ...emptyCounts },
    coachingMeeting: { ...emptyCounts },
  }

  return {
    candidateId,
    period: {
      ...period,
      endExclusive: true,
    },
    followUps: {
      total: 0,
      completed: 0,
      incomplete: 0,
      completion: {
        numerator: 0,
        denominator: 0,
        rate: null,
      },
      ...overrides.followUps,
    },
    coachActivities: {
      ...emptyCounts,
      completion: {
        numerator: 0,
        denominator: 0,
        rate: null,
      },
      byKind,
      ...overrides.coachActivities,
    },
  }
}

function time(
  candidateId: string,
  overrides: Partial<CandidateTimeAnalytics> = {},
): CandidateTimeAnalytics {
  const emptyMetric = {
    count: 0,
    totalMilliseconds: 0,
    averageMilliseconds: null,
  }

  return {
    candidateId,
    period: {
      ...period,
      endExclusive: true,
    },
    asOf,
    applications: {
      timeToApplied: { ...emptyMetric },
      timeToInterview: { ...emptyMetric },
      timeToOffer: { ...emptyMetric },
    },
    followUps: {
      stateAsOf: {
        total: 0,
        open: 0,
        overdue: 0,
        completed: 0,
      },
      completionTiming: {
        createdToCompletion: { ...emptyMetric },
        dueDateDelta: { ...emptyMetric },
      },
    },
    coachActivities: {
      stateAsOf: {
        total: 0,
        planned: 0,
        completed: 0,
        cancelled: 0,
      },
      completionTiming: {
        createdToCompletion: { ...emptyMetric },
        plannedToCompletion: { ...emptyMetric },
      },
    },
    ...overrides,
  }
}

function input(
  overrides: Partial<CreateCoachPortfolioAnalyticsInput> = {},
): CreateCoachPortfolioAnalyticsInput {
  return {
    period,
    asOf,
    outcomes: [],
    activities: [],
    times: [],
    ...overrides,
  }
}

describe("createCoachPortfolioAnalytics", () => {
  test("returns an empty deterministic portfolio", () => {
    const result = createCoachPortfolioAnalytics(input())

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.candidates).toEqual({
      total: 0,
      withApplications: 0,
      withFollowUps: 0,
      withCoachActivities: 0,
    })

    expect(result.value.applications.total).toBe(0)
    expect(result.value.applications.funnel.applicationToApplied.rate).toBeNull()
    expect(result.value.applicationTiming.timeToApplied).toEqual({
      count: 0,
      totalMilliseconds: 0,
      averageMilliseconds: null,
    })
  })

  test("aggregates application outcomes across candidates", () => {
    const result = createCoachPortfolioAnalytics(
      input({
        outcomes: [
          outcome("candidate-a", {
            total: 3,
            reachedApplied: 2,
            reachedInterview: 1,
            reachedOffer: 1,
            rejected: 1,
          }),
          outcome("candidate-b", {
            total: 2,
            reachedApplied: 2,
            reachedInterview: 2,
            reachedOffer: 0,
            withdrawn: 1,
            closed: 1,
          }),
        ],
        activities: [
          activity("candidate-a"),
          activity("candidate-b"),
        ],
        times: [
          time("candidate-a"),
          time("candidate-b"),
        ],
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.applications).toMatchObject({
      total: 5,
      reachedApplied: 4,
      reachedInterview: 3,
      reachedOffer: 1,
      rejected: 1,
      withdrawn: 1,
      closed: 1,
    })

    expect(result.value.applications.funnel).toEqual({
      applicationToApplied: {
        numerator: 4,
        denominator: 5,
        rate: 0.8,
      },
      appliedToInterview: {
        numerator: 3,
        denominator: 4,
        rate: 0.75,
      },
      interviewToOffer: {
        numerator: 1,
        denominator: 3,
        rate: 1 / 3,
      },
    })
  })

  test("counts candidates with portfolio activity once each", () => {
    const result = createCoachPortfolioAnalytics(
      input({
        outcomes: [
          outcome("candidate-a", { total: 4 }),
          outcome("candidate-b"),
        ],
        activities: [
          activity("candidate-a", {
            followUps: {
              total: 5,
              completed: 3,
              incomplete: 2,
              completion: {
                numerator: 3,
                denominator: 5,
                rate: 0.6,
              },
            },
            coachActivities: {
              total: 3,
              planned: 1,
              completed: 2,
              cancelled: 0,
              completion: {
                numerator: 2,
                denominator: 3,
                rate: 2 / 3,
              },
            },
          }),
          activity("candidate-b"),
        ],
        times: [
          time("candidate-a"),
          time("candidate-b"),
        ],
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.candidates).toEqual({
      total: 2,
      withApplications: 1,
      withFollowUps: 1,
      withCoachActivities: 1,
    })
  })

  test("aggregates follow-up eventual and as-of state separately", () => {
    const result = createCoachPortfolioAnalytics(
      input({
        outcomes: [outcome("candidate-a"), outcome("candidate-b")],
        activities: [
          activity("candidate-a", {
            followUps: {
              total: 2,
              completed: 1,
              incomplete: 1,
              completion: {
                numerator: 1,
                denominator: 2,
                rate: 0.5,
              },
            },
          }),
          activity("candidate-b", {
            followUps: {
              total: 3,
              completed: 2,
              incomplete: 1,
              completion: {
                numerator: 2,
                denominator: 3,
                rate: 2 / 3,
              },
            },
          }),
        ],
        times: [
          time("candidate-a", {
            followUps: {
              stateAsOf: {
                total: 2,
                open: 1,
                overdue: 0,
                completed: 1,
              },
              completionTiming: {
                createdToCompletion: {
                  count: 1,
                  totalMilliseconds: 100,
                  averageMilliseconds: 100,
                },
                dueDateDelta: {
                  count: 1,
                  totalMilliseconds: -20,
                  averageMilliseconds: -20,
                },
              },
            },
          }),
          time("candidate-b", {
            followUps: {
              stateAsOf: {
                total: 3,
                open: 0,
                overdue: 2,
                completed: 1,
              },
              completionTiming: {
                createdToCompletion: {
                  count: 1,
                  totalMilliseconds: 300,
                  averageMilliseconds: 300,
                },
                dueDateDelta: {
                  count: 1,
                  totalMilliseconds: 40,
                  averageMilliseconds: 40,
                },
              },
            },
          }),
        ],
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.followUps.total).toBe(5)
    expect(result.value.followUps.completed).toBe(3)
    expect(result.value.followUps.incomplete).toBe(2)

    expect(result.value.followUps.stateAsOf).toEqual({
      total: 5,
      open: 1,
      overdue: 2,
      completed: 2,
    })
  })

  test("aggregates timing by count and total, not average-of-averages", () => {
    const result = createCoachPortfolioAnalytics(
      input({
        outcomes: [outcome("candidate-a"), outcome("candidate-b")],
        activities: [activity("candidate-a"), activity("candidate-b")],
        times: [
          time("candidate-a", {
            applications: {
              timeToApplied: {
                count: 1,
                totalMilliseconds: 100,
                averageMilliseconds: 100,
              },
              timeToInterview: {
                count: 0,
                totalMilliseconds: 0,
                averageMilliseconds: null,
              },
              timeToOffer: {
                count: 0,
                totalMilliseconds: 0,
                averageMilliseconds: null,
              },
            },
          }),
          time("candidate-b", {
            applications: {
              timeToApplied: {
                count: 3,
                totalMilliseconds: 900,
                averageMilliseconds: 300,
              },
              timeToInterview: {
                count: 0,
                totalMilliseconds: 0,
                averageMilliseconds: null,
              },
              timeToOffer: {
                count: 0,
                totalMilliseconds: 0,
                averageMilliseconds: null,
              },
            },
          }),
        ],
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.applicationTiming.timeToApplied).toEqual({
      count: 4,
      totalMilliseconds: 1000,
      averageMilliseconds: 250,
    })
  })

  test("aggregates all coach activity kinds", () => {
    const candidateA = activity("candidate-a")
    candidateA.coachActivities.total = 6
    candidateA.coachActivities.planned = 2
    candidateA.coachActivities.completed = 3
    candidateA.coachActivities.cancelled = 1

    candidateA.coachActivities.byKind.applyForJob = {
      total: 1,
      planned: 0,
      completed: 1,
      cancelled: 0,
    }
    candidateA.coachActivities.byKind.updateCv = {
      total: 1,
      planned: 1,
      completed: 0,
      cancelled: 0,
    }
    candidateA.coachActivities.byKind.contactEmployer = {
      total: 1,
      planned: 0,
      completed: 0,
      cancelled: 1,
    }
    candidateA.coachActivities.byKind.attendInterview = {
      total: 1,
      planned: 0,
      completed: 1,
      cancelled: 0,
    }
    candidateA.coachActivities.byKind.completeCourseStep = {
      total: 1,
      planned: 1,
      completed: 0,
      cancelled: 0,
    }
    candidateA.coachActivities.byKind.coachingMeeting = {
      total: 1,
      planned: 0,
      completed: 1,
      cancelled: 0,
    }

    const result = createCoachPortfolioAnalytics(
      input({
        outcomes: [outcome("candidate-a")],
        activities: [candidateA],
        times: [time("candidate-a")],
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.coachActivities.byKind.applyForJob.completed).toBe(1)
    expect(result.value.coachActivities.byKind.updateCv.planned).toBe(1)
    expect(result.value.coachActivities.byKind.contactEmployer.cancelled).toBe(1)
    expect(result.value.coachActivities.byKind.attendInterview.completed).toBe(1)
    expect(result.value.coachActivities.byKind.completeCourseStep.planned).toBe(1)
    expect(result.value.coachActivities.byKind.coachingMeeting.completed).toBe(1)
  })

  test("rejects candidate-set mismatch", () => {
    const result = createCoachPortfolioAnalytics(
      input({
        outcomes: [outcome("candidate-a")],
        activities: [activity("candidate-b")],
        times: [time("candidate-a")],
      }),
    )

    expect(result).toEqual({
      ok: false,
      error: {
        code: "CANDIDATE_SET_MISMATCH",
        message:
          "Outcome, activity, and time analytics must describe the same candidates.",
      },
    })
  })

  test("rejects duplicate candidate IDs", () => {
    const result = createCoachPortfolioAnalytics(
      input({
        outcomes: [
          outcome("candidate-a"),
          outcome("candidate-a"),
        ],
      }),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.code).toBe("MALFORMED_ANALYTICS_INPUT")
  })

  test("rejects candidate period mismatch", () => {
    const mismatched = outcome("candidate-a")
    mismatched.period = {
      startAt: "2026-08-01T00:00:00.000Z",
      endAt: "2026-09-01T00:00:00.000Z",
      endExclusive: true,
    }

    const result = createCoachPortfolioAnalytics(
      input({
        outcomes: [mismatched],
        activities: [activity("candidate-a")],
        times: [time("candidate-a")],
      }),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.code).toBe("ANALYTICS_CONTEXT_MISMATCH")
  })

  test("rejects candidate asOf mismatch", () => {
    const mismatchedTime = time("candidate-a", {
      asOf: "2026-10-16T00:00:00.000Z",
    })

    const result = createCoachPortfolioAnalytics(
      input({
        outcomes: [outcome("candidate-a")],
        activities: [activity("candidate-a")],
        times: [mismatchedTime],
      }),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.code).toBe("ANALYTICS_CONTEXT_MISMATCH")
  })

  test("does not mutate candidate analytics inputs", () => {
    const source = input({
      outcomes: [
        outcome("candidate-a", {
          total: 1,
          reachedApplied: 1,
        }),
      ],
      activities: [activity("candidate-a")],
      times: [time("candidate-a")],
    })

    const before = structuredClone(source)

    const result = createCoachPortfolioAnalytics(source)

    expect(result.ok).toBe(true)
    expect(source).toEqual(before)
  })

  test("is deterministic for identical input", () => {
    const source = input({
      outcomes: [outcome("candidate-a", { total: 2 })],
      activities: [activity("candidate-a")],
      times: [time("candidate-a")],
    })

    const first = createCoachPortfolioAnalytics(source)
    const second = createCoachPortfolioAnalytics(structuredClone(source))

    expect(first).toEqual(second)
  })
})
