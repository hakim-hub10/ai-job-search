import type {
  ApplicationRepository,
  ApplicationRepositoryError,
} from "./application-repository"
import type { ApplicationRecord } from "./applications"
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
  createCandidateTimeAnalytics,
  type CandidateTimeAnalytics,
  type CandidateTimeAnalyticsError,
} from "./candidate-time-analytics"

export type CandidateTimeAnalyticsWorkflowError =
  | { kind: "analytics_domain"; error: CandidateTimeAnalyticsError }
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
      kind: "application_candidate_mismatch"
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

export type CandidateTimeAnalyticsWorkflowResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CandidateTimeAnalyticsWorkflowError }

export interface CandidateTimeAnalyticsWorkflow {
  getCandidateTimeAnalytics(
    candidateId: string,
    period: {
      startAt: string
      endAt: string
    },
    asOf: string,
  ): Promise<CandidateTimeAnalyticsWorkflowResult<CandidateTimeAnalytics>>
}

function candidateFailure(
  error: CoachWorkspaceRepositoryError,
): CandidateTimeAnalyticsWorkflowResult<never> {
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

export function createCandidateTimeAnalyticsWorkflow(
  candidates: CoachWorkspaceRepository,
  applications: ApplicationRepository,
  associations: CandidateApplicationAssociationRepository,
  followUps: CandidateFollowUpRepository,
  operations: CoachOperationsRepository,
): CandidateTimeAnalyticsWorkflow {
  async function loadCandidate(
    candidateId: string,
  ): Promise<CandidateTimeAnalyticsWorkflowResult<CoachCandidate>> {
    const result = await candidates.getCandidateById(candidateId)

    return result.ok
      ? { ok: true, value: result.value }
      : candidateFailure(result.error)
  }

  async function loadApplications(
    candidateId: string,
  ): Promise<CandidateTimeAnalyticsWorkflowResult<ApplicationRecord[]>> {
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

      const application = await applications.getById(
        association.applicationId,
      )

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

  async function validateFollowUp(
    candidateId: string,
    followUp: CandidateFollowUp,
  ): Promise<CandidateTimeAnalyticsWorkflowResult<void>> {
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

    const application = await applications.getById(
      followUp.applicationId,
    )

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
  ): Promise<CandidateTimeAnalyticsWorkflowResult<void>> {
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

    const application = await applications.getById(
      activity.applicationId,
    )

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
    async getCandidateTimeAnalytics(candidateId, period, asOf) {
      const candidate = await loadCandidate(candidateId)
      if (!candidate.ok) return candidate

      const loadedApplications = await loadApplications(
        candidate.value.id,
      )
      if (!loadedApplications.ok) return loadedApplications

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

      const loadedActivities =
        await operations.listActivitiesByCandidateId(
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

      const analytics = createCandidateTimeAnalytics({
        candidateId: candidate.value.id,
        period,
        asOf,
        applications: loadedApplications.value,
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
