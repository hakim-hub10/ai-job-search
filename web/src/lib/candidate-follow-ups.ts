import { resolve } from "node:path";

import { createFileApplicationRepository } from "../../../.agents/job-search/cli/src/application-file-repository";
import { createFileCandidateApplicationAssociationRepository } from "../../../.agents/job-search/cli/src/coach-application-association-file-repository";
import { resolveCoachRepositoryPaths } from "../../../.agents/job-search/cli/src/coach-cli-paths";
import { createFileCandidateFollowUpRepository } from "../../../.agents/job-search/cli/src/coach-candidate-follow-up-file-repository";
import { createCoachCandidateProgressWorkflow } from "../../../.agents/job-search/cli/src/coach-candidate-progress-workflow";
import { createFileCoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-file-repository";

export function createCandidateFollowUpWebWorkflow() {
  const coachDir = process.env.COACH_DIR;
  const applicationRepositoryPath = process.env.APPLICATION_REPOSITORY;

  if (!coachDir || !applicationRepositoryPath) {
    return null;
  }

  const paths = resolveCoachRepositoryPaths(resolve(coachDir));

  const candidates = createFileCoachWorkspaceRepository(paths.candidates);
  const applications = createFileApplicationRepository(
    resolve(applicationRepositoryPath),
  );
  const associations =
    createFileCandidateApplicationAssociationRepository(paths.associations);
  const followUps = createFileCandidateFollowUpRepository(paths.followUps);

  return createCoachCandidateProgressWorkflow(
    candidates,
    applications,
    associations,
    followUps,
  );
}

export async function loadCandidateFollowUps(candidateId: string) {
  const workflow = createCandidateFollowUpWebWorkflow();

  if (!workflow) {
    return {
      configured: false as const,
      followUps: [],
      error: null,
    };
  }

  const result = await workflow.listCandidateFollowUps(candidateId);

  if (!result.ok) {
    return {
      configured: true as const,
      followUps: [],
      error: result.error,
    };
  }

  return {
    configured: true as const,
    followUps: result.value,
    error: null,
  };
}
