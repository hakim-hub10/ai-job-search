import type {
  ApplicationRepository,
  ApplicationRepositoryError,
} from "./application-repository"
import type {
  CandidateApplicationAssociationRepository,
  CandidateApplicationAssociationRepositoryError,
} from "./coach-application-association-repository"
import type { CandidateFollowUp } from "./coach-candidate-follow-up"
import type {
  CandidateFollowUpRepository,
  CandidateFollowUpRepositoryError,
} from "./coach-candidate-follow-up-repository"
import type { CoachActivity } from "./coach-activity"
import type {
  CoachOperationsRepository,
  CoachOperationsRepositoryError,
} from "./coach-operations-repository"
import type { CoachCandidate } from "./coach-workspace"
import type {
  CoachWorkspaceRepository,
  CoachWorkspaceRepositoryError,
} from "./coach-workspace-repository"
import {
  createCandidateActivityAnalytics,
  type CandidateActivityAnalytics,
  type CandidateActivityAnalyticsError,
} from "./candidate-activity-analytics"

export type CandidateActivityAnalyticsWorkflowError =
  | { kind: "analytics_domain"; error: CandidateActivityAnalyticsError }
  | { kind: "candidate_repository"; error: CoachWorkspaceRepositoryError }
  | {
      kind: "association_repository"
      error: CandidateApplicationAssociationRepositoryError
    }
  | { kind: "application_repository"; error: ApplicationRepositoryError }
  | {
      kind: "follow_up_repository"
      error: CandidateFollowUpRepositoryError
    }
  | {
      kind: "operations_repository"
      error: CoachOperationsRepositoryError
    }
  | {
      kind: "orphaned_application_reference"
      applicationId: string
      candidateId: string
    }
  | {
      kind: "follow_up_candidate_mismatch"
      followUpId: string
      candidateId: string
    }
  | {
      kind: "follow_up_application_mismatch"
      followUpId: string
      applicationId: string
      candidateId: string
    }
  | {
      kind: "activity_candidate_mismatch"
      activityId: string
      candidateId: string
    }
  | {
      kind: "activity_application_mismatch"
      activityId: string
      applicationId: string
      candidateId: string
    }

export type CandidateActivityAnalyticsWorkflowResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CandidateActivityAnalyticsWorkflowError }

export interface CandidateActivityAnalyticsWorkflow {
  getCandidateActivityAnalytics(
    candidateId: string,
    period: {
      startAt: string
      endAt: string
    },
  ): Promise<
    CandidateActivityAnalyticsWorkflowResult<CandidateActivityAnalytics>
  >
}

function candidateFailure(
  error: CoachWorkspaceRepositoryError,
): CandidateActivityAnalyticsWorkflowResult<never> {
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

export function createCandidateActivityAnalyticsWorkflow(
  candidates: CoachWorkspaceRepository,
  applications: ApplicationRepository,
  associations: CandidateApplicationAssociationRepository,
  followUps: CandidateFollowUpRepository,
  operations: CoachOperationsRepository,
): CandidateActivityAnalyticsWorkflow {
  async function loadCandidate(
    candidateId: string,
  ): Promise<CandidateActivityAnalyticsWorkflowResult<CoachCandidate>> {
    const result = await candidates.getCandidateById(candidateId)

    return result.ok
      ? { ok: true, value: result.value }
      : candidateFailure(result.error)
  }

  async function validateFollowUp(
    candidateId: string,
    followUp: CandidateFollowUp,
  ): Promise<CandidateActivityAnalyticsWorkflowResult<void>> {
    if (followUp.candidateId !== candidateId) {
      return {
        ok: false,
        error: {
          kind: "follow_up_candidate_mismatch",
          followUpId: followUp.id,
          candidateId,
        },
      }
    }

    if (followUp.applicationId === undefined) {
      return { ok: true, value: undefined }
    }

    const association = await associations.getByApplicationId(
      followUp.applicationId,
    )

    if (!association.ok) {
      return isNotFound(association.error.code)
        ? {
            ok: false,
            error: {
              kind: "follow_up_application_mismatch",
              followUpId: followUp.id,
              applicationId: followUp.applicationId,
              candidateId,
            },
          }
        : {
            ok: false,
            error: {
              kind: "association_repository",
              error: association.error,
            },
          }
    }

    if (association.value.candidateId !== candidateId) {
      return {
        ok: false,
        error: {
          kind: "follow_up_application_mismatch",
          followUpId: followUp.id,
          applicationId: followUp.applicationId,
          candidateId,
        },
      }
    }

    const application = await applications.getById(followUp.applicationId)

    if (!application.ok) {
      return isNotFound(application.error.code)
        ? {
            ok: false,
            error: {
              kind: "orphaned_application_reference",
              applicationId: followUp.applicationId,
              candidateId,
            },
          }
        : {
            ok: false,
            error: {
              kind: "application_repository",
              error: application.error,
            },
          }
    }

    return { ok: true, value: undefined }
  }

  async function validateActivity(
    candidateId: string,
    activity: CoachActivity,
  ): Promise<CandidateActivityAnalyticsWorkflowResult<void>> {
    if (activity.candidateId !== candidateId) {
      return {
        ok: false,
        error: {
          kind: "activity_candidate_mismatch",
          activityId: activity.id,
          candidateId,
        },
      }
    }

    if (activity.applicationId === undefined) {
      return { ok: true, value: undefined }
    }

    const association = await associations.getByApplicationId(
      activity.applicationId,
    )

    if (!association.ok) {
      return isNotFound(association.error.code)
        ? {
            ok: false,
            error: {
              kind: "activity_application_mismatch",
              activityId: activity.id,
              applicationId: activity.applicationId,
              candidateId,
            },
          }
        : {
            ok: false,
            error: {
              kind: "association_repository",
              error: association.error,
            },
          }
    }

    if (association.value.candidateId !== candidateId) {
      return {
        ok: false,
        error: {
          kind: "activity_application_mismatch",
          activityId: activity.id,
          applicationId: activity.applicationId,
          candidateId,
        },
      }
    }

    const application = await applications.getById(activity.applicationId)

    if (!application.ok) {
      return isNotFound(application.error.code)
        ? {
            ok: false,
            error: {
              kind: "orphaned_application_reference",
              applicationId: activity.applicationId,
              candidateId,
            },
          }
        : {
            ok: false,
            error: {
              kind: "application_repository",
              error: application.error,
            },
          }
    }

    return { ok: true, value: undefined }
  }

  return {
    async getCandidateActivityAnalytics(candidateId, period) {
      const candidate = await loadCandidate(candidateId)
      if (!candidate.ok) return candidate

      const loadedFollowUps = await followUps.listByCandidateId(
        candidate.value.id,
      )

      if (!loadedFollowUps.ok) {
        return {
          ok: false,
          error: {
            kind: "follow_up_repository",
            error: loadedFollowUps.error,
          },
        }
      }

      for (const followUp of loadedFollowUps.value) {
        const checked = await validateFollowUp(
          candidate.value.id,
          followUp,
        )
        if (!checked.ok) return checked
      }

      const loadedActivities = await operations.listActivitiesByCandidateId(
        candidate.value.id,
      )

      if (!loadedActivities.ok) {
        return {
          ok: false,
          error: {
            kind: "operations_repository",
            error: loadedActivities.error,
          },
        }
      }

      for (const activity of loadedActivities.value) {
        const checked = await validateActivity(
          candidate.value.id,
          activity,
        )
        if (!checked.ok) return checked
      }

      const analytics = createCandidateActivityAnalytics({
        candidateId: candidate.value.id,
        period,
        followUps: loadedFollowUps.value,
        activities: loadedActivities.value,
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
