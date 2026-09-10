"use server";

import { resolve } from "node:path";

import { redirect } from "next/navigation";

import { createFileApplicationRepository } from "../../../../.agents/job-search/cli/src/application-file-repository";
import { createFileCandidateApplicationAssociationRepository } from "../../../../.agents/job-search/cli/src/coach-application-association-file-repository";
import { resolveCoachRepositoryPaths } from "../../../../.agents/job-search/cli/src/coach-cli-paths";
import { createFileCoachWorkspaceRepository } from "../../../../.agents/job-search/cli/src/coach-workspace-file-repository";
import { loadCandidateProfileRepository } from "@/lib/candidate-profiles";
import { startApplicationFromJob } from "@/lib/application-start";
import { configuredAuthorizationDependencies, requireOwnedCandidate } from "@/lib/authorization";

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

function redirectToJobs(formData: FormData, errorCode: string): never {
  const params = new URLSearchParams();
  const candidateId = formText(formData, "candidateId");
  const query = formText(formData, "query");
  const location = formText(formData, "location");
  const limit = formText(formData, "limit");

  if (candidateId) params.set("candidateId", candidateId);
  if (query) params.set("query", query);
  if (location) params.set("location", location);
  if (limit) params.set("limit", limit);
  params.set("applicationError", errorCode);

  redirect(`/jobs?${params.toString()}`);
}

export async function startApplicationAction(formData: FormData) {
  const coachDir = process.env.COACH_DIR;
  const applicationRepositoryPath = process.env.APPLICATION_REPOSITORY;

  if (!coachDir || !applicationRepositoryPath) {
    redirectToJobs(formData, "CONFIGURATION_MISSING");
  }

  const candidateId = formText(formData, "candidateId");
  const jobId = formText(formData, "jobId");
  const query = formText(formData, "query");
  const location = formText(formData, "location");
  const limit = parseLimit(formText(formData, "limit"));

  if (!candidateId || !jobId || !limit) {
    redirectToJobs(formData, "INVALID_INPUT");
  }
  const authorization = configuredAuthorizationDependencies();
  const owned = authorization.ok ? await requireOwnedCandidate(candidateId, authorization.value) : authorization;
  if (!owned.ok) redirectToJobs(formData, "FORBIDDEN");

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
    redirectToJobs(formData, result.code);
  }

  redirect(`/applications/${encodeURIComponent(result.application.id)}`);
}
