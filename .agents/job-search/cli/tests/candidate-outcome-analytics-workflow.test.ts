import { describe, expect, it } from "bun:test"
import type { ApplicationRepository } from "../src/application-repository"
import type { ApplicationRecord } from "../src/applications"
import type { CandidateApplicationAssociation } from "../src/coach-application-association"
import type { CandidateApplicationAssociationRepository } from "../src/coach-application-association-repository"
import { createCoachCandidate } from "../src/coach-workspace"
import type { CoachWorkspaceRepository } from "../src/coach-workspace-repository"
import { createCandidateOutcomeAnalyticsWorkflow } from "../src/candidate-outcome-analytics-workflow"

const candidate = createCoachCandidate({
  id: "candidate-a",
  displayName: "Alex",
  createdAt: "2026-01-01T00:00:00.000Z",
})

if (!candidate.ok) throw new Error(candidate.error.message)

const application = {
  id: "application-1",
  status: "rejected",
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
  statusHistory: [
    {
      status: "saved",
      timestamp: "2026-01-02T00:00:00.000Z",
    },
    {
      status: "applied",
      timestamp: "2026-01-05T00:00:00.000Z",
    },
    {
      status: "interview",
      timestamp: "2026-01-20T00:00:00.000Z",
    },
    {
      status: "rejected",
      timestamp: "2026-02-01T00:00:00.000Z",
    },
  ],
} as unknown as ApplicationRecord

const association: CandidateApplicationAssociation = {
  candidateId: "candidate-a",
  applicationId: "application-1",
  createdAt: "2026-01-02T00:00:00.000Z",
}

const candidates: CoachWorkspaceRepository = {
  async createCandidate(value) {
    return { ok: true, value }
  },

  async getCandidateById(id) {
    return id === candidate.value.id
      ? { ok: true, value: structuredClone(candidate.value) }
      : {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message: "missing",
          },
        }
  },

  async listCandidates() {
    return {
      ok: true,
      value: [structuredClone(candidate.value)],
    }
  },
}

const applications: ApplicationRepository = {
  async create(value) {
    return { ok: true, value }
  },

  async save(value) {
    return { ok: true, value }
  },

  async getById(id) {
    return id === application.id
      ? { ok: true, value: structuredClone(application) }
      : {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message: "missing",
          },
        }
  },

  async list() {
    return {
      ok: true,
      value: [structuredClone(application)],
    }
  },
}

const associations: CandidateApplicationAssociationRepository = {
  async create(value) {
    return { ok: true, value }
  },

  async getByApplicationId(id) {
    return id === association.applicationId
      ? { ok: true, value: structuredClone(association) }
      : {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message: "missing",
          },
        }
  },

  async listByCandidateId(id) {
    return id === association.candidateId
      ? {
          ok: true,
          value: [structuredClone(association)],
        }
      : {
          ok: true,
          value: [],
        }
  },
}

describe("Phase 9.1 candidate outcome analytics workflow", () => {
  it("loads only candidate-owned applications and derives eventual factual outcomes", async () => {
    const workflow = createCandidateOutcomeAnalyticsWorkflow(
      candidates,
      applications,
      associations,
    )

    const result = await workflow.getCandidateOutcomeAnalytics(
      "candidate-a",
      {
        startAt: "2026-01-01T00:00:00.000Z",
        endAt: "2026-02-01T00:00:00.000Z",
      },
    )

    expect(result).toMatchObject({
      ok: true,
      value: {
        candidateId: "candidate-a",
        applications: {
          total: 1,
          reachedApplied: 1,
          reachedInterview: 1,
          reachedOffer: 0,
          rejected: 1,
        },
        funnel: {
          applicationToApplied: {
            numerator: 1,
            denominator: 1,
            rate: 1,
          },
          appliedToInterview: {
            numerator: 1,
            denominator: 1,
            rate: 1,
          },
          interviewToOffer: {
            numerator: 0,
            denominator: 1,
            rate: 0,
          },
        },
      },
    })
  })

  it("fails when the candidate does not exist", async () => {
    const workflow = createCandidateOutcomeAnalyticsWorkflow(
      candidates,
      applications,
      associations,
    )

    const result = await workflow.getCandidateOutcomeAnalytics(
      "missing",
      {
        startAt: "2026-01-01T00:00:00.000Z",
        endAt: "2026-02-01T00:00:00.000Z",
      },
    )

    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: "candidate_repository",
        error: {
          code: "NOT_FOUND",
        },
      },
    })
  })

  it("fails closed for orphaned application references", async () => {
    const missingApplications: ApplicationRepository = {
      ...applications,
      async getById() {
        return {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message: "missing",
          },
        }
      },
    }

    const workflow = createCandidateOutcomeAnalyticsWorkflow(
      candidates,
      missingApplications,
      associations,
    )

    const result = await workflow.getCandidateOutcomeAnalytics(
      "candidate-a",
      {
        startAt: "2026-01-01T00:00:00.000Z",
        endAt: "2026-02-01T00:00:00.000Z",
      },
    )

    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: "orphaned_application_reference",
        applicationId: "application-1",
        candidateId: "candidate-a",
      },
    })
  })

  it("fails closed for cross-candidate associations", async () => {
    const crossCandidateAssociations: CandidateApplicationAssociationRepository = {
      ...associations,

      async listByCandidateId() {
        return {
          ok: true,
          value: [
            {
              ...association,
              candidateId: "candidate-b",
            },
          ],
        }
      },
    }

    const workflow = createCandidateOutcomeAnalyticsWorkflow(
      candidates,
      applications,
      crossCandidateAssociations,
    )

    const result = await workflow.getCandidateOutcomeAnalytics(
      "candidate-a",
      {
        startAt: "2026-01-01T00:00:00.000Z",
        endAt: "2026-02-01T00:00:00.000Z",
      },
    )

    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: "application_candidate_mismatch",
        applicationId: "application-1",
        candidateId: "candidate-a",
      },
    })
  })

  it("preserves association repository failures", async () => {
    const corruptAssociations: CandidateApplicationAssociationRepository = {
      ...associations,

      async listByCandidateId() {
        return {
          ok: false,
          error: {
            code: "CORRUPT_STORAGE",
            message: "corrupt",
          },
        }
      },
    }

    const workflow = createCandidateOutcomeAnalyticsWorkflow(
      candidates,
      applications,
      corruptAssociations,
    )

    const result = await workflow.getCandidateOutcomeAnalytics(
      "candidate-a",
      {
        startAt: "2026-01-01T00:00:00.000Z",
        endAt: "2026-02-01T00:00:00.000Z",
      },
    )

    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: "association_repository",
        error: {
          code: "CORRUPT_STORAGE",
        },
      },
    })
  })

  it("propagates invalid analytics periods as domain errors", async () => {
    const workflow = createCandidateOutcomeAnalyticsWorkflow(
      candidates,
      applications,
      associations,
    )

    const result = await workflow.getCandidateOutcomeAnalytics(
      "candidate-a",
      {
        startAt: "2026-02-01T00:00:00.000Z",
        endAt: "2026-01-01T00:00:00.000Z",
      },
    )

    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: "analytics_domain",
        error: {
          code: "INVALID_PERIOD",
        },
      },
    })
  })
})
