import type { ApplicationRepository } from "./application-repository"
import type { CandidateApplicationAssociationRepository } from "./coach-application-association-repository"
import type { CandidateFollowUpRepository } from "./coach-candidate-follow-up-repository"
import type { CoachOperationsRepository } from "./coach-operations-repository"
import type {
  CoachWorkspaceRepository,
  CoachWorkspaceRepositoryError,
} from "./coach-workspace-repository"

import {
  createCandidateOutcomeAnalyticsWorkflow,
  type CandidateOutcomeAnalyticsWorkflowError,
} from "./candidate-outcome-analytics-workflow"

import {
  createCandidateActivityAnalyticsWorkflow,
  type CandidateActivityAnalyticsWorkflowError,
} from "./candidate-activity-analytics-workflow"

import {
  createCandidateTimeAnalyticsWorkflow,
  type CandidateTimeAnalyticsWorkflowError,
} from "./candidate-time-analytics-workflow"

import {
  createCoachPortfolioAnalytics,
  type CoachPortfolioAnalytics,
  type CoachPortfolioAnalyticsError,
} from "./coach-portfolio-analytics"

import type { CandidateOutcomeAnalytics } from "./candidate-outcome-analytics"
import type { CandidateActivityAnalytics } from "./candidate-activity-analytics"
import type { CandidateTimeAnalytics } from "./candidate-time-analytics"

export type CoachPortfolioAnalyticsWorkflowError =
  | {
      kind: "candidate_repository"
      error: CoachWorkspaceRepositoryError
    }
  | {
      kind: "candidate_outcome_analytics"
      candidateId: string
      error: CandidateOutcomeAnalyticsWorkflowError
    }
  | {
      kind: "candidate_activity_analytics"
      candidateId: string
      error: CandidateActivityAnalyticsWorkflowError
    }
  | {
      kind: "candidate_time_analytics"
      candidateId: string
      error: CandidateTimeAnalyticsWorkflowError
    }
  | {
      kind: "portfolio_analytics"
      error: CoachPortfolioAnalyticsError
    }

export type CoachPortfolioAnalyticsWorkflowResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CoachPortfolioAnalyticsWorkflowError }

export interface CoachPortfolioAnalyticsWorkflow {
  getCoachPortfolioAnalytics(
    period: {
      startAt: string
      endAt: string
    },
    asOf: string,
  ): Promise<
    CoachPortfolioAnalyticsWorkflowResult<CoachPortfolioAnalytics>
  >
}

export function createCoachPortfolioAnalyticsWorkflow(
  candidates: CoachWorkspaceRepository,
  applications: ApplicationRepository,
  associations: CandidateApplicationAssociationRepository,
  followUps: CandidateFollowUpRepository,
  operations: CoachOperationsRepository,
): CoachPortfolioAnalyticsWorkflow {
  const outcomeWorkflow =
    createCandidateOutcomeAnalyticsWorkflow(
      candidates,
      applications,
      associations,
    )

  const activityWorkflow =
    createCandidateActivityAnalyticsWorkflow(
      candidates,
      applications,
      associations,
      followUps,
      operations,
    )

  const timeWorkflow =
    createCandidateTimeAnalyticsWorkflow(
      candidates,
      applications,
      associations,
      followUps,
      operations,
    )

  async function getCoachPortfolioAnalytics(
    period: {
      startAt: string
      endAt: string
    },
    asOf: string,
  ): Promise<
    CoachPortfolioAnalyticsWorkflowResult<CoachPortfolioAnalytics>
  > {
    const listedCandidates = await candidates.listCandidates()

    if (!listedCandidates.ok) {
      return {
        ok: false,
        error: {
          kind: "candidate_repository",
          error: listedCandidates.error,
        },
      }
    }

    const outcomes: CandidateOutcomeAnalytics[] = []
    const activities: CandidateActivityAnalytics[] = []
    const times: CandidateTimeAnalytics[] = []

    for (const candidate of listedCandidates.value) {
      const outcome =
        await outcomeWorkflow.getCandidateOutcomeAnalytics(
          candidate.id,
          period,
        )

      if (!outcome.ok) {
        return {
          ok: false,
          error: {
            kind: "candidate_outcome_analytics",
            candidateId: candidate.id,
            error: outcome.error,
          },
        }
      }

      const activity =
        await activityWorkflow.getCandidateActivityAnalytics(
          candidate.id,
          period,
        )

      if (!activity.ok) {
        return {
          ok: false,
          error: {
            kind: "candidate_activity_analytics",
            candidateId: candidate.id,
            error: activity.error,
          },
        }
      }

      const time =
        await timeWorkflow.getCandidateTimeAnalytics(
          candidate.id,
          period,
          asOf,
        )

      if (!time.ok) {
        return {
          ok: false,
          error: {
            kind: "candidate_time_analytics",
            candidateId: candidate.id,
            error: time.error,
          },
        }
      }

      outcomes.push(outcome.value)
      activities.push(activity.value)
      times.push(time.value)
    }

    const portfolio = createCoachPortfolioAnalytics({
      period,
      asOf,
      outcomes,
      activities,
      times,
    })

    if (!portfolio.ok) {
      return {
        ok: false,
        error: {
          kind: "portfolio_analytics",
          error: portfolio.error,
        },
      }
    }

    return {
      ok: true,
      value: portfolio.value,
    }
  }

  return {
    getCoachPortfolioAnalytics,
  }
}
