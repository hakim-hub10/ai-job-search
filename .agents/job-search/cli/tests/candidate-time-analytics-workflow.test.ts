import { describe, expect, test } from "bun:test"

import type { ApplicationRepository } from "../src/application-repository"
import type { CandidateApplicationAssociationRepository } from "../src/coach-application-association-repository"
import type { CandidateFollowUpRepository } from "../src/coach-candidate-follow-up-repository"
import type { CoachOperationsRepository } from "../src/coach-operations-repository"
import type { CoachWorkspaceRepository } from "../src/coach-workspace-repository"
import { createCandidateTimeAnalyticsWorkflow } from "../src/candidate-time-analytics-workflow"

const period = {
  startAt: "2026-09-01T00:00:00.000Z",
  endAt: "2026-10-01T00:00:00.000Z",
}

const asOf = "2026-10-10T00:00:00.000Z"

function repositories() {
  const candidates = {
    async getCandidateById(id: string) {
      return id === "candidate-1"
        ? {
            ok: true as const,
            value: {
              id: "candidate-1",
              displayName: "Candidate One",
              createdAt: "2026-08-01T00:00:00.000Z",
              updatedAt: "2026-08-01T00:00:00.000Z",
            },
          }
        : {
            ok: false as const,
            error: {
              code: "NOT_FOUND" as const,
              message: "Candidate not found.",
            },
          }
    },
  } as CoachWorkspaceRepository

  const applications = {
    async getById(id: string) {
      if (id !== "application-1") {
        return {
          ok: false as const,
          error: {
            code: "NOT_FOUND" as const,
            message: "Application not found.",
          },
        }
      }

      return {
        ok: true as const,
        value: {
          id: "application-1",
          jobSnapshot: {
            title: "IT Support",
            company: "Example",
            location: "Jönköping",
            source: "test",
            sourceJobId: "job-1",
            url: "https://example.test/job-1",
          },
          analysisSnapshot: {},
          status: "interview" as const,
          statusHistory: [
            {
              status: "saved" as const,
              timestamp: "2026-09-01T00:00:00.000Z",
            },
            {
              status: "applied" as const,
              timestamp: "2026-09-03T00:00:00.000Z",
            },
            {
              status: "interview" as const,
              timestamp: "2026-09-08T00:00:00.000Z",
            },
          ],
          notes: [],
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-08T00:00:00.000Z",
        },
      }
    },
  } as ApplicationRepository

  const associations = {
    async listByCandidateId(candidateId: string) {
      if (candidateId !== "candidate-1") {
        return {
          ok: true as const,
          value: [],
        }
      }

      return {
        ok: true as const,
        value: [
          {
            candidateId: "candidate-1",
            applicationId: "application-1",
            createdAt: "2026-09-01T00:00:00.000Z",
          },
        ],
      }
    },

    async getByApplicationId(applicationId: string) {
      if (applicationId !== "application-1") {
        return {
          ok: false as const,
          error: {
            code: "NOT_FOUND" as const,
            message: "Association not found.",
          },
        }
      }

      return {
        ok: true as const,
        value: {
          candidateId: "candidate-1",
          applicationId: "application-1",
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      }
    },
  } as CandidateApplicationAssociationRepository

  const followUps = {
    async listByCandidateId() {
      return {
        ok: true as const,
        value: [
          {
            id: "follow-up-1",
            candidateId: "candidate-1",
            applicationId: "application-1",
            dueAt: "2026-09-10T00:00:00.000Z",
            createdAt: "2026-09-02T00:00:00.000Z",
            updatedAt: "2026-10-03T00:00:00.000Z",
            completedAt: "2026-10-03T00:00:00.000Z",
          },
        ],
      }
    },
  } as unknown as CandidateFollowUpRepository

  const operations = {
    async listActivitiesByCandidateId() {
      return {
        ok: true as const,
        value: [
          {
            id: "activity-1",
            candidateId: "candidate-1",
            applicationId: "application-1",
            kind: "applyForJob" as const,
            status: "completed" as const,
            plannedAt: "2026-09-05T00:00:00.000Z",
            createdAt: "2026-09-03T00:00:00.000Z",
            updatedAt: "2026-10-04T00:00:00.000Z",
            completedAt: "2026-10-04T00:00:00.000Z",
          },
        ],
      }
    },
  } as unknown as CoachOperationsRepository

  return {
    candidates,
    applications,
    associations,
    followUps,
    operations,
  }
}

function workflowFrom(repos: ReturnType<typeof repositories>) {
  return createCandidateTimeAnalyticsWorkflow(
    repos.candidates,
    repos.applications,
    repos.associations,
    repos.followUps,
    repos.operations,
  )
}

describe("createCandidateTimeAnalyticsWorkflow", () => {
  test("loads candidate-owned records and derives factual time analytics", async () => {
    const repos = repositories()
    const workflow = workflowFrom(repos)

    const result = await workflow.getCandidateTimeAnalytics(
      "candidate-1",
      period,
      asOf,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.candidateId).toBe("candidate-1")
    expect(result.value.asOf).toBe(asOf)

    expect(
      result.value.applications.timeToApplied.averageMilliseconds,
    ).toBe(2 * 24 * 60 * 60 * 1000)

    expect(
      result.value.applications.timeToInterview.averageMilliseconds,
    ).toBe(7 * 24 * 60 * 60 * 1000)

    expect(result.value.applications.timeToOffer.count).toBe(0)

    expect(result.value.followUps.stateAsOf).toEqual({
      total: 1,
      open: 0,
      overdue: 0,
      completed: 1,
    })

    expect(result.value.coachActivities.stateAsOf).toEqual({
      total: 1,
      planned: 0,
      completed: 1,
      cancelled: 0,
    })
  })

  test("respects explicit asOf for future completions", async () => {
    const repos = repositories()
    const workflow = workflowFrom(repos)

    const result = await workflow.getCandidateTimeAnalytics(
      "candidate-1",
      period,
      "2026-09-20T00:00:00.000Z",
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.followUps.stateAsOf).toEqual({
      total: 1,
      open: 0,
      overdue: 1,
      completed: 0,
    })

    expect(result.value.coachActivities.stateAsOf).toEqual({
      total: 1,
      planned: 1,
      completed: 0,
      cancelled: 0,
    })
  })

  test("fails when candidate does not exist", async () => {
    const repos = repositories()
    const workflow = workflowFrom(repos)

    const result = await workflow.getCandidateTimeAnalytics(
      "missing-candidate",
      period,
      asOf,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.kind).toBe("candidate_repository")
  })

  test("fails closed for cross-candidate application association", async () => {
    const repos = repositories()

    repos.associations.listByCandidateId = async () => ({
      ok: true,
      value: [
        {
          candidateId: "candidate-2",
          applicationId: "application-1",
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    })

    const workflow = workflowFrom(repos)

    const result = await workflow.getCandidateTimeAnalytics(
      "candidate-1",
      period,
      asOf,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.kind).toBe("application_candidate_mismatch")
  })

  test("fails closed for orphaned candidate application", async () => {
    const repos = repositories()

    repos.applications.getById = async () => ({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "Application not found.",
      },
    })

    const workflow = workflowFrom(repos)

    const result = await workflow.getCandidateTimeAnalytics(
      "candidate-1",
      period,
      asOf,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.kind).toBe("orphaned_application_reference")
  })

  test("fails closed for follow-up belonging to another candidate", async () => {
    const repos = repositories()

    repos.followUps.listByCandidateId = async () => ({
      ok: true,
      value: [
        {
          id: "follow-up-cross-candidate",
          candidateId: "candidate-2",
          dueAt: "2026-09-10T00:00:00.000Z",
          createdAt: "2026-09-02T00:00:00.000Z",
          updatedAt: "2026-09-02T00:00:00.000Z",
        },
      ],
    })

    const workflow = workflowFrom(repos)

    const result = await workflow.getCandidateTimeAnalytics(
      "candidate-1",
      period,
      asOf,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.kind).toBe("follow_up_candidate_mismatch")
  })

  test("fails closed for follow-up application owned by another candidate", async () => {
    const repos = repositories()

    repos.associations.getByApplicationId = async () => ({
      ok: true,
      value: {
        candidateId: "candidate-2",
        applicationId: "application-1",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    })

    const workflow = workflowFrom(repos)

    const result = await workflow.getCandidateTimeAnalytics(
      "candidate-1",
      period,
      asOf,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.kind).toBe("follow_up_application_mismatch")
  })

  test("fails closed for activity belonging to another candidate", async () => {
    const repos = repositories()

    repos.operations.listActivitiesByCandidateId = async () => ({
      ok: true,
      value: [
        {
          id: "activity-cross-candidate",
          candidateId: "candidate-2",
          kind: "coachingMeeting",
          status: "planned",
          createdAt: "2026-09-03T00:00:00.000Z",
          updatedAt: "2026-09-03T00:00:00.000Z",
        },
      ],
    })

    const workflow = workflowFrom(repos)

    const result = await workflow.getCandidateTimeAnalytics(
      "candidate-1",
      period,
      asOf,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.kind).toBe("activity_candidate_mismatch")
  })

  test("fails closed for activity application owned by another candidate", async () => {
    const repos = repositories()

    repos.followUps.listByCandidateId = async () => ({
      ok: true,
      value: [],
    })

    repos.associations.getByApplicationId = async () => ({
      ok: true,
      value: {
        candidateId: "candidate-2",
        applicationId: "application-1",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    })

    const workflow = workflowFrom(repos)

    const result = await workflow.getCandidateTimeAnalytics(
      "candidate-1",
      period,
      asOf,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.kind).toBe("activity_application_mismatch")
  })

  test("preserves association repository failures", async () => {
    const repos = repositories()

    repos.associations.listByCandidateId = async () => ({
      ok: false,
      error: {
        code: "READ_FAILURE",
        message: "Unable to read associations.",
      },
    })

    const workflow = workflowFrom(repos)

    const result = await workflow.getCandidateTimeAnalytics(
      "candidate-1",
      period,
      asOf,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.kind).toBe("association_repository")
  })

  test("preserves follow-up repository failures", async () => {
    const repos = repositories()

    repos.followUps.listByCandidateId = async () => ({
      ok: false,
      error: {
        code: "READ_FAILURE",
        message: "Unable to read follow-ups.",
      },
    })

    const workflow = workflowFrom(repos)

    const result = await workflow.getCandidateTimeAnalytics(
      "candidate-1",
      period,
      asOf,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.kind).toBe("follow_up_repository")
  })

  test("preserves operations repository failures", async () => {
    const repos = repositories()

    repos.operations.listActivitiesByCandidateId = async () => ({
      ok: false,
      error: {
        code: "READ_FAILURE",
        message: "Unable to read activities.",
      },
    })

    const workflow = workflowFrom(repos)

    const result = await workflow.getCandidateTimeAnalytics(
      "candidate-1",
      period,
      asOf,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.kind).toBe("operations_repository")
  })

  test("propagates invalid periods as analytics domain errors", async () => {
    const repos = repositories()
    const workflow = workflowFrom(repos)

    const result = await workflow.getCandidateTimeAnalytics(
      "candidate-1",
      {
        startAt: "2026-10-01T00:00:00.000Z",
        endAt: "2026-09-01T00:00:00.000Z",
      },
      asOf,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.kind).toBe("analytics_domain")

    if (result.error.kind === "analytics_domain") {
      expect(result.error.error.code).toBe("INVALID_PERIOD")
    }
  })

  test("propagates invalid asOf as analytics domain error", async () => {
    const repos = repositories()
    const workflow = workflowFrom(repos)

    const result = await workflow.getCandidateTimeAnalytics(
      "candidate-1",
      period,
      "invalid-as-of",
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.kind).toBe("analytics_domain")

    if (result.error.kind === "analytics_domain") {
      expect(result.error.error.code).toBe("INVALID_TIMESTAMP")
    }
  })
})
