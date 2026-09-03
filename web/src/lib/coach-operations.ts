import { resolve } from "node:path";

import { createFileApplicationRepository } from "../../../.agents/job-search/cli/src/application-file-repository";
import { createFileCandidateApplicationAssociationRepository } from "../../../.agents/job-search/cli/src/coach-application-association-file-repository";
import { resolveCoachRepositoryPaths } from "../../../.agents/job-search/cli/src/coach-cli-paths";
import { createCoachOperationsWorkflow } from "../../../.agents/job-search/cli/src/coach-operations-workflow";
import { createFileCoachOperationsRepository } from "../../../.agents/job-search/cli/src/coach-operations-file-repository";
import { createFileCoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-file-repository";

export function createCoachOperationsWebWorkflow() {
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
  const operations = createFileCoachOperationsRepository(paths.operations);

  return createCoachOperationsWorkflow(
    candidates,
    operations,
    applications,
    associations,
  );
}
