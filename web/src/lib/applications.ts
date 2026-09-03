import { resolve } from "node:path";

import { createFileApplicationRepository } from "../../../.agents/job-search/cli/src/application-file-repository";

export async function loadApplications() {
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
