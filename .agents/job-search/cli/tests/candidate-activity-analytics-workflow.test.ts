import { describe, expect, test } from "bun:test"
import type { ApplicationRepository } from "../src/application-repository"
import type { CandidateApplicationAssociationRepository } from "../src/coach-application-association-repository"
import type { CandidateFollowUpRepository } from "../src/coach-candidate-follow-up-repository"
import type { CoachOperationsRepository } from "../src/coach-operations-repository"
import type { CoachWorkspaceRepository } from "../src/coach-workspace-repository"
import { createCandidateActivityAnalyticsWorkflow } from "../src/candidate-activity-analytics-workflow"

const period = {
  startAt: "2026-09-01T00:00:00.000Z",
  endAt: "2026-10-01T00:00:00.000Z",
}

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
          status: "saved" as const,
          statusHistory: [
            {
              status: "saved" as const,
              timestamp: "2026-09-01T00:00:00.000Z",
            },
          ],
          notes: [],
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
      }
    },
  } as ApplicationRepository

  const associations = {
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

describe("createCandidateActivityAnalyticsWorkflow", () => {
  test("loads candidate-owned activity data and derives eventual outcomes", async () => {
    const repos = repositories()

    const workflow = createCandidateActivityAnalyticsWorkflow(
      repos.candidates,
      repos.applications,
      repos.associations,
      repos.followUps,
      repos.operations,
    )

    const result = await workflow.getCandidateActivityAnalytics(
      "candidate-1",
      period,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.candidateId).toBe("candidate-1")

    expect(result.value.followUps).toEqual({
      total: 1,
      completed: 1,
      incomplete: 0,
      completion: {
        numerator: 1,
        denominator: 1,
        rate: 1,
      },
    })

    expect(result.value.coachActivities.total).toBe(1)
    expect(result.value.coachActivities.completed).toBe(1)
    expect(result.value.coachActivities.completion.rate).toBe(1)
  })

  test("fails when candidate does not exist", async () => {
    const repos = repositories()

    const workflow = createCandidateActivityAnalyticsWorkflow(
      repos.candidates,
      repos.applications,
      repos.associations,
      repos.followUps,
      repos.operations,
    )

    const result = await workflow.getCandidateActivityAnalytics(
      "missing-candidate",
      period,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.kind).toBe("candidate_repository")
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

    const workflow = createCandidateActivityAnalyticsWorkflow(
      repos.candidates,
      repos.applications,
      repos.associations,
      repos.followUps,
      repos.operations,
    )

    const result = await workflow.getCandidateActivityAnalytics(
      "candidate-1",
      period,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.kind).toBe("follow_up_candidate_mismatch")
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

    const workflow = createCandidateActivityAnalyticsWorkflow(
      repos.candidates,
      repos.applications,
      repos.associations,
      repos.followUps,
      repos.operations,
    )

    const result = await workflow.getCandidateActivityAnalytics(
      "candidate-1",
      period,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.kind).toBe("activity_candidate_mismatch")
  })

  test("fails closed for cross-candidate application association", async () => {
    const repos = repositories()

    repos.associations.getByApplicationId = async () => ({
      ok: true,
      value: {
        candidateId: "candidate-2",
        applicationId: "application-1",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    })

    const workflow = createCandidateActivityAnalyticsWorkflow(
      repos.candidates,
      repos.applications,
      repos.associations,
      repos.followUps,
      repos.operations,
    )

    const result = await workflow.getCandidateActivityAnalytics(
      "candidate-1",
      period,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.kind).toBe("follow_up_application_mismatch")
  })

  test("fails closed for orphaned application reference", async () => {
    const repos = repositories()

    repos.applications.getById = async () => ({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "Application not found.",
      },
    })

    const workflow = createCandidateActivityAnalyticsWorkflow(
      repos.candidates,
      repos.applications,
      repos.associations,
      repos.followUps,
      repos.operations,
    )

    const result = await workflow.getCandidateActivityAnalytics(
      "candidate-1",
      period,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.kind).toBe("orphaned_application_reference")
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

    const workflow = createCandidateActivityAnalyticsWorkflow(
      repos.candidates,
      repos.applications,
      repos.associations,
      repos.followUps,
      repos.operations,
    )

    const result = await workflow.getCandidateActivityAnalytics(
      "candidate-1",
      period,
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

    const workflow = createCandidateActivityAnalyticsWorkflow(
      repos.candidates,
      repos.applications,
      repos.associations,
      repos.followUps,
      repos.operations,
    )

    const result = await workflow.getCandidateActivityAnalytics(
      "candidate-1",
      period,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.kind).toBe("operations_repository")
  })

  test("propagates invalid periods as analytics domain errors", async () => {
    const repos = repositories()

    const workflow = createCandidateActivityAnalyticsWorkflow(
      repos.candidates,
      repos.applications,
      repos.associations,
      repos.followUps,
      repos.operations,
    )

    const result = await workflow.getCandidateActivityAnalytics(
      "candidate-1",
      {
        startAt: "2026-10-01T00:00:00.000Z",
        endAt: "2026-09-01T00:00:00.000Z",
      },
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.kind).toBe("analytics_domain")

    if (result.error.kind === "analytics_domain") {
      expect(result.error.error.code).toBe("INVALID_PERIOD")
    }
  })
})
