"use server";

import { resolve } from "node:path";

import { redirect } from "next/navigation";

import { createFileApplicationRepository } from "../../../../.agents/job-search/cli/src/application-file-repository";
import { createFileCandidateApplicationAssociationRepository } from "../../../../.agents/job-search/cli/src/coach-application-association-file-repository";
import { resolveCoachRepositoryPaths } from "../../../../.agents/job-search/cli/src/coach-cli-paths";
import { createFileCoachWorkspaceRepository } from "../../../../.agents/job-search/cli/src/coach-workspace-file-repository";
import { loadCandidateProfileRepository } from "@/lib/candidate-profiles";
import { startApplicationFromJob } from "@/lib/application-start";
import { configuredAuthorizationDependencies, getAuthorizedCandidateContext } from "@/lib/authorization";

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function parseLimit(value: string): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 50
    ? parsed
    : 0;
}

function redirectToJobs(formData: FormData, errorCode: string, duplicateApplicationId?: string): never {
  const params = new URLSearchParams();
  const query = formText(formData, "query");
  const location = formText(formData, "location");
  const limit = formText(formData, "limit");

  if (query) params.set("query", query);
  if (location) params.set("location", location);
  if (limit) params.set("limit", limit);
  params.set("applicationError", errorCode);
  if (duplicateApplicationId) params.set("duplicateApplicationId", duplicateApplicationId);

  redirect(`/jobs?${params.toString()}`);
}

export async function startApplicationAction(formData: FormData) {
  const coachDir = process.env.COACH_DIR;
  const applicationRepositoryPath = process.env.APPLICATION_REPOSITORY;

  if (!coachDir || !applicationRepositoryPath) {
    redirectToJobs(formData, "CONFIGURATION_MISSING");
  }

  const jobId = formText(formData, "jobId");
  const query = formText(formData, "query");
  const location = formText(formData, "location");
  const limit = parseLimit(formText(formData, "limit"));

  if (!jobId || !limit) {
    redirectToJobs(formData, "INVALID_INPUT");
  }
  const authorization = configuredAuthorizationDependencies();
  const owned = authorization.ok ? await getAuthorizedCandidateContext(authorization.value) : authorization;
  if (!owned.ok) redirectToJobs(formData, "FORBIDDEN");
  const candidateId = owned.value.candidate.id;

  const paths = resolveCoachRepositoryPaths(resolve(coachDir));
  const profileContext = loadCandidateProfileRepository();

  if (!profileContext.configured || !profileContext.repository) {
    redirectToJobs(formData, "PROFILE_STORAGE_FAILURE");
  }

  const result = await startApplicationFromJob(
    { candidateId, jobId, query, location, limit },
    {
      candidateRepository: createFileCoachWorkspaceRepository(paths.candidates),
      profileRepository: profileContext.repository,
      applicationRepository: createFileApplicationRepository(
        resolve(applicationRepositoryPath),
      ),
      associationRepository:
        createFileCandidateApplicationAssociationRepository(paths.associations),
    },
  );

  if (!result.ok) {
    redirectToJobs(formData, result.code, result.applicationId);
  }

  redirect(`/applications/${encodeURIComponent(result.application.id)}`);
}
