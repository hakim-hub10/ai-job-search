import { resolve } from "node:path";

import { createFileCandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-file-repository";
import { resolveCoachRepositoryPaths } from "../../../.agents/job-search/cli/src/coach-cli-paths";

export function loadCandidateProfileRepository() {
  const coachDir = process.env.COACH_DIR;

  if (!coachDir) {
    return {
      configured: false as const,
      repository: null,
    };
  }

  const paths = resolveCoachRepositoryPaths(resolve(coachDir));

  return {
    configured: true as const,
    repository: createFileCandidateProfileRepository(paths.candidateProfiles),
  };
}

export async function loadCandidateProfile(candidateId: string) {
  const context = loadCandidateProfileRepository();

  if (!context.configured || !context.repository) {
    return {
      configured: false as const,
      profile: null,
      error: null,
    };
  }

  const result = await context.repository.getProfileByCandidateId(
    candidateId.trim(),
  );

  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") {
      return {
        configured: true as const,
        profile: null,
        error: null,
      };
    }

    return {
      configured: true as const,
      profile: null,
      error: result.error,
    };
  }

  return {
    configured: true as const,
    profile: result.value.profile,
    error: null,
  };
}
