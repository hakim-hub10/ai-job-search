import "server-only";
import { resolve } from "node:path";

import { createFileApplicationRepository } from "../../../.agents/job-search/cli/src/application-file-repository";
import type { ApplicationRecord } from "../../../.agents/job-search/cli/src/applications";
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

export interface JobSearchDistributionItem {
  label: string;
  count: number;
}

export interface JobSearchAnalyticsReadModel {
  availability: "available";
  basis: "APPLICATION_RECORDS";
  totalJobsRepresented: number;
  sourceDistribution: JobSearchDistributionItem[];
  locationDistribution: JobSearchDistributionItem[];
  titleDistribution: JobSearchDistributionItem[];
  searchHistory: { availability: "notTracked" };
  matching: {
    availability: "available" | "unavailable";
    matchedRequirements: number;
    missingRequirements: number;
    conflictingRequirements: number;
    unknownRequirements: number;
  };
}

function distribution(values: string[]): JobSearchDistributionItem[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].map(([label, count]) => ({ label, count }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

/** Derives only durable application-snapshot job facts; search history is not persisted. */
export function deriveJobSearchAnalytics(applications: ApplicationRecord[]): JobSearchAnalyticsReadModel {
  const source = applications.map((application) => application.jobSnapshot.source?.trim() || "Okänd källa");
  const location = applications.map((application) => application.jobSnapshot.location?.trim() || "Okänd plats");
  const title = applications.map((application) => application.jobSnapshot.title.trim() || "Okänd roll");
  const matching = applications.reduce((totals, application) => {
    const result = application.analysisSnapshot.matchingResult;
    totals.matched += result.totalMatched;
    totals.missing += result.totalMissing;
    totals.conflicting += result.totalConflicting;
    totals.unknown += result.totalUnknown;
    return totals;
  }, { matched: 0, missing: 0, conflicting: 0, unknown: 0 });
  return { availability: "available", basis: "APPLICATION_RECORDS", totalJobsRepresented: applications.length,
    sourceDistribution: distribution(source), locationDistribution: distribution(location), titleDistribution: distribution(title),
    searchHistory: { availability: "notTracked" }, matching: { availability: applications.length > 0 ? "available" : "unavailable", matchedRequirements: matching.matched, missingRequirements: matching.missing, conflictingRequirements: matching.conflicting, unknownRequirements: matching.unknown } };
}

export async function loadJobSearchAnalytics(): Promise<{ configured: boolean; analytics: JobSearchAnalyticsReadModel | null; error: "UNAVAILABLE" | null }> {
  const applicationPath = process.env.APPLICATION_REPOSITORY;
  if (!applicationPath?.trim()) return { configured: false, analytics: null, error: null };
  const result = await createFileApplicationRepository(resolve(applicationPath)).list();
  if (!result.ok) return { configured: true, analytics: null, error: "UNAVAILABLE" };
  return { configured: true, analytics: deriveJobSearchAnalytics(result.value), error: null };
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
