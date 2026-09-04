import type {
  ApplicationRepository,
  ApplicationRepositoryError,
} from "./application-repository"
import type { ApplicationRecord } from "./applications"
import type {
  CandidateApplicationAssociationRepository,
  CandidateApplicationAssociationRepositoryError,
} from "./coach-application-association-repository"
import type { CoachCandidate } from "./coach-workspace"
import type {
  CoachWorkspaceRepository,
  CoachWorkspaceRepositoryError,
} from "./coach-workspace-repository"
import {
  createCandidateOutcomeAnalytics,
  type CandidateOutcomeAnalytics,
  type CandidateOutcomeAnalyticsError,
} from "./candidate-outcome-analytics"

export type CandidateOutcomeAnalyticsWorkflowError =
  | { kind: "analytics_domain"; error: CandidateOutcomeAnalyticsError }
  | { kind: "candidate_repository"; error: CoachWorkspaceRepositoryError }
  | { kind: "association_repository"; error: CandidateApplicationAssociationRepositoryError }
  | { kind: "application_repository"; error: ApplicationRepositoryError }
  | { kind: "orphaned_application_reference"; applicationId: string; candidateId: string }
  | { kind: "application_candidate_mismatch"; applicationId: string; candidateId: string }

export type CandidateOutcomeAnalyticsWorkflowResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CandidateOutcomeAnalyticsWorkflowError }

export interface CandidateOutcomeAnalyticsWorkflow {
  getCandidateOutcomeAnalytics(
    candidateId: string,
    period: { startAt: string; endAt: string },
  ): Promise<CandidateOutcomeAnalyticsWorkflowResult<CandidateOutcomeAnalytics>>
}

function candidateFailure(
  error: CoachWorkspaceRepositoryError,
): CandidateOutcomeAnalyticsWorkflowResult<never> {
  return {
    ok: false,
    error: {
      kind: "candidate_repository",
      error,
    },
  }
}

function isNotFound(code: string): boolean {
  return code === "NOT_FOUND"
}

export function createCandidateOutcomeAnalyticsWorkflow(
  candidates: CoachWorkspaceRepository,
  applications: ApplicationRepository,
  associations: CandidateApplicationAssociationRepository,
): CandidateOutcomeAnalyticsWorkflow {
  async function loadCandidate(
    candidateId: string,
  ): Promise<CandidateOutcomeAnalyticsWorkflowResult<CoachCandidate>> {
    const result = await candidates.getCandidateById(candidateId)

    return result.ok
      ? { ok: true, value: result.value }
      : candidateFailure(result.error)
  }

  async function loadApplications(
    candidateId: string,
  ): Promise<CandidateOutcomeAnalyticsWorkflowResult<ApplicationRecord[]>> {
    const listed = await associations.listByCandidateId(candidateId)

    if (!listed.ok) {
      return {
        ok: false,
        error: {
          kind: "association_repository",
          error: listed.error,
        },
      }
    }

    const records: ApplicationRecord[] = []

    for (const association of listed.value) {
      if (association.candidateId !== candidateId) {
        return {
          ok: false,
          error: {
            kind: "application_candidate_mismatch",
            applicationId: association.applicationId,
            candidateId,
          },
        }
      }

      const application = await applications.getById(association.applicationId)

      if (!application.ok) {
        if (isNotFound(application.error.code)) {
          return {
            ok: false,
            error: {
              kind: "orphaned_application_reference",
              applicationId: association.applicationId,
              candidateId,
            },
          }
        }

        return {
          ok: false,
          error: {
            kind: "application_repository",
            error: application.error,
          },
        }
      }

      records.push(application.value)
    }

    return {
      ok: true,
      value: records,
    }
  }

  return {
    async getCandidateOutcomeAnalytics(candidateId, period) {
      const candidate = await loadCandidate(candidateId)
      if (!candidate.ok) return candidate

      const loadedApplications = await loadApplications(candidate.value.id)
      if (!loadedApplications.ok) return loadedApplications

      const analytics = createCandidateOutcomeAnalytics({
        candidateId: candidate.value.id,
        period,
        applications: loadedApplications.value,
      })

      return analytics.ok
        ? analytics
        : {
            ok: false,
            error: {
              kind: "analytics_domain",
              error: analytics.error,
            },
          }
    },
  }
}
