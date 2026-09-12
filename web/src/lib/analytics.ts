import "server-only";
import { resolve } from "node:path";

import { createFileApplicationRepository } from "../../../.agents/job-search/cli/src/application-file-repository";
import type { ApplicationRecord } from "../../../.agents/job-search/cli/src/applications";
import { createRequirementIdentity, requirementCategoryForGapType, type RequirementCategory } from "../../../.agents/job-search/cli/src/requirements";
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
export interface AnalyticsPeriodQuery { start?: string | string[]; end?: string | string[]; asOf?: string | string[] }
export interface AnalyticsPeriod { start: string; end: string; asOf: string }

function isStrictDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  if (month < 1 || month > 12) {
    return false;
  }

  const monthLengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const maxDay = month === 2 ? (isLeapYear ? 29 : 28) : monthLengths[month - 1];

  if (day < 1 || day > maxDay) {
    return false;
  }

  const normalized = new Date(Date.UTC(year, month - 1, day));
  return normalized.getUTCFullYear() === year
    && normalized.getUTCMonth() === month - 1
    && normalized.getUTCDate() === day;
}

export function parseAnalyticsPeriod(query: AnalyticsPeriodQuery): { ok: true; value: AnalyticsPeriod } | { ok: false; code: "INVALID_PERIOD" } {
  const values = [query.start, query.end, query.asOf];
  if (values.some((value) => Array.isArray(value))) {
    return { ok: false, code: "INVALID_PERIOD" };
  }

  const start = (query.start ?? "2026-01-01") as string;
  const end = (query.end ?? "2027-01-01") as string;
  const asOf = (query.asOf ?? end) as string;

  const validDate = (value: string) => isStrictDateOnly(value);
  if (![start, end, asOf].every(validDate) || start >= end) return { ok: false, code: "INVALID_PERIOD" };
  return { ok: true, value: { start, end, asOf } };
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
export interface RequirementInsight {
  requirementId: string;
  label: string;
  applicationsRepresented: number;
  matched: number;
  missing: number;
  conflicting: number;
  unknown: number;
}
export interface SkillGapInsight {
  gapId: string;
  label: string;
  applicationsRepresented: number;
  occurrences: number;
  severityDistribution: JobSearchDistributionItem[];
}
export interface CandidateRequirementInsightsReadModel {
  availability: "available";
  applicationsTotal: number;
  applicationsWithAnalysis: number;
  applicationsWithoutAnalysis: number;
  requirements: RequirementInsight[];
  skillGaps: SkillGapInsight[];
}
export type CareerActionKind = "reviewMissingRequirement" | "verifyUnknownRequirement" | "reviewConflictingRequirement" | "reviewSkillGap" | "improveAnalysisCoverage";
export interface CareerActionInsight {
  id: string; kind: CareerActionKind; title: string; description: string; evidence: string;
  applicationsRepresented?: number; requirementId?: string; gapId?: string;
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

/**
 * Grouping key for analytics rollups only - deliberately broader than
 * requirements.ts's normalizeRequirementText, which preserves punctuation so
 * matching/scoring keep e.g. "C" and "C++" distinct (see its "preserves
 * punctuation, hyphens, slashes, and symbols" test). A human-facing summary
 * has different goals: it should not double-count the same requirement
 * written two conventional ways, such as "Active Directory" and
 * "active-directory", or "Microsoft 365" and "microsoft-365". Folding only
 * hyphens/underscores into spaces (in addition to the existing case-folding)
 * fixes that formatting duplication without merging symbol-bearing terms
 * like "C++", "C#", or ".NET" that must stay distinct.
 */
function analyticsRequirementBucketKey(category: RequirementCategory, original: string): string {
  const collapsed = original.normalize("NFC").trim().toLowerCase().replace(/[-_]+/gu, " ").replace(/\s+/gu, " ").trim();
  return `${category}:${collapsed}`;
}

function aggregateApplicationRequirementStates(application: ApplicationRecord, target: Map<string, RequirementInsight>): void {
  const seen = new Set<string>();
  for (const evidence of [...application.analysisSnapshot.matchingResult.matched, ...application.analysisSnapshot.matchingResult.missing, ...application.analysisSnapshot.matchingResult.conflicting, ...application.analysisSnapshot.matchingResult.unknown]) {
    for (const label of evidence.requirementCoverage?.matchedRequirements ?? []) {
      const identity = createRequirementIdentity("skill", label);
      const bucketKey = analyticsRequirementBucketKey(identity.category, identity.original);
      const current = target.get(bucketKey) ?? { requirementId: bucketKey, label: identity.original, applicationsRepresented: 0, matched: 0, missing: 0, conflicting: 0, unknown: 0 };
      if (!seen.has(bucketKey)) { current.applicationsRepresented += 1; seen.add(bucketKey); }
      if (evidence.status === "matched") current.matched += 1;
      if (evidence.status === "missing") current.missing += 1;
      if (evidence.status === "conflicting") current.conflicting += 1;
      if (evidence.status === "unknown") current.unknown += 1;
      if (identity.original.localeCompare(current.label) < 0) current.label = identity.original;
      target.set(bucketKey, current);
    }
    for (const label of evidence.requirementCoverage?.missingRequirements ?? []) {
      const identity = createRequirementIdentity("skill", label);
      const bucketKey = analyticsRequirementBucketKey(identity.category, identity.original);
      const current = target.get(bucketKey) ?? { requirementId: bucketKey, label: identity.original, applicationsRepresented: 0, matched: 0, missing: 0, conflicting: 0, unknown: 0 };
      if (!seen.has(bucketKey)) { current.applicationsRepresented += 1; seen.add(bucketKey); }
      if (evidence.status === "matched") current.matched += 1;
      if (evidence.status === "missing") current.missing += 1;
      if (evidence.status === "conflicting") current.conflicting += 1;
      if (evidence.status === "unknown") current.unknown += 1;
      if (identity.original.localeCompare(current.label) < 0) current.label = identity.original;
      target.set(bucketKey, current);
    }
  }
}

export function deriveCandidateRequirementInsights(applications: ApplicationRecord[]): CandidateRequirementInsightsReadModel {
  const requirements = new Map<string, RequirementInsight>();
  const gaps = new Map<string, { label: string; applications: Set<string>; occurrences: number; severities: Map<string, number> }>();
  for (const application of applications) {
    aggregateApplicationRequirementStates(application, requirements);
    for (const gap of application.analysisSnapshot.skillGapResult.gaps) {
      const identity = gap.requirement?.identity ?? createRequirementIdentity(requirementCategoryForGapType(gap.type), gap.jobRequirement);
      const bucketKey = analyticsRequirementBucketKey(identity.category, identity.original);
      const current = gaps.get(bucketKey) ?? { label: identity.original, applications: new Set<string>(), occurrences: 0, severities: new Map<string, number>() };
      current.label = current.label.localeCompare(identity.original) <= 0 ? current.label : identity.original;
      current.applications.add(application.id); current.occurrences += 1;
      current.severities.set(gap.severity, (current.severities.get(gap.severity) ?? 0) + 1);
      gaps.set(bucketKey, current);
    }
  }
  return { availability: "available", applicationsTotal: applications.length, applicationsWithAnalysis: applications.length, applicationsWithoutAnalysis: 0,
    requirements: [...requirements.values()].sort((a, b) => b.applicationsRepresented - a.applicationsRepresented || a.requirementId.localeCompare(b.requirementId)),
    skillGaps: [...gaps.entries()].map(([gapId, value]) => ({ gapId, label: value.label, applicationsRepresented: value.applications.size, occurrences: value.occurrences, severityDistribution: [...value.severities.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => a.label.localeCompare(b.label)) })).sort((a, b) => b.applicationsRepresented - a.applicationsRepresented || a.gapId.localeCompare(b.gapId)) };
}
export function deriveCandidateCareerActions(insights: CandidateRequirementInsightsReadModel): CareerActionInsight[] {
  const actions: CareerActionInsight[] = [];
  for (const requirement of insights.requirements) {
    if (requirement.missing > 0) actions.push({ id: `review-missing:${requirement.requirementId}`, kind: "reviewMissingRequirement", title: "Granska återkommande krav", description: `Överväg att stärka eller tydliggöra underlaget för ${requirement.label}.`, evidence: `Kravet saknades i ${requirement.missing} sparade analyser.`, applicationsRepresented: requirement.applicationsRepresented, requirementId: requirement.requirementId });
    if (requirement.unknown > 0) actions.push({ id: `verify-unknown:${requirement.requirementId}`, kind: "verifyUnknownRequirement", title: "Komplettera information", description: `Överväg att verifiera eller komplettera information om ${requirement.label}.`, evidence: `Informationen var okänd i ${requirement.unknown} sparade analyser.`, applicationsRepresented: requirement.applicationsRepresented, requirementId: requirement.requirementId });
    if (requirement.conflicting > 0) actions.push({ id: `review-conflict:${requirement.requirementId}`, kind: "reviewConflictingRequirement", title: "Granska motstridig information", description: `Överväg att granska den motstridiga informationen om ${requirement.label}.`, evidence: `Kravet hade motstridig status i ${requirement.conflicting} sparade analyser.`, applicationsRepresented: requirement.applicationsRepresented, requirementId: requirement.requirementId });
  }
  for (const gap of insights.skillGaps) actions.push({ id: `review-gap:${gap.gapId}`, kind: "reviewSkillGap", title: "Granska ett återkommande kompetensgap", description: `Överväg att granska underlaget för ${gap.label}.`, evidence: `Gapet förekom ${gap.occurrences} gånger i sparade analyser från ${gap.applicationsRepresented} ansökningar.`, applicationsRepresented: gap.applicationsRepresented, gapId: gap.gapId });
  if (insights.applicationsWithoutAnalysis > 0) actions.push({ id: "analysis-coverage", kind: "improveAnalysisCoverage", title: "Komplettera analysunderlaget", description: "Överväg att skapa analyser för fler sparade ansökningar om du vill ha en mer komplett översikt.", evidence: `${insights.applicationsWithoutAnalysis} av ${insights.applicationsTotal} ansökningar saknar sparad analys.` });
  return actions;
}

export async function loadCandidateRequirementInsights(candidateId: string): Promise<{ configured: boolean; insights: CandidateRequirementInsightsReadModel | null; error: "NOT_FOUND" | "UNAVAILABLE" | null }> {
  const repos = repositories();
  if (!repos) return { configured: false, insights: null, error: null };
  const candidate = await repos.candidates.getCandidateById(candidateId);
  if (!candidate.ok) return { configured: true, insights: null, error: candidate.error.code === "NOT_FOUND" ? "NOT_FOUND" : "UNAVAILABLE" };
  const associations = await repos.associations.listByCandidateId(candidateId);
  if (!associations.ok) return { configured: true, insights: null, error: "UNAVAILABLE" };
  const applications: ApplicationRecord[] = [];
  for (const association of associations.value) {
    if (association.candidateId !== candidateId) return { configured: true, insights: null, error: "UNAVAILABLE" };
    const application = await repos.applications.getById(association.applicationId);
    if (!application.ok) return { configured: true, insights: null, error: "UNAVAILABLE" };
    applications.push(application.value);
  }
  return { configured: true, insights: deriveCandidateRequirementInsights(applications), error: null };
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
