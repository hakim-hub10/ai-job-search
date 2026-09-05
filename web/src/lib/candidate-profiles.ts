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
