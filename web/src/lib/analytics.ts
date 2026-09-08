import "server-only";
import { resolve } from "node:path";

import { createFileApplicationRepository } from "../../../.agents/job-search/cli/src/application-file-repository";
import type { ApplicationRecord } from "../../../.agents/job-search/cli/src/applications";
import { createFileInterviewSessionRepository } from "../../../.agents/job-search/cli/src/interview-session-file-repository";
import { createFileInterviewPreparationRepository } from "../../../.agents/job-search/cli/src/interview-preparation-file-repository";
import { createFileInterviewSessionPreparationLinkRepository } from "../../../.agents/job-search/cli/src/interview-session-preparation-link-file-repository";
import { resolveInterviewSessionPreparation } from "../../../.agents/job-search/cli/src/interview-session-preparation";
import { getInterviewSessionSummary, type InterviewSession } from "../../../.agents/job-search/cli/src/interview-session";
import { isPersistableInterviewSession } from "../../../.agents/job-search/cli/src/interview-session-storage-validation";
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
export interface InterviewPracticeAnalyticsReadModel {
  availability: "available";
  totalSessions: number;
  activeSessions: number;
  completedSessions: number;
  linkedSessions: number;
  unlinkedSessions: number;
  unavailableSessions: number;
  answeredQuestions: number;
  skippedQuestions: number;
  typeDistribution: JobSearchDistributionItem[];
  temporalAnalytics: { availability: "notTracked" };
}

function distribution(values: string[]): JobSearchDistributionItem[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].map(([label, count]) => ({ label, count }))
    .sort((left, right) => left.label.localeCompare(right.label));
}
export function deriveInterviewPracticeAnalytics(sessions: InterviewSession[], linkage: Array<"linked" | "unlinked" | "unavailable">): InterviewPracticeAnalyticsReadModel {
  const totals = sessions.reduce((value, session, index) => {
    const summary = getInterviewSessionSummary(session);
    if (!summary.ok) return value;
    value.answered += summary.value.answeredQuestions; value.skipped += summary.value.skippedQuestions;
    if (summary.value.status === "completed") value.completed += 1; else value.active += 1;
    const link = linkage[index]; if (link === "linked") value.linked += 1; else if (link === "unlinked") value.unlinked += 1; else value.unavailable += 1;
    return value;
  }, { active: 0, completed: 0, linked: 0, unlinked: 0, unavailable: 0, answered: 0, skipped: 0 });
  return { availability: "available", totalSessions: sessions.length, activeSessions: totals.active, completedSessions: totals.completed, linkedSessions: totals.linked, unlinkedSessions: totals.unlinked, unavailableSessions: totals.unavailable, answeredQuestions: totals.answered, skippedQuestions: totals.skipped, typeDistribution: distribution(sessions.map((session) => session.interviewType)), temporalAnalytics: { availability: "notTracked" } };
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
export async function loadCandidateInterviewPracticeAnalytics(candidateId: string): Promise<{ configured: boolean; analytics: InterviewPracticeAnalyticsReadModel | null; error: "NOT_FOUND" | "UNAVAILABLE" | null }> {
  const coachDir = process.env.COACH_DIR, applicationPath = process.env.APPLICATION_REPOSITORY, sessionPath = process.env.INTERVIEW_SESSION_REPOSITORY, preparationPath = process.env.INTERVIEW_PREPARATION_REPOSITORY, linkPath = process.env.INTERVIEW_SESSION_PREPARATION_LINK_REPOSITORY;
  if (![coachDir, applicationPath, sessionPath, preparationPath, linkPath].every((path) => path?.trim())) return { configured: false, analytics: null, error: null };
  const paths = resolveCoachRepositoryPaths(resolve(coachDir!));
  const candidates = createFileCoachWorkspaceRepository(paths.candidates);
  const candidate = await candidates.getCandidateById(candidateId);
  if (!candidate.ok) return { configured: true, analytics: null, error: candidate.error.code === "NOT_FOUND" ? "NOT_FOUND" : "UNAVAILABLE" };
  const associations = await createFileCandidateApplicationAssociationRepository(paths.associations).listByCandidateId(candidateId);
  if (!associations.ok) return { configured: true, analytics: null, error: "UNAVAILABLE" };
  const sessionsRepository = createFileInterviewSessionRepository(resolve(sessionPath!));
  const preparationRepository = createFileInterviewPreparationRepository(resolve(preparationPath!));
  const links = createFileInterviewSessionPreparationLinkRepository(resolve(linkPath!), { sessionRepository: sessionsRepository, preparationRepository });
  const sessions: InterviewSession[] = [], linkage: Array<"linked" | "unlinked" | "unavailable"> = [];
  for (const association of associations.value) {
    const listed = await sessionsRepository.listByApplicationId(association.applicationId);
    if (!listed.ok) return { configured: true, analytics: null, error: "UNAVAILABLE" };
    for (const session of listed.value) {
      if (!isPersistableInterviewSession(session)) return { configured: true, analytics: null, error: "UNAVAILABLE" };
      if (session.applicationId !== association.applicationId) return { configured: true, analytics: null, error: "UNAVAILABLE" };
      sessions.push(session);
      const resolved = await resolveInterviewSessionPreparation({ applicationId: association.applicationId, sessionId: session.id }, { sessionRepository: sessionsRepository, preparationRepository, linkRepository: links });
      linkage.push(resolved.ok ? "linked" : resolved.error.code === "UNLINKED_SESSION" ? "unlinked" : "unavailable");
    }
  }
  return { configured: true, analytics: deriveInterviewPracticeAnalytics(sessions, linkage), error: null };
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
