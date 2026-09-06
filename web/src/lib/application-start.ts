import { createApplicationWorkflow } from "../../../.agents/job-search/cli/src/application-workflow";
import type { ApplicationRecord } from "../../../.agents/job-search/cli/src/applications";
import type { ApplicationRepository } from "../../../.agents/job-search/cli/src/application-repository";
import { createCoachApplicationWorkflow } from "../../../.agents/job-search/cli/src/coach-application-workflow";
import type { CandidateApplicationAssociationRepository } from "../../../.agents/job-search/cli/src/coach-application-association-repository";
import type { CoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-repository";
import type { CandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-repository";
import { analyzeJobsForCandidate } from "./candidate-job-matching";
import { searchWebJobs, type JobsSearchResult } from "./jobs";

export interface StartApplicationInput {
  candidateId: string;
  jobId: string;
  query?: string;
  location?: string;
  limit: number;
}

export type StartApplicationFailureCode =
  | "INVALID_INPUT"
  | "CANDIDATE_NOT_FOUND"
  | "CANDIDATE_STORAGE_FAILURE"
  | "PROFILE_NOT_FOUND"
  | "PROFILE_STORAGE_FAILURE"
  | "SEARCH_FAILED"
  | "JOB_NOT_FOUND"
  | "APPLICATION_STORAGE_FAILURE"
  | "DUPLICATE_APPLICATION"
  | "APPLICATION_CREATION_FAILED"
  | "APPLICATION_ASSOCIATION_FAILED";

export interface StartApplicationFailure {
  ok: false;
  code: StartApplicationFailureCode;
  message: string;
  applicationId?: string;
}

export interface StartApplicationSuccess {
  ok: true;
  application: ApplicationRecord;
}

export type StartApplicationResult =
  | StartApplicationSuccess
  | StartApplicationFailure;

export interface StartApplicationDependencies {
  searchJobs?: typeof searchWebJobs;
  candidateRepository: CoachWorkspaceRepository;
  profileRepository: CandidateProfileRepository;
  applicationRepository: ApplicationRepository;
  associationRepository: CandidateApplicationAssociationRepository;
  createId?: () => string;
  now?: () => string;
}

function failure(
  code: StartApplicationFailureCode,
  message: string,
  applicationId?: string,
): StartApplicationFailure {
  return { ok: false, code, message, ...(applicationId ? { applicationId } : {}) };
}

function isValidLimit(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= 50;
}

function mapSearchFailure(result: JobsSearchResult): StartApplicationFailure {
  return failure("SEARCH_FAILED", result.ok ? "" : result.message);
}

/**
 * Re-fetches and re-analyzes the selected job before creating the durable
 * application snapshot. Client-submitted job fields are never authoritative.
 */
export async function startApplicationFromJob(
  input: StartApplicationInput,
  dependencies: StartApplicationDependencies,
): Promise<StartApplicationResult> {
  const candidateId = input.candidateId.trim();
  const jobId = input.jobId.trim();
  const query = input.query?.trim() ?? "";
  const location = input.location?.trim() ?? "";

  if (!candidateId || !jobId || !isValidLimit(input.limit)) {
    return failure("INVALID_INPUT", "Kandidat, jobb och antal sökresultat måste vara giltiga.");
  }

  const candidate = await dependencies.candidateRepository.getCandidateById(candidateId);
  if (!candidate.ok) {
    return candidate.error.code === "NOT_FOUND"
      ? failure("CANDIDATE_NOT_FOUND", "Den valda kandidaten kunde inte hittas.")
      : failure("CANDIDATE_STORAGE_FAILURE", "Kandidatregistret kunde inte läsas.");
  }

  const searchJobs = dependencies.searchJobs ?? searchWebJobs;
  const searchResult = await searchJobs({
    ...(query ? { query } : {}),
    ...(location ? { location } : {}),
    limit: input.limit,
    targetRoles: undefined,
  });

  if (!searchResult.ok) return mapSearchFailure(searchResult);

  const matchingResult = await analyzeJobsForCandidate(
    { candidateId, jobs: searchResult.jobs },
    { profileRepository: dependencies.profileRepository },
  );

  if (!matchingResult.ok) {
    switch (matchingResult.code) {
      case "PROFILE_NOT_FOUND":
        return failure("PROFILE_NOT_FOUND", "Kandidatprofil saknas för den valda kandidaten.");
      case "PROFILE_STORAGE_FAILURE":
        return failure("PROFILE_STORAGE_FAILURE", "Kandidatprofilen kunde inte läsas.");
      default:
        return failure("APPLICATION_CREATION_FAILED", "Jobbmatchningen kunde inte analyseras.");
    }
  }

  const rankedJob = matchingResult.analysis.rankedJobs.find(
    (candidateJob) => candidateJob.job.id === jobId,
  );

  if (!rankedJob) {
    return failure("JOB_NOT_FOUND", "Det valda jobbet kunde inte hittas i den aktuella sökningen.");
  }

  const createdAt = dependencies.now?.() ?? new Date().toISOString();
  const applicationId = dependencies.createId?.() ?? crypto.randomUUID();
  const applicationWorkflow = createApplicationWorkflow(dependencies.applicationRepository);
  const created = await applicationWorkflow.startApplication({
    id: applicationId,
    rankedJob,
    createdAt,
  });

  if (!created.ok) {
    if (created.error.kind === "duplicate_advisory") {
      return failure(
        "DUPLICATE_APPLICATION",
        "Det finns redan en ansökan för det här jobbet och kandidaten.",
      );
    }

    if (created.error.kind === "repository") {
      return failure("APPLICATION_STORAGE_FAILURE", "Ansökningsarkivet kunde inte uppdateras.");
    }

    return failure("APPLICATION_CREATION_FAILED", "Ansökan kunde inte skapas.");
  }

  const associationWorkflow = createCoachApplicationWorkflow(
    dependencies.candidateRepository,
    dependencies.applicationRepository,
    dependencies.associationRepository,
  );
  const associated = await associationWorkflow.associateApplication({
    candidateId,
    applicationId: created.value.id,
    createdAt,
  });

  if (!associated.ok) {
    return failure(
      "APPLICATION_ASSOCIATION_FAILED",
      "Ansökan skapades, men kunde inte kopplas till kandidaten.",
      created.value.id,
    );
  }

  return { ok: true, application: created.value };
}
