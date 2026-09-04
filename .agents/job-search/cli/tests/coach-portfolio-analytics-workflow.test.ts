import { describe, expect, test } from "bun:test"

import type { ApplicationRepository } from "../src/application-repository"
import type { CandidateApplicationAssociationRepository } from "../src/coach-application-association-repository"
import type { CandidateFollowUpRepository } from "../src/coach-candidate-follow-up-repository"
import type { CoachOperationsRepository } from "../src/coach-operations-repository"
import type { CoachWorkspaceRepository } from "../src/coach-workspace-repository"
import { createCoachPortfolioAnalyticsWorkflow } from "../src/coach-portfolio-analytics-workflow"

const period = {
  startAt: "2026-09-01T00:00:00.000Z",
  endAt: "2026-10-01T00:00:00.000Z",
}

const asOf = "2026-10-10T00:00:00.000Z"

function repositories() {
  const candidate1 = {
    id: "candidate-1",
    displayName: "Candidate One",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  }

  const candidate2 = {
    id: "candidate-2",
    displayName: "Candidate Two",
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
  }

  const candidates = {
    async createCandidate(value: typeof candidate1) {
      return { ok: true as const, value }
    },

    async getCandidateById(id: string) {
      if (id === candidate1.id) {
        return {
          ok: true as const,
          value: structuredClone(candidate1),
        }
      }

      if (id === candidate2.id) {
        return {
          ok: true as const,
          value: structuredClone(candidate2),
        }
      }

      return {
        ok: false as const,
        error: {
          code: "NOT_FOUND" as const,
          message: "Candidate not found.",
        },
      }
    },

    async listCandidates() {
      return {
        ok: true as const,
        value: [
          structuredClone(candidate1),
          structuredClone(candidate2),
        ],
      }
    },
  } as CoachWorkspaceRepository

  const application1 = {
    id: "application-1",
    jobSnapshot: {
      title: "IT Support",
      company: "Example One",
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
  }

  const application2 = {
    id: "application-2",
    jobSnapshot: {
      title: "Support Technician",
      company: "Example Two",
      location: "Stockholm",
      source: "test",
      sourceJobId: "job-2",
      url: "https://example.test/job-2",
    },
    analysisSnapshot: {},
    status: "offer" as const,
    statusHistory: [
      {
        status: "saved" as const,
        timestamp: "2026-09-02T00:00:00.000Z",
      },
      {
        status: "applied" as const,
        timestamp: "2026-09-04T00:00:00.000Z",
      },
      {
        status: "interview" as const,
        timestamp: "2026-09-06T00:00:00.000Z",
      },
      {
        status: "offer" as const,
        timestamp: "2026-09-09T00:00:00.000Z",
      },
    ],
    notes: [],
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
  }

  const applications = {
    async create(value: any) {
      return { ok: true as const, value }
    },

    async save(value: any) {
      return { ok: true as const, value }
    },

    async getById(id: string) {
      if (id === application1.id) {
        return {
          ok: true as const,
          value: structuredClone(application1),
        }
      }

      if (id === application2.id) {
        return {
          ok: true as const,
          value: structuredClone(application2),
        }
      }

      return {
        ok: false as const,
        error: {
          code: "NOT_FOUND" as const,
          message: "Application not found.",
        },
      }
    },

    async list() {
      return {
        ok: true as const,
        value: [
          structuredClone(application1),
          structuredClone(application2),
        ],
      }
    },
  } as unknown as ApplicationRepository

  const associations = {
    async create(value: any) {
      return { ok: true as const, value }
    },

    async getByApplicationId(applicationId: string) {
      if (applicationId === "application-1") {
        return {
          ok: true as const,
          value: {
            candidateId: "candidate-1",
            applicationId: "application-1",
            createdAt: "2026-09-01T00:00:00.000Z",
          },
        }
      }

      if (applicationId === "application-2") {
        return {
          ok: true as const,
          value: {
            candidateId: "candidate-2",
            applicationId: "application-2",
            createdAt: "2026-09-02T00:00:00.000Z",
          },
        }
      }

      return {
        ok: false as const,
        error: {
          code: "NOT_FOUND" as const,
          message: "Association not found.",
        },
      }
    },

    async listByCandidateId(candidateId: string) {
      if (candidateId === "candidate-1") {
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
      }

      if (candidateId === "candidate-2") {
        return {
          ok: true as const,
          value: [
            {
              candidateId: "candidate-2",
              applicationId: "application-2",
              createdAt: "2026-09-02T00:00:00.000Z",
            },
          ],
        }
      }

      return {
        ok: true as const,
        value: [],
      }
    },
  } as CandidateApplicationAssociationRepository

  const followUps = {
    async listByCandidateId(candidateId: string) {
      if (candidateId === "candidate-1") {
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
      }

      return {
        ok: true as const,
        value: [],
      }
    },
  } as unknown as CandidateFollowUpRepository

  const operations = {
    async listActivitiesByCandidateId(candidateId: string) {
      if (candidateId === "candidate-1") {
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
      }

      if (candidateId === "candidate-2") {
        return {
          ok: true as const,
          value: [
            {
              id: "activity-2",
              candidateId: "candidate-2",
              applicationId: "application-2",
              kind: "attendInterview" as const,
              status: "planned" as const,
              plannedAt: "2026-09-12T00:00:00.000Z",
              createdAt: "2026-09-07T00:00:00.000Z",
              updatedAt: "2026-09-07T00:00:00.000Z",
            },
          ],
        }
      }

      return {
        ok: true as const,
        value: [],
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
  return createCoachPortfolioAnalyticsWorkflow(
    repos.candidates,
    repos.applications,
    repos.associations,
    repos.followUps,
    repos.operations,
  )
}

describe("createCoachPortfolioAnalyticsWorkflow", () => {
  test("aggregates real candidate analytics across the coach portfolio", async () => {
    const repos = repositories()
    const workflow = workflowFrom(repos)

    const result = await workflow.getCoachPortfolioAnalytics(
      period,
      asOf,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.candidates).toEqual({
      total: 2,
      withApplications: 2,
      withFollowUps: 1,
      withCoachActivities: 2,
    })

    expect(result.value.applications).toMatchObject({
      total: 2,
      reachedApplied: 2,
      reachedInterview: 2,
      reachedOffer: 1,
    })

    expect(result.value.followUps.total).toBe(1)
    expect(result.value.followUps.completed).toBe(1)

    expect(result.value.coachActivities.total).toBe(2)
    expect(result.value.coachActivities.completed).toBe(1)
    expect(result.value.coachActivities.planned).toBe(1)
  })

  test("propagates explicit asOf into historical portfolio state", async () => {
    const repos = repositories()
    const workflow = workflowFrom(repos)

    const result = await workflow.getCoachPortfolioAnalytics(
      period,
      "2026-09-20T00:00:00.000Z",
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.asOf).toBe("2026-09-20T00:00:00.000Z")

    expect(result.value.followUps.stateAsOf).toEqual({
      total: 1,
      open: 0,
      overdue: 1,
      completed: 0,
    })

    expect(result.value.coachActivities.stateAsOf).toEqual({
      total: 2,
      planned: 2,
      completed: 0,
      cancelled: 0,
    })
  })

  test("returns an empty portfolio when no candidates exist", async () => {
    const repos = repositories()

    repos.candidates.listCandidates = async () => ({
      ok: true,
      value: [],
    })

    const workflow = workflowFrom(repos)

    const result = await workflow.getCoachPortfolioAnalytics(
      period,
      asOf,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.candidates.total).toBe(0)
    expect(result.value.applications.total).toBe(0)
    expect(result.value.followUps.total).toBe(0)
    expect(result.value.coachActivities.total).toBe(0)
  })

  test("fails when candidate listing fails", async () => {
    const repos = repositories()

    repos.candidates.listCandidates = async () => ({
      ok: false,
      error: {
        code: "READ_FAILURE",
        message: "Cannot list candidates.",
      },
    })

    const workflow = workflowFrom(repos)

    const result = await workflow.getCoachPortfolioAnalytics(
      period,
      asOf,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.kind).toBe("candidate_repository")
  })

  test("wraps outcome workflow failures with candidate identity", async () => {
    const repos = repositories()

    repos.associations.listByCandidateId = async (candidateId: string) => {
      if (candidateId === "candidate-1") {
        return {
          ok: false,
          error: {
            code: "READ_FAILURE",
            message: "Association read failed.",
          },
        }
      }

      return {
        ok: true,
        value: [],
      }
    }

    const workflow = workflowFrom(repos)

    const result = await workflow.getCoachPortfolioAnalytics(
      period,
      asOf,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.kind).toBe("candidate_outcome_analytics")

    if (result.error.kind === "candidate_outcome_analytics") {
      expect(result.error.candidateId).toBe("candidate-1")
    }
  })

  test("wraps activity workflow failures with candidate identity", async () => {
    const repos = repositories()

    repos.followUps.listByCandidateId = async (candidateId: string) => {
      if (candidateId === "candidate-1") {
        return {
          ok: false,
          error: {
            code: "READ_FAILURE",
            message: "Follow-up read failed.",
          },
        }
      }

      return {
        ok: true,
        value: [],
      }
    }

    const workflow = workflowFrom(repos)

    const result = await workflow.getCoachPortfolioAnalytics(
      period,
      asOf,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.kind).toBe("candidate_activity_analytics")

    if (result.error.kind === "candidate_activity_analytics") {
      expect(result.error.candidateId).toBe("candidate-1")
    }
  })

  test("wraps time workflow failures with candidate identity", async () => {
    const repos = repositories()

    let followUpCalls = 0

    repos.followUps.listByCandidateId = async (candidateId: string) => {
      followUpCalls += 1

      if (candidateId === "candidate-1" && followUpCalls >= 2) {
        return {
          ok: false,
          error: {
            code: "READ_FAILURE",
            message: "Follow-up read failed during time analytics.",
          },
        }
      }

      if (candidateId === "candidate-1") {
        return {
          ok: true,
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
      }

      return {
        ok: true,
        value: [],
      }
    }

    const workflow = workflowFrom(repos)

    const result = await workflow.getCoachPortfolioAnalytics(
      period,
      asOf,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.kind).toBe("candidate_time_analytics")

    if (result.error.kind === "candidate_time_analytics") {
      expect(result.error.candidateId).toBe("candidate-1")
    }
  })

  test("is deterministic for the same repositories and inputs", async () => {
    const firstRepos = repositories()
    const secondRepos = repositories()

    const first = await workflowFrom(firstRepos)
      .getCoachPortfolioAnalytics(period, asOf)

    const second = await workflowFrom(secondRepos)
      .getCoachPortfolioAnalytics(period, asOf)

    expect(first).toEqual(second)
  })
})
