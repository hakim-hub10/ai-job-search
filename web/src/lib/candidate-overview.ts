import { resolve } from "node:path";

import { createFileApplicationRepository } from "../../../.agents/job-search/cli/src/application-file-repository";
import { createFileCandidateApplicationAssociationRepository } from "../../../.agents/job-search/cli/src/coach-application-association-file-repository";
import { resolveCoachRepositoryPaths } from "../../../.agents/job-search/cli/src/coach-cli-paths";
import { createFileCandidateFollowUpRepository } from "../../../.agents/job-search/cli/src/coach-candidate-follow-up-file-repository";
import {
  createCoachCandidateOperationalOverviewWorkflow,
} from "../../../.agents/job-search/cli/src/coach-candidate-operational-overview-workflow";
import { createFileCoachOperationsRepository } from "../../../.agents/job-search/cli/src/coach-operations-file-repository";
import { createFileCoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-file-repository";

export async function loadCandidateOperationalOverview(candidateId: string) {
  const coachDir = process.env.COACH_DIR;
  const applicationRepositoryPath = process.env.APPLICATION_REPOSITORY;

  if (!coachDir) {
    return {
      configured: false as const,
      applicationRepositoryConfigured: Boolean(applicationRepositoryPath),
      candidate: null,
      overview: null,
      error: null,
    };
  }

  const paths = resolveCoachRepositoryPaths(resolve(coachDir));
  const candidates = createFileCoachWorkspaceRepository(paths.candidates);

  if (!applicationRepositoryPath) {
    const candidate = await candidates.getCandidateById(candidateId);

    return {
      configured: true as const,
      applicationRepositoryConfigured: false as const,
      candidate: candidate.ok ? candidate.value : null,
      overview: null,
      error: candidate.ok ? null : candidate.error,
    };
  }

  const applications = createFileApplicationRepository(
    resolve(applicationRepositoryPath),
  );
  const associations =
    createFileCandidateApplicationAssociationRepository(paths.associations);
  const followUps = createFileCandidateFollowUpRepository(paths.followUps);
  const operations = createFileCoachOperationsRepository(paths.operations);

  const workflow = createCoachCandidateOperationalOverviewWorkflow(
    candidates,
    applications,
    associations,
    followUps,
    operations,
  );

  const result = await workflow.getCandidateOperationalOverview(
    candidateId,
    new Date().toISOString(),
  );

  if (!result.ok) {
    return {
      configured: true as const,
      applicationRepositoryConfigured: true as const,
      candidate: null,
      overview: null,
      error: result.error,
    };
  }

  return {
    configured: true as const,
    applicationRepositoryConfigured: true as const,
    candidate: result.value.candidate,
    overview: result.value,
    error: null,
  };
}
