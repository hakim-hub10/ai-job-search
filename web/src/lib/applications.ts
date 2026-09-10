import { resolve } from "node:path";

import { createFileApplicationRepository } from "../../../.agents/job-search/cli/src/application-file-repository";
import { createFileCandidateApplicationAssociationRepository } from "../../../.agents/job-search/cli/src/coach-application-association-file-repository";
import { resolveCoachRepositoryPaths } from "../../../.agents/job-search/cli/src/coach-cli-paths";

export async function loadApplications(candidateId?: string) {
  const applicationRepositoryPath = process.env.APPLICATION_REPOSITORY;

  if (!applicationRepositoryPath) {
    return {
      configured: false as const,
      applications: [],
      error: null,
    };
  }

  const repository = createFileApplicationRepository(
    resolve(applicationRepositoryPath),
  );

  if (candidateId) {
    const coachDir = process.env.COACH_DIR?.trim();
    if (!coachDir) return { configured: true as const, applications: [], error: null };
    const associations = createFileCandidateApplicationAssociationRepository(resolveCoachRepositoryPaths(resolve(coachDir)).associations);
    const linked = await associations.listByCandidateId(candidateId);
    if (!linked.ok) return { configured: true as const, applications: [], error: linked.error };
    const results = await Promise.all(linked.value.map((association) => repository.getById(association.applicationId)));
    if (results.some((result) => !result.ok)) return { configured: true as const, applications: [], error: { code: "READ_FAILURE", message: "Application archive could not be read." } };
    return { configured: true as const, applications: results.map((result) => result.ok ? result.value : null).filter((result): result is NonNullable<typeof result> => result !== null), error: null };
  }
  const result = await repository.list();

  if (!result.ok) {
    return {
      configured: true as const,
      applications: [],
      error: result.error,
    };
  }

  return {
    configured: true as const,
    applications: result.value,
    error: null,
  };
}
