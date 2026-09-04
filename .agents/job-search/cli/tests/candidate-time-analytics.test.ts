import { describe, expect, test } from "bun:test"

import type { ApplicationRecord } from "../src/applications"
import type { CandidateFollowUp } from "../src/coach-candidate-follow-up"
import type { CoachActivity } from "../src/coach-activity"
import { createCandidateTimeAnalytics } from "../src/candidate-time-analytics"

const period = {
  startAt: "2026-01-01T00:00:00Z",
  endAt: "2026-02-01T00:00:00Z",
}

const asOf = "2026-02-15T00:00:00Z"

function application(
  id: string,
  createdAt: string,
  statusHistory: Array<{ status: string; timestamp: string }>,
): ApplicationRecord {
  return {
    id,
    createdAt,
    updatedAt: statusHistory.at(-1)?.timestamp ?? createdAt,
    status: statusHistory.at(-1)?.status ?? "saved",
    statusHistory,
    notes: [],
  } as unknown as ApplicationRecord
}

function followUp(
  overrides: Partial<CandidateFollowUp> = {},
): CandidateFollowUp {
  return {
    id: "follow-up-1",
    candidateId: "candidate-1",
    createdAt: "2026-01-05T00:00:00Z",
    updatedAt: "2026-01-05T00:00:00Z",
    dueAt: "2026-01-10T00:00:00Z",
    ...overrides,
  }
}

function activity(
  overrides: Partial<CoachActivity> = {},
): CoachActivity {
  return {
    id: "activity-1",
    candidateId: "candidate-1",
    kind: "applyForJob",
    status: "planned",
    createdAt: "2026-01-05T00:00:00Z",
    updatedAt: "2026-01-05T00:00:00Z",
    ...overrides,
  }
}

function createInput(
  overrides: Partial<Parameters<typeof createCandidateTimeAnalytics>[0]> = {},
) {
  return {
    candidateId: "candidate-1",
    period,
    asOf,
    applications: [],
    followUps: [],
    activities: [],
    ...overrides,
  }
}

describe("createCandidateTimeAnalytics", () => {
  test("returns zero counts and null averages for empty input", () => {
    const result = createCandidateTimeAnalytics(createInput())

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.applications.timeToApplied).toEqual({
      count: 0,
      totalMilliseconds: 0,
      averageMilliseconds: null,
    })

    expect(result.value.followUps.stateAsOf).toEqual({
      total: 0,
      open: 0,
      overdue: 0,
      completed: 0,
    })

    expect(result.value.coachActivities.stateAsOf).toEqual({
      total: 0,
      planned: 0,
      completed: 0,
      cancelled: 0,
    })
  })

  test("measures first factual application milestones", () => {
    const result = createCandidateTimeAnalytics(createInput({
      applications: [
        application(
          "app-1",
          "2026-01-01T00:00:00Z",
          [
            { status: "saved", timestamp: "2026-01-01T00:00:00Z" },
            { status: "applied", timestamp: "2026-01-03T00:00:00Z" },
            { status: "applied", timestamp: "2026-01-04T00:00:00Z" },
            { status: "interview", timestamp: "2026-01-08T00:00:00Z" },
            { status: "offer", timestamp: "2026-01-12T00:00:00Z" },
          ],
        ),
      ],
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.applications.timeToApplied).toEqual({
      count: 1,
      totalMilliseconds: 2 * 24 * 60 * 60 * 1000,
      averageMilliseconds: 2 * 24 * 60 * 60 * 1000,
    })

    expect(result.value.applications.timeToInterview.averageMilliseconds)
      .toBe(7 * 24 * 60 * 60 * 1000)

    expect(result.value.applications.timeToOffer.averageMilliseconds)
      .toBe(11 * 24 * 60 * 60 * 1000)
  })

  test("uses implication semantics for interview and offer", () => {
    const result = createCandidateTimeAnalytics(createInput({
      applications: [
        application(
          "app-1",
          "2026-01-01T00:00:00Z",
          [
            { status: "saved", timestamp: "2026-01-01T00:00:00Z" },
            { status: "offer", timestamp: "2026-01-06T00:00:00Z" },
          ],
        ),
      ],
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const expected = 5 * 24 * 60 * 60 * 1000

    expect(result.value.applications.timeToApplied.averageMilliseconds)
      .toBe(expected)
    expect(result.value.applications.timeToInterview.averageMilliseconds)
      .toBe(expected)
    expect(result.value.applications.timeToOffer.averageMilliseconds)
      .toBe(expected)
  })

  test("ignores application milestone events after asOf", () => {
    const result = createCandidateTimeAnalytics(createInput({
      asOf: "2026-01-05T00:00:00Z",
      applications: [
        application(
          "app-1",
          "2026-01-01T00:00:00Z",
          [
            { status: "saved", timestamp: "2026-01-01T00:00:00Z" },
            { status: "applied", timestamp: "2026-01-06T00:00:00Z" },
          ],
        ),
      ],
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.applications.timeToApplied.count).toBe(0)
    expect(result.value.applications.timeToApplied.averageMilliseconds)
      .toBeNull()
  })

  test("uses creation cohort boundaries", () => {
    const result = createCandidateTimeAnalytics(createInput({
      applications: [
        application(
          "included",
          "2026-01-31T23:59:59Z",
          [
            { status: "applied", timestamp: "2026-01-31T23:59:59Z" },
          ],
        ),
        application(
          "excluded",
          "2026-02-01T00:00:00Z",
          [
            { status: "applied", timestamp: "2026-02-01T00:00:00Z" },
          ],
        ),
      ],
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.applications.timeToApplied.count).toBe(1)
  })

  test("derives follow-up state historically at asOf", () => {
    const result = createCandidateTimeAnalytics(createInput({
      asOf: "2026-01-07T00:00:00Z",
      followUps: [
        followUp({
          id: "open",
          dueAt: "2026-01-10T00:00:00Z",
        }),
        followUp({
          id: "overdue",
          dueAt: "2026-01-06T00:00:00Z",
        }),
        followUp({
          id: "future-completion",
          dueAt: "2026-01-06T00:00:00Z",
          completedAt: "2026-01-10T00:00:00Z",
          updatedAt: "2026-01-10T00:00:00Z",
        }),
      ],
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.followUps.stateAsOf).toEqual({
      total: 3,
      open: 1,
      overdue: 2,
      completed: 0,
    })
  })

  test("measures factual follow-up completion timing", () => {
    const result = createCandidateTimeAnalytics(createInput({
      followUps: [
        followUp({
          createdAt: "2026-01-01T00:00:00Z",
          dueAt: "2026-01-10T00:00:00Z",
          completedAt: "2026-01-12T00:00:00Z",
          updatedAt: "2026-01-12T00:00:00Z",
        }),
      ],
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(
      result.value.followUps.completionTiming
        .createdToCompletion.averageMilliseconds,
    ).toBe(11 * 24 * 60 * 60 * 1000)

    expect(
      result.value.followUps.completionTiming
        .dueDateDelta.averageMilliseconds,
    ).toBe(2 * 24 * 60 * 60 * 1000)
  })

  test("supports negative follow-up due-date delta", () => {
    const result = createCandidateTimeAnalytics(createInput({
      followUps: [
        followUp({
          dueAt: "2026-01-10T00:00:00Z",
          completedAt: "2026-01-08T00:00:00Z",
          updatedAt: "2026-01-08T00:00:00Z",
        }),
      ],
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(
      result.value.followUps.completionTiming
        .dueDateDelta.averageMilliseconds,
    ).toBe(-2 * 24 * 60 * 60 * 1000)
  })

  test("reconstructs coach activity state at asOf", () => {
    const result = createCandidateTimeAnalytics(createInput({
      asOf: "2026-01-07T00:00:00Z",
      activities: [
        activity({ id: "planned" }),
        activity({
          id: "completed",
          status: "completed",
          completedAt: "2026-01-06T00:00:00Z",
          updatedAt: "2026-01-06T00:00:00Z",
        }),
        activity({
          id: "future-completion",
          status: "completed",
          completedAt: "2026-01-10T00:00:00Z",
          updatedAt: "2026-01-10T00:00:00Z",
        }),
        activity({
          id: "cancelled",
          status: "cancelled",
          updatedAt: "2026-01-06T00:00:00Z",
        }),
        activity({
          id: "future-cancellation",
          status: "cancelled",
          updatedAt: "2026-01-10T00:00:00Z",
        }),
      ],
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.coachActivities.stateAsOf).toEqual({
      total: 5,
      planned: 3,
      completed: 1,
      cancelled: 1,
    })
  })

  test("measures coach activity completion timing", () => {
    const result = createCandidateTimeAnalytics(createInput({
      activities: [
        activity({
          status: "completed",
          createdAt: "2026-01-01T00:00:00Z",
          plannedAt: "2026-01-03T00:00:00Z",
          completedAt: "2026-01-05T00:00:00Z",
          updatedAt: "2026-01-05T00:00:00Z",
        }),
      ],
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(
      result.value.coachActivities.completionTiming
        .createdToCompletion.averageMilliseconds,
    ).toBe(4 * 24 * 60 * 60 * 1000)

    expect(
      result.value.coachActivities.completionTiming
        .plannedToCompletion.averageMilliseconds,
    ).toBe(2 * 24 * 60 * 60 * 1000)
  })

  test("does not mutate input records", () => {
    const applications = [
      application(
        "app-1",
        "2026-01-01T00:00:00Z",
        [
          { status: "saved", timestamp: "2026-01-01T00:00:00Z" },
          { status: "applied", timestamp: "2026-01-02T00:00:00Z" },
        ],
      ),
    ]

    const before = structuredClone(applications)

    createCandidateTimeAnalytics(createInput({ applications }))

    expect(applications).toEqual(before)
  })

  test("rejects invalid period and timestamp values", () => {
    const invalidPeriod = createCandidateTimeAnalytics(createInput({
      period: {
        startAt: "2026-02-01T00:00:00Z",
        endAt: "2026-01-01T00:00:00Z",
      },
    }))

    expect(invalidPeriod).toEqual({
      ok: false,
      error: {
        code: "INVALID_PERIOD",
        message: "Analytics period start must precede period end.",
      },
    })

    const invalidAsOf = createCandidateTimeAnalytics(createInput({
      asOf: "not-a-timestamp",
    }))

    expect(invalidAsOf.ok).toBe(false)
    if (invalidAsOf.ok) return

    expect(invalidAsOf.error.code).toBe("INVALID_TIMESTAMP")
  })

  test("rejects malformed timing records", () => {
    const malformedApplication = createCandidateTimeAnalytics(createInput({
      applications: [
        application(
          "app-1",
          "2026-01-05T00:00:00Z",
          [
            { status: "applied", timestamp: "2026-01-04T00:00:00Z" },
          ],
        ),
      ],
    }))

    expect(malformedApplication.ok).toBe(false)
    if (malformedApplication.ok) return

    expect(malformedApplication.error.code)
      .toBe("MALFORMED_ANALYTICS_INPUT")

    const malformedActivity = createCandidateTimeAnalytics(createInput({
      activities: [
        activity({
          status: "completed",
          completedAt: undefined,
        }),
      ],
    }))

    expect(malformedActivity.ok).toBe(false)
    if (malformedActivity.ok) return

    expect(malformedActivity.error.code)
      .toBe("MALFORMED_ANALYTICS_INPUT")
  })
})
