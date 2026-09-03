import { resolve } from "node:path";

import { createFileCandidateFollowUpRepository } from "../../../.agents/job-search/cli/src/coach-candidate-follow-up-file-repository";
import { resolveCoachRepositoryPaths } from "../../../.agents/job-search/cli/src/coach-cli-paths";
import { loadApplications } from "./applications";
import { loadCoachCandidates } from "./coach-candidates";

export async function loadDashboardData() {
  const candidatesResult = await loadCoachCandidates();
  const applicationsResult = await loadApplications();

  const coachDir = process.env.COACH_DIR;

  if (
    !candidatesResult.configured ||
    !applicationsResult.configured ||
    !coachDir
  ) {
    return {
      configured: false as const,
      candidates: candidatesResult.candidates,
      applications: applicationsResult.applications,
      followUps: [],
      error: null,
    };
  }

  if (candidatesResult.error) {
    return {
      configured: true as const,
      candidates: [],
      applications: applicationsResult.applications,
      followUps: [],
      error: candidatesResult.error,
    };
  }

  if (applicationsResult.error) {
    return {
      configured: true as const,
      candidates: candidatesResult.candidates,
      applications: [],
      followUps: [],
      error: applicationsResult.error,
    };
  }

  const paths = resolveCoachRepositoryPaths(resolve(coachDir));
  const followUpRepository =
    createFileCandidateFollowUpRepository(paths.followUps);

  const followUps = [];

  for (const candidate of candidatesResult.candidates) {
    const result = await followUpRepository.listByCandidateId(candidate.id);

    if (!result.ok) {
      return {
        configured: true as const,
        candidates: candidatesResult.candidates,
        applications: applicationsResult.applications,
        followUps: [],
        error: result.error,
      };
    }

    followUps.push(...result.value);
  }

  followUps.sort(
    (a, b) =>
      a.dueAt.localeCompare(b.dueAt) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );

  return {
    configured: true as const,
    candidates: candidatesResult.candidates,
    applications: applicationsResult.applications,
    followUps,
    error: null,
  };
}
