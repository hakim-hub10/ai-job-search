import { describe, expect, test } from "bun:test"
import type { ApplicationRecord, ApplicationStatus } from "../src/applications"
import { createCandidateOutcomeAnalytics } from "../src/candidate-outcome-analytics"

function application(
  id: string,
  createdAt: string,
  statuses: Array<{ status: ApplicationStatus; timestamp: string }>,
): ApplicationRecord {
  const jobId = `job-${id}`
  const jobTitle = "Example Role"

  return {
    id,
    jobSnapshot: {
      id: jobId,
      title: jobTitle,
      company: "Example Company",
      location: "Example City",
      country: "Sweden",
      url: null,
      applyUrl: null,
      source: "test",
      sourceId: `source-${id}`,
      date: null,
      employmentType: null,
      remote: null,
      description: null,
      salary: null,
      skills: [],
      seniority: null,
      category: null,
    },
    analysisSnapshot: {
      rank: 1,
      matchingResult: {
        jobId,
        jobTitle,
        candidateHeadline: "Test Candidate",
        matched: [],
        missing: [],
        conflicting: [],
        unknown: [],
        totalMatched: 0,
        totalMissing: 0,
        totalConflicting: 0,
        totalUnknown: 0,
        matchedDimensions: [],
        missingDimensions: [],
        conflictingDimensions: [],
        unknownDimensions: [],
      },
      scoringResult: {
        jobId,
        jobTitle,
        score: 0,
        confidence: 0,
        confidenceLabel: "low",
        summary: "",
        breakdown: {
          totalDimensions: 10,
          knownDimensions: 0,
          unknownDimensions: 0,
          totalPoints: 0,
          pointsAchieved: 0,
          dimensions: [],
        },
        matched: [],
        missing: [],
        conflicting: [],
        unknown: [],
      },
      skillGapResult: {
        jobId,
        jobTitle,
        candidateHeadline: "Test Candidate",
        gaps: [],
        strengths: [],
        unknowns: [],
        recommendations: [],
        totalGaps: 0,
        criticalGaps: 0,
        highGaps: 0,
        summary: "",
      },
      explanation: "",
    },
    status: statuses.at(-1)?.status ?? "saved",
    statusHistory: statuses,
    notes: [],
    createdAt,
    updatedAt: statuses.at(-1)?.timestamp ?? createdAt,
  }
}

const period = {
  startAt: "2026-09-01T00:00:00.000Z",
  endAt: "2026-10-01T00:00:00.000Z",
}

describe("candidate outcome analytics", () => {
  test("returns an empty cohort with null conversion rates", () => {
    const result = createCandidateOutcomeAnalytics({
      candidateId: "candidate-1",
      period,
      applications: [],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.applications.total).toBe(0)
    expect(result.value.applications.reachedApplied).toBe(0)
    expect(result.value.applications.reachedInterview).toBe(0)
    expect(result.value.applications.reachedOffer).toBe(0)

    expect(result.value.funnel.applicationToApplied.rate).toBeNull()
    expect(result.value.funnel.appliedToInterview.rate).toBeNull()
    expect(result.value.funnel.interviewToOffer.rate).toBeNull()
  })

  test("saved application does not count as applied", () => {
    const app = application("app-1", "2026-09-05T10:00:00.000Z", [
      { status: "saved", timestamp: "2026-09-05T10:00:00.000Z" },
    ])

    const result = createCandidateOutcomeAnalytics({
      candidateId: "candidate-1",
      period,
      applications: [app],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.applications.total).toBe(1)
    expect(result.value.applications.reachedApplied).toBe(0)
  })

  test("applied status counts as reached applied", () => {
    const app = application("app-1", "2026-09-05T10:00:00.000Z", [
      { status: "saved", timestamp: "2026-09-05T10:00:00.000Z" },
      { status: "applied", timestamp: "2026-09-06T10:00:00.000Z" },
    ])

    const result = createCandidateOutcomeAnalytics({
      candidateId: "candidate-1",
      period,
      applications: [app],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.applications.reachedApplied).toBe(1)
    expect(result.value.funnel.applicationToApplied).toEqual({
      numerator: 1,
      denominator: 1,
      rate: 1,
    })
  })

  test("interview implies reached applied and reached interview", () => {
    const app = application("app-1", "2026-09-05T10:00:00.000Z", [
      { status: "interview", timestamp: "2026-09-10T10:00:00.000Z" },
    ])

    const result = createCandidateOutcomeAnalytics({
      candidateId: "candidate-1",
      period,
      applications: [app],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.applications.reachedApplied).toBe(1)
    expect(result.value.applications.reachedInterview).toBe(1)
  })

  test("offer implies reached applied and reached interview", () => {
    const app = application("app-1", "2026-09-05T10:00:00.000Z", [
      { status: "offer", timestamp: "2026-09-15T10:00:00.000Z" },
    ])

    const result = createCandidateOutcomeAnalytics({
      candidateId: "candidate-1",
      period,
      applications: [app],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.applications.reachedApplied).toBe(1)
    expect(result.value.applications.reachedInterview).toBe(1)
    expect(result.value.applications.reachedOffer).toBe(1)
  })

  test("duplicate status events do not double-count", () => {
    const app = application("app-1", "2026-09-05T10:00:00.000Z", [
      { status: "saved", timestamp: "2026-09-05T10:00:00.000Z" },
      { status: "preparing", timestamp: "2026-09-06T10:00:00.000Z" },
      { status: "preparing", timestamp: "2026-09-07T10:00:00.000Z" },
      { status: "applied", timestamp: "2026-09-08T10:00:00.000Z" },
      { status: "interview", timestamp: "2026-09-12T10:00:00.000Z" },
      { status: "rejected", timestamp: "2026-09-20T10:00:00.000Z" },
    ])

    const result = createCandidateOutcomeAnalytics({
      candidateId: "candidate-1",
      period,
      applications: [app],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.applications).toEqual({
      total: 1,
      reachedApplied: 1,
      reachedInterview: 1,
      reachedOffer: 0,
      rejected: 1,
      withdrawn: 0,
      closed: 0,
    })
  })

  test("tracks rejected, withdrawn and closed outcomes", () => {
    const rejected = application("rejected", "2026-09-05T10:00:00.000Z", [
      { status: "rejected", timestamp: "2026-09-10T10:00:00.000Z" },
    ])
    const withdrawn = application("withdrawn", "2026-09-06T10:00:00.000Z", [
      { status: "withdrawn", timestamp: "2026-09-11T10:00:00.000Z" },
    ])
    const closed = application("closed", "2026-09-07T10:00:00.000Z", [
      { status: "closed", timestamp: "2026-09-12T10:00:00.000Z" },
    ])

    const result = createCandidateOutcomeAnalytics({
      candidateId: "candidate-1",
      period,
      applications: [rejected, withdrawn, closed],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.applications.rejected).toBe(1)
    expect(result.value.applications.withdrawn).toBe(1)
    expect(result.value.applications.closed).toBe(1)
  })

  test("period start is inclusive and period end is exclusive", () => {
    const atStart = application("start", period.startAt, [
      { status: "saved", timestamp: period.startAt },
    ])
    const atEnd = application("end", period.endAt, [
      { status: "saved", timestamp: period.endAt },
    ])

    const result = createCandidateOutcomeAnalytics({
      candidateId: "candidate-1",
      period,
      applications: [atStart, atEnd],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.applications.total).toBe(1)
  })

  test("later outcomes still count for applications created inside cohort period", () => {
    const app = application("app-1", "2026-09-20T10:00:00.000Z", [
      { status: "applied", timestamp: "2026-09-20T10:00:00.000Z" },
      { status: "interview", timestamp: "2026-10-05T10:00:00.000Z" },
      { status: "offer", timestamp: "2026-10-10T10:00:00.000Z" },
    ])

    const result = createCandidateOutcomeAnalytics({
      candidateId: "candidate-1",
      period,
      applications: [app],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.applications.reachedInterview).toBe(1)
    expect(result.value.applications.reachedOffer).toBe(1)
  })

  test("applications created outside cohort period are excluded", () => {
    const before = application("before", "2026-08-31T23:59:59.000Z", [
      { status: "offer", timestamp: "2026-09-10T10:00:00.000Z" },
    ])
    const after = application("after", "2026-10-01T00:00:00.000Z", [
      { status: "offer", timestamp: "2026-10-10T10:00:00.000Z" },
    ])

    const result = createCandidateOutcomeAnalytics({
      candidateId: "candidate-1",
      period,
      applications: [before, after],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.applications.total).toBe(0)
  })

  test("does not mutate input records", () => {
    const app = application("app-1", "2026-09-05T10:00:00.000Z", [
      { status: "applied", timestamp: "2026-09-05T10:00:00.000Z" },
    ])

    const original = structuredClone(app)

    createCandidateOutcomeAnalytics({
      candidateId: "candidate-1",
      period,
      applications: [app],
    })

    expect(app).toEqual(original)
  })

  test("rejects malformed periods", () => {
    const result = createCandidateOutcomeAnalytics({
      candidateId: "candidate-1",
      period: {
        startAt: "2026-10-01T00:00:00.000Z",
        endAt: "2026-09-01T00:00:00.000Z",
      },
      applications: [],
    })

    expect(result).toEqual({
      ok: false,
      error: {
        code: "INVALID_PERIOD",
        message: "Analytics period start must precede period end.",
      },
    })
  })

  test("rejects applications with malformed createdAt", () => {
    const app = application("app-1", "2026-09-05T10:00:00.000Z", [
      { status: "saved", timestamp: "2026-09-05T10:00:00.000Z" },
    ])

    app.createdAt = "not-a-timestamp"

    const result = createCandidateOutcomeAnalytics({
      candidateId: "candidate-1",
      period,
      applications: [app],
    })

    expect(result).toEqual({
      ok: false,
      error: {
        code: "MALFORMED_ANALYTICS_INPUT",
        message: "Application records must contain valid createdAt timestamps.",
      },
    })
  })

  test("rejects unknown application status history values", () => {
    const app = application("app-1", "2026-09-05T10:00:00.000Z", [
      { status: "saved", timestamp: "2026-09-05T10:00:00.000Z" },
    ])

    ;(app.statusHistory[0] as unknown as { status: string }).status = "hired"

    const result = createCandidateOutcomeAnalytics({
      candidateId: "candidate-1",
      period,
      applications: [app],
    })

    expect(result).toEqual({
      ok: false,
      error: {
        code: "MALFORMED_ANALYTICS_INPUT",
        message: "Application status history contains malformed events.",
      },
    })
  })

})
