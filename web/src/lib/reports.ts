import { resolve } from "node:path";

import { createFileApplicationRepository } from "../../../.agents/job-search/cli/src/application-file-repository";
import { createFileCandidateApplicationAssociationRepository } from "../../../.agents/job-search/cli/src/coach-application-association-file-repository";
import { createCandidateActivityReportWorkflow } from "../../../.agents/job-search/cli/src/candidate-activity-report-workflow";
import { resolveCoachRepositoryPaths } from "../../../.agents/job-search/cli/src/coach-cli-paths";
import { createFileCandidateFollowUpRepository } from "../../../.agents/job-search/cli/src/coach-candidate-follow-up-file-repository";
import { createFileCoachOperationsRepository } from "../../../.agents/job-search/cli/src/coach-operations-file-repository";
import { createFileCoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-file-repository";

export async function loadCandidateActivityReport(
  candidateId: string,
  startAt: string,
  endAt: string,
) {
  const coachDir = process.env.COACH_DIR;
  const applicationRepositoryPath = process.env.APPLICATION_REPOSITORY;

  if (!coachDir || !applicationRepositoryPath) {
    return {
      configured: false as const,
      report: null,
      error: null,
    };
  }

  const paths = resolveCoachRepositoryPaths(resolve(coachDir));

  const candidates = createFileCoachWorkspaceRepository(paths.candidates);
  const applications = createFileApplicationRepository(
    resolve(applicationRepositoryPath),
  );
  const associations =
    createFileCandidateApplicationAssociationRepository(paths.associations);
  const followUps = createFileCandidateFollowUpRepository(paths.followUps);
  const operations = createFileCoachOperationsRepository(paths.operations);

  const workflow = createCandidateActivityReportWorkflow(
    candidates,
    applications,
    associations,
    followUps,
    operations,
  );

  const result = await workflow.getCandidateActivityReport(candidateId, {
    startAt,
    endAt,
  });

  if (!result.ok) {
    return {
      configured: true as const,
      report: null,
      error: result.error,
    };
  }

  return {
    configured: true as const,
    report: result.value,
    error: null,
  };
}
