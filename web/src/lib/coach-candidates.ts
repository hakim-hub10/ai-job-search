import { resolve } from "node:path";

import { createFileCoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-file-repository";
import { resolveCoachRepositoryPaths } from "../../../.agents/job-search/cli/src/coach-cli-paths";

export async function loadCoachCandidates() {
  const coachDir = process.env.COACH_DIR;

  if (!coachDir) {
    return {
      configured: false as const,
      candidates: [],
      error: null,
    };
  }

  const paths = resolveCoachRepositoryPaths(resolve(coachDir));
  const repository = createFileCoachWorkspaceRepository(paths.candidates);
  const result = await repository.listCandidates();

  if (!result.ok) {
    return {
      configured: true as const,
      candidates: [],
      error: result.error,
    };
  }

  return {
    configured: true as const,
    candidates: result.value,
    error: null,
  };
}
