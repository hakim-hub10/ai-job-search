import { analyzeJobs, createApplicationWorkflow } from "../../../.agents/job-search/cli/src/index";
import type { ApplicationRecord } from "../../../.agents/job-search/cli/src/applications";
import type { ApplicationRepository } from "../../../.agents/job-search/cli/src/application-repository";
import type { CandidateApplicationAssociationRepository } from "../../../.agents/job-search/cli/src/coach-application-association-repository";
import type { CoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-repository";
import type { CandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-repository";

export interface ReanalyzeApplicationJobInput {
  applicationId: string;
}

export type ReanalyzeApplicationJobFailureCode =
  | "INVALID_APPLICATION_ID"
  | "APPLICATION_NOT_FOUND"
  | "APPLICATION_STORAGE_FAILURE"
  | "ASSOCIATION_NOT_FOUND"
  | "ASSOCIATION_STORAGE_FAILURE"
  | "CANDIDATE_NOT_FOUND"
  | "CANDIDATE_STORAGE_FAILURE"
  | "PROFILE_NOT_FOUND"
  | "PROFILE_STORAGE_FAILURE"
  | "ANALYSIS_FAILED";

export interface ReanalyzeApplicationJobFailure {
  ok: false;
  code: ReanalyzeApplicationJobFailureCode;
  message: string;
}

export interface ReanalyzeApplicationJobSuccess {
  ok: true;
  application: ApplicationRecord;
}

export type ReanalyzeApplicationJobResult =
  | ReanalyzeApplicationJobSuccess
  | ReanalyzeApplicationJobFailure;

export interface ReanalyzeApplicationJobDependencies {
  applicationRepository: ApplicationRepository;
  associationRepository: CandidateApplicationAssociationRepository;
  candidateRepository: CoachWorkspaceRepository;
  profileRepository: CandidateProfileRepository;
  now?: () => string;
}

function failure(code: ReanalyzeApplicationJobFailureCode, message: string): ReanalyzeApplicationJobFailure {
  return { ok: false, code, message };
}

/**
 * Re-runs job matching/scoring/gap analysis for an application's own
 * existing jobSnapshot, using the candidate's current (latest) canonical
 * CandidateProfile. Reuses the exact same analyzeJobs pipeline every other
 * matching path uses - no second matching engine. Only the application's
 * analysisSnapshot is replaced (and only after a successful analysis); the
 * job itself, status, and notes are always preserved untouched. The prior
 * analysis is never overwritten before a new one has succeeded.
 */
export async function reanalyzeApplicationJob(
  input: ReanalyzeApplicationJobInput,
  dependencies: ReanalyzeApplicationJobDependencies,
): Promise<ReanalyzeApplicationJobResult> {
  const applicationId = input.applicationId.trim();
  if (!applicationId) return failure("INVALID_APPLICATION_ID", "Ansökans ID saknas.");

  const application = await dependencies.applicationRepository.getById(applicationId);
  if (!application.ok) {
    return application.error.code === "NOT_FOUND"
      ? failure("APPLICATION_NOT_FOUND", "Ansökan hittades inte.")
      : failure("APPLICATION_STORAGE_FAILURE", "Ansökningsarkivet kunde inte läsas.");
  }

  const association = await dependencies.associationRepository.getByApplicationId(applicationId);
  if (!association.ok) {
    return association.error.code === "NOT_FOUND"
      ? failure("ASSOCIATION_NOT_FOUND", "Ansökan saknar kandidatkoppling.")
      : failure("ASSOCIATION_STORAGE_FAILURE", "Kandidatkopplingen kunde inte läsas.");
  }

  const candidate = await dependencies.candidateRepository.getCandidateById(association.value.candidateId);
  if (!candidate.ok) {
    return candidate.error.code === "NOT_FOUND"
      ? failure("CANDIDATE_NOT_FOUND", "Den kopplade kandidaten hittades inte.")
      : failure("CANDIDATE_STORAGE_FAILURE", "Kandidatregistret kunde inte läsas.");
  }

  const profile = await dependencies.profileRepository.getProfileByCandidateId(candidate.value.id);
  if (!profile.ok) {
    return profile.error.code === "NOT_FOUND"
      ? failure("PROFILE_NOT_FOUND", "Kandidatprofil saknas.")
      : failure("PROFILE_STORAGE_FAILURE", "Kandidatprofilen kunde inte läsas.");
  }

  let rankedJob;
  try {
    rankedJob = analyzeJobs(profile.value.profile, [application.value.jobSnapshot]).rankedJobs[0];
  } catch {
    return failure("ANALYSIS_FAILED", "Jobbmatchningen kunde inte analyseras.");
  }
  if (!rankedJob) return failure("ANALYSIS_FAILED", "Jobbmatchningen kunde inte analyseras.");

  const workflow = createApplicationWorkflow(dependencies.applicationRepository);
  const timestamp = dependencies.now?.() ?? new Date().toISOString();
  const updated = await workflow.reanalyzeApplicationAndSave({
    applicationId,
    rankedJob,
    timestamp,
    ...(profile.value.profile.updatedAt ? { candidateProfileUpdatedAt: profile.value.profile.updatedAt } : {}),
  });

  if (!updated.ok) {
    return updated.error.kind === "repository"
      ? failure("APPLICATION_STORAGE_FAILURE", "Analysen kunde inte sparas.")
      : failure("ANALYSIS_FAILED", "Jobbmatchningen kunde inte analyseras.");
  }

  return { ok: true, application: updated.value };
}

/**
 * A stale-analysis signal only ever appears when both timestamps are known
 * and the profile has genuinely been edited after the analysis was taken -
 * never a guess. A record from before this metadata existed (either
 * timestamp missing) is never flagged stale.
 */
export function isApplicationAnalysisStale(
  application: Pick<ApplicationRecord, "analysisSnapshot">,
  currentProfileUpdatedAt: string | undefined,
): boolean {
  const analyzedProfileUpdatedAt = application.analysisSnapshot.candidateProfileUpdatedAt;
  if (!analyzedProfileUpdatedAt || !currentProfileUpdatedAt) return false;
  const analyzed = Date.parse(analyzedProfileUpdatedAt);
  const current = Date.parse(currentProfileUpdatedAt);
  if (Number.isNaN(analyzed) || Number.isNaN(current)) return false;
  return current > analyzed;
}
