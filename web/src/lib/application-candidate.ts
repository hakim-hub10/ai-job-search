import { resolve } from "node:path";

import { createFileApplicationRepository } from "../../../.agents/job-search/cli/src/application-file-repository";
import { createCoachApplicationWorkflow } from "../../../.agents/job-search/cli/src/coach-application-workflow";
import { createFileCandidateApplicationAssociationRepository } from "../../../.agents/job-search/cli/src/coach-application-association-file-repository";
import { resolveCoachRepositoryPaths } from "../../../.agents/job-search/cli/src/coach-cli-paths";
import { createFileCoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-file-repository";

export async function loadApplicationCandidate(applicationId: string) {
  const coachDir = process.env.COACH_DIR;
  const applicationRepositoryPath = process.env.APPLICATION_REPOSITORY;

  if (!coachDir || !applicationRepositoryPath) {
    return {
      configured: false as const,
      candidate: null,
      candidates: [],
      error: null,
    };
  }

  const paths = resolveCoachRepositoryPaths(resolve(coachDir));

  const candidateRepository =
    createFileCoachWorkspaceRepository(paths.candidates);

  const applicationRepository =
    createFileApplicationRepository(resolve(applicationRepositoryPath));

  const associationRepository =
    createFileCandidateApplicationAssociationRepository(paths.associations);

  const listedCandidates = await candidateRepository.listCandidates();

  if (!listedCandidates.ok) {
    return {
      configured: true as const,
      candidate: null,
      candidates: [],
      error: listedCandidates.error,
    };
  }

  const workflow = createCoachApplicationWorkflow(
    candidateRepository,
    applicationRepository,
    associationRepository,
  );

  const assigned = await workflow.getApplicationCandidate(applicationId);

  if (!assigned.ok) {
    if (
      assigned.error.kind === "association_repository" &&
      assigned.error.error.code === "NOT_FOUND"
    ) {
      return {
        configured: true as const,
        candidate: null,
        candidates: listedCandidates.value,
        error: null,
      };
    }

    const error =
      assigned.error.kind === "candidate_repository" ||
      assigned.error.kind === "application_repository" ||
      assigned.error.kind === "association_repository"
        ? assigned.error.error
        : {
            code: assigned.error.error.code,
            message: "Application candidate ownership could not be loaded.",
          };

    return {
      configured: true as const,
      candidate: null,
      candidates: listedCandidates.value,
      error,
    };
  }

  return {
    configured: true as const,
    candidate: assigned.value,
    candidates: listedCandidates.value,
    error: null,
  };
}
