import { resolve } from "node:path";

import { createFileApplicationRepository } from "../../../.agents/job-search/cli/src/application-file-repository";

export async function loadApplicationDetail(applicationId: string) {
  const repositoryPath = process.env.APPLICATION_REPOSITORY;

  if (!repositoryPath) {
    return {
      configured: false as const,
      application: null,
      error: null,
    };
  }

  const repository = createFileApplicationRepository(resolve(repositoryPath));
  const result = await repository.getById(applicationId);

  if (!result.ok) {
    return {
      configured: true as const,
      application: null,
      error: result.error,
    };
  }

  return {
    configured: true as const,
    application: result.value,
    error: null,
  };
}
