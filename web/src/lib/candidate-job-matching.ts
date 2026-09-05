import {
  analyzeJobs,
  type CareerAnalysisResult,
  type NormalizedJob,
} from "../../../.agents/job-search/cli/src/index";
import type { CandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-repository";

export interface CandidateJobMatchingInput {
  candidateId: string;
  jobs: NormalizedJob[];
}

export interface CandidateJobMatchingSuccess {
  ok: true;
  analysis: CareerAnalysisResult;
}

export interface CandidateJobMatchingFailure {
  ok: false;
  code:
    | "INVALID_CANDIDATE_ID"
    | "PROFILE_NOT_FOUND"
    | "PROFILE_STORAGE_FAILURE"
    | "ANALYSIS_FAILED";
  message: string;
}

export type CandidateJobMatchingResult =
  | CandidateJobMatchingSuccess
  | CandidateJobMatchingFailure;

export interface CandidateJobMatchingDependencies {
  profileRepository: CandidateProfileRepository;
  analyze?: typeof analyzeJobs;
}

/**
 * Matches already-normalized jobs against an explicitly stored candidate
 * profile. Missing profile data is never replaced with defaults or inferred
 * candidate facts.
 */
export async function analyzeJobsForCandidate(
  input: CandidateJobMatchingInput,
  dependencies: CandidateJobMatchingDependencies,
): Promise<CandidateJobMatchingResult> {
  const candidateId = input.candidateId.trim();

  if (!candidateId) {
    return {
      ok: false,
      code: "INVALID_CANDIDATE_ID",
      message: "Candidate ID is required.",
    };
  }

  const profileResult =
    await dependencies.profileRepository.getProfileByCandidateId(candidateId);

  if (!profileResult.ok) {
    if (profileResult.error.code === "NOT_FOUND") {
      return {
        ok: false,
        code: "PROFILE_NOT_FOUND",
        message: "Candidate profile was not found.",
      };
    }

    return {
      ok: false,
      code: "PROFILE_STORAGE_FAILURE",
      message: "Candidate profile storage could not be read.",
    };
  }

  try {
    const analyze = dependencies.analyze ?? analyzeJobs;

    return {
      ok: true,
      analysis: analyze(profileResult.value.profile, input.jobs),
    };
  } catch {
    return {
      ok: false,
      code: "ANALYSIS_FAILED",
      message: "Candidate job analysis failed.",
    };
  }
}
