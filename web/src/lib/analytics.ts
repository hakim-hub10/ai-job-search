import { resolve } from "node:path";

import { createFileApplicationRepository } from "../../../.agents/job-search/cli/src/application-file-repository";
import { createCandidateActivityAnalyticsWorkflow } from "../../../.agents/job-search/cli/src/candidate-activity-analytics-workflow";
import { createCandidateOutcomeAnalyticsWorkflow } from "../../../.agents/job-search/cli/src/candidate-outcome-analytics-workflow";
import { createCandidateTimeAnalyticsWorkflow } from "../../../.agents/job-search/cli/src/candidate-time-analytics-workflow";
import { createFileCandidateApplicationAssociationRepository } from "../../../.agents/job-search/cli/src/coach-application-association-file-repository";
import { resolveCoachRepositoryPaths } from "../../../.agents/job-search/cli/src/coach-cli-paths";
import { createFileCandidateFollowUpRepository } from "../../../.agents/job-search/cli/src/coach-candidate-follow-up-file-repository";
import { createFileCoachOperationsRepository } from "../../../.agents/job-search/cli/src/coach-operations-file-repository";
import { createCoachPortfolioAnalyticsWorkflow } from "../../../.agents/job-search/cli/src/coach-portfolio-analytics-workflow";
import { createFileCoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-file-repository";

function repositories() {
  const coachDir = process.env.COACH_DIR;
  const applicationRepositoryPath = process.env.APPLICATION_REPOSITORY;

  if (!coachDir || !applicationRepositoryPath) {
    return null;
  }

  const paths = resolveCoachRepositoryPaths(resolve(coachDir));

  return {
    candidates: createFileCoachWorkspaceRepository(paths.candidates),
    applications: createFileApplicationRepository(
      resolve(applicationRepositoryPath),
    ),
    associations:
      createFileCandidateApplicationAssociationRepository(paths.associations),
    followUps: createFileCandidateFollowUpRepository(paths.followUps),
    operations: createFileCoachOperationsRepository(paths.operations),
  };
}

export async function loadCandidateAnalytics(
  candidateId: string,
  startAt: string,
  endAt: string,
  asOf: string,
) {
  const repos = repositories();

  if (!repos) {
    return {
      configured: false as const,
      outcome: null,
      activity: null,
      time: null,
      error: null,
    };
  }

  const period = {
    startAt,
    endAt,
  };

  const outcomeWorkflow = createCandidateOutcomeAnalyticsWorkflow(
    repos.candidates,
    repos.applications,
    repos.associations,
  );

  const activityWorkflow = createCandidateActivityAnalyticsWorkflow(
    repos.candidates,
    repos.applications,
    repos.associations,
    repos.followUps,
    repos.operations,
  );

  const timeWorkflow = createCandidateTimeAnalyticsWorkflow(
    repos.candidates,
    repos.applications,
    repos.associations,
    repos.followUps,
    repos.operations,
  );

  const outcome = await outcomeWorkflow.getCandidateOutcomeAnalytics(
    candidateId,
    period,
  );

  if (!outcome.ok) {
    return {
      configured: true as const,
      outcome: null,
      activity: null,
      time: null,
      error: outcome.error,
    };
  }

  const activity = await activityWorkflow.getCandidateActivityAnalytics(
    candidateId,
    period,
  );

  if (!activity.ok) {
    return {
      configured: true as const,
      outcome: null,
      activity: null,
      time: null,
      error: activity.error,
    };
  }

  const time = await timeWorkflow.getCandidateTimeAnalytics(
    candidateId,
    period,
    asOf,
  );

  if (!time.ok) {
    return {
      configured: true as const,
      outcome: null,
      activity: null,
      time: null,
      error: time.error,
    };
  }

  return {
    configured: true as const,
    outcome: outcome.value,
    activity: activity.value,
    time: time.value,
    error: null,
  };
}

export async function loadCoachPortfolioAnalytics(
  startAt: string,
  endAt: string,
  asOf: string,
) {
  const repos = repositories();

  if (!repos) {
    return {
      configured: false as const,
      analytics: null,
      error: null,
    };
  }

  const workflow = createCoachPortfolioAnalyticsWorkflow(
    repos.candidates,
    repos.applications,
    repos.associations,
    repos.followUps,
    repos.operations,
  );

  const result = await workflow.getCoachPortfolioAnalytics(
    {
      startAt,
      endAt,
    },
    asOf,
  );

  if (!result.ok) {
    return {
      configured: true as const,
      analytics: null,
      error: result.error,
    };
  }

  return {
    configured: true as const,
    analytics: result.value,
    error: null,
  };
}
