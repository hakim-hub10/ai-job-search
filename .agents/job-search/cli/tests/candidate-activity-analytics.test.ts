import { describe, expect, test } from "bun:test"
import {
  createCandidateActivityAnalytics,
  type CreateCandidateActivityAnalyticsInput,
} from "../src/candidate-activity-analytics"

const period = {
  startAt: "2026-09-01T00:00:00.000Z",
  endAt: "2026-10-01T00:00:00.000Z",
}

function baseInput(): CreateCandidateActivityAnalyticsInput {
  return {
    candidateId: "candidate-1",
    period,
    followUps: [],
    activities: [],
  }
}

describe("createCandidateActivityAnalytics", () => {
  test("returns empty analytics with null completion rates", () => {
    const result = createCandidateActivityAnalytics(baseInput())

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.followUps).toEqual({
      total: 0,
      completed: 0,
      incomplete: 0,
      completion: {
        numerator: 0,
        denominator: 0,
        rate: null,
      },
    })

    expect(result.value.coachActivities.total).toBe(0)
    expect(result.value.coachActivities.completed).toBe(0)
    expect(result.value.coachActivities.completion).toEqual({
      numerator: 0,
      denominator: 0,
      rate: null,
    })
  })

  test("counts incomplete and completed follow-ups created in the cohort", () => {
    const input = baseInput()

    input.followUps = [
      {
        id: "follow-up-1",
        candidateId: "candidate-1",
        dueAt: "2026-09-10T00:00:00.000Z",
        createdAt: "2026-09-02T00:00:00.000Z",
        updatedAt: "2026-09-02T00:00:00.000Z",
      },
      {
        id: "follow-up-2",
        candidateId: "candidate-1",
        dueAt: "2026-09-11T00:00:00.000Z",
        createdAt: "2026-09-03T00:00:00.000Z",
        updatedAt: "2026-09-12T00:00:00.000Z",
        completedAt: "2026-09-12T00:00:00.000Z",
      },
    ]

    const result = createCandidateActivityAnalytics(input)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.followUps.total).toBe(2)
    expect(result.value.followUps.completed).toBe(1)
    expect(result.value.followUps.incomplete).toBe(1)
    expect(result.value.followUps.completion).toEqual({
      numerator: 1,
      denominator: 2,
      rate: 0.5,
    })
  })

  test("counts follow-up completion after cohort end as eventual completion", () => {
    const input = baseInput()

    input.followUps = [
      {
        id: "follow-up-1",
        candidateId: "candidate-1",
        dueAt: "2026-09-20T00:00:00.000Z",
        createdAt: "2026-09-10T00:00:00.000Z",
        updatedAt: "2026-10-05T00:00:00.000Z",
        completedAt: "2026-10-05T00:00:00.000Z",
      },
    ]

    const result = createCandidateActivityAnalytics(input)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.followUps.completed).toBe(1)
    expect(result.value.followUps.completion.rate).toBe(1)
  })

  test("counts planned completed and cancelled coach activities", () => {
    const input = baseInput()

    input.activities = [
      {
        id: "activity-1",
        candidateId: "candidate-1",
        kind: "applyForJob",
        status: "planned",
        plannedAt: "2026-09-10T00:00:00.000Z",
        createdAt: "2026-09-02T00:00:00.000Z",
        updatedAt: "2026-09-02T00:00:00.000Z",
      },
      {
        id: "activity-2",
        candidateId: "candidate-1",
        kind: "updateCv",
        status: "completed",
        plannedAt: "2026-09-12T00:00:00.000Z",
        completedAt: "2026-09-13T00:00:00.000Z",
        createdAt: "2026-09-03T00:00:00.000Z",
        updatedAt: "2026-09-13T00:00:00.000Z",
      },
      {
        id: "activity-3",
        candidateId: "candidate-1",
        kind: "contactEmployer",
        status: "cancelled",
        createdAt: "2026-09-04T00:00:00.000Z",
        updatedAt: "2026-09-05T00:00:00.000Z",
      },
    ]

    const result = createCandidateActivityAnalytics(input)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.coachActivities.total).toBe(3)
    expect(result.value.coachActivities.planned).toBe(1)
    expect(result.value.coachActivities.completed).toBe(1)
    expect(result.value.coachActivities.cancelled).toBe(1)
    expect(result.value.coachActivities.completion).toEqual({
      numerator: 1,
      denominator: 3,
      rate: 1 / 3,
    })
  })

  test("breaks coach activity counts down by kind", () => {
    const input = baseInput()

    input.activities = [
      {
        id: "activity-1",
        candidateId: "candidate-1",
        kind: "attendInterview",
        status: "completed",
        completedAt: "2026-09-07T00:00:00.000Z",
        createdAt: "2026-09-05T00:00:00.000Z",
        updatedAt: "2026-09-07T00:00:00.000Z",
      },
      {
        id: "activity-2",
        candidateId: "candidate-1",
        kind: "attendInterview",
        status: "planned",
        createdAt: "2026-09-06T00:00:00.000Z",
        updatedAt: "2026-09-06T00:00:00.000Z",
      },
    ]

    const result = createCandidateActivityAnalytics(input)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.coachActivities.byKind.attendInterview).toEqual({
      total: 2,
      planned: 1,
      completed: 1,
      cancelled: 0,
    })

    expect(result.value.coachActivities.byKind.coachingMeeting).toEqual({
      total: 0,
      planned: 0,
      completed: 0,
      cancelled: 0,
    })
  })

  test("uses start inclusive and end exclusive cohort boundaries", () => {
    const input = baseInput()

    input.followUps = [
      {
        id: "start",
        candidateId: "candidate-1",
        dueAt: "2026-09-10T00:00:00.000Z",
        createdAt: period.startAt,
        updatedAt: period.startAt,
      },
      {
        id: "end",
        candidateId: "candidate-1",
        dueAt: "2026-10-10T00:00:00.000Z",
        createdAt: period.endAt,
        updatedAt: period.endAt,
      },
    ]

    const result = createCandidateActivityAnalytics(input)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.followUps.total).toBe(1)
  })

  test("excludes records created outside the cohort", () => {
    const input = baseInput()

    input.activities = [
      {
        id: "outside",
        candidateId: "candidate-1",
        kind: "coachingMeeting",
        status: "completed",
        completedAt: "2026-09-05T00:00:00.000Z",
        createdAt: "2026-08-20T00:00:00.000Z",
        updatedAt: "2026-09-05T00:00:00.000Z",
      },
    ]

    const result = createCandidateActivityAnalytics(input)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.coachActivities.total).toBe(0)
  })

  test("counts coach activity completion after cohort end as eventual completion", () => {
    const input = baseInput()

    input.activities = [
      {
        id: "activity-1",
        candidateId: "candidate-1",
        kind: "completeCourseStep",
        status: "completed",
        completedAt: "2026-10-10T00:00:00.000Z",
        createdAt: "2026-09-20T00:00:00.000Z",
        updatedAt: "2026-10-10T00:00:00.000Z",
      },
    ]

    const result = createCandidateActivityAnalytics(input)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.coachActivities.completed).toBe(1)
    expect(result.value.coachActivities.completion.rate).toBe(1)
  })

  test("does not mutate input", () => {
    const input = baseInput()

    input.activities = [
      {
        id: "activity-1",
        candidateId: "candidate-1",
        kind: "applyForJob",
        status: "planned",
        createdAt: "2026-09-10T00:00:00.000Z",
        updatedAt: "2026-09-10T00:00:00.000Z",
      },
    ]

    const before = structuredClone(input)

    createCandidateActivityAnalytics(input)

    expect(input).toEqual(before)
  })

  test("rejects malformed or reversed periods", () => {
    const invalidTimestamp = createCandidateActivityAnalytics({
      ...baseInput(),
      period: {
        startAt: "invalid",
        endAt: period.endAt,
      },
    })

    expect(invalidTimestamp.ok).toBe(false)
    if (!invalidTimestamp.ok) {
      expect(invalidTimestamp.error.code).toBe("INVALID_TIMESTAMP")
    }

    const reversed = createCandidateActivityAnalytics({
      ...baseInput(),
      period: {
        startAt: period.endAt,
        endAt: period.startAt,
      },
    })

    expect(reversed.ok).toBe(false)
    if (!reversed.ok) {
      expect(reversed.error.code).toBe("INVALID_PERIOD")
    }
  })

  test("rejects malformed follow-up timestamps", () => {
    const input = baseInput()

    input.followUps = [
      {
        id: "follow-up-1",
        candidateId: "candidate-1",
        dueAt: "2026-09-10T00:00:00.000Z",
        createdAt: "invalid",
        updatedAt: "2026-09-02T00:00:00.000Z",
      },
    ]

    const result = createCandidateActivityAnalytics(input)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("MALFORMED_ANALYTICS_INPUT")
    }
  })

  test("rejects unsupported coach activity status", () => {
    const input = baseInput()

    input.activities = [
      {
        id: "activity-1",
        candidateId: "candidate-1",
        kind: "applyForJob",
        status: "unknown" as never,
        createdAt: "2026-09-10T00:00:00.000Z",
        updatedAt: "2026-09-10T00:00:00.000Z",
      },
    ]

    const result = createCandidateActivityAnalytics(input)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("MALFORMED_ANALYTICS_INPUT")
    }
  })

  test("rejects inconsistent completion state", () => {
    const input = baseInput()

    input.activities = [
      {
        id: "activity-1",
        candidateId: "candidate-1",
        kind: "applyForJob",
        status: "planned",
        completedAt: "2026-09-11T00:00:00.000Z",
        createdAt: "2026-09-10T00:00:00.000Z",
        updatedAt: "2026-09-11T00:00:00.000Z",
      },
    ]

    const result = createCandidateActivityAnalytics(input)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("MALFORMED_ANALYTICS_INPUT")
    }
  })
})
