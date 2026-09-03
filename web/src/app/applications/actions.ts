"use server";

import { resolve } from "node:path";

import { redirect } from "next/navigation";

import { createFileApplicationRepository } from "../../../../.agents/job-search/cli/src/application-file-repository";
import { createApplicationWorkflow } from "../../../../.agents/job-search/cli/src/application-workflow";
import type { ApplicationStatus } from "../../../../.agents/job-search/cli/src/applications";

const APPLICATION_STATUSES = new Set<ApplicationStatus>([
  "saved",
  "preparing",
  "applied",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
  "closed",
]);

export async function updateApplicationStatusAction(formData: FormData) {
  const repositoryPath = process.env.APPLICATION_REPOSITORY;

  if (!repositoryPath) {
    throw new Error("APPLICATION_REPOSITORY is not configured.");
  }

  const applicationIdValue = formData.get("applicationId");
  const statusValue = formData.get("status");

  const applicationId =
    typeof applicationIdValue === "string" ? applicationIdValue.trim() : "";

  const status =
    typeof statusValue === "string" ? statusValue.trim() : "";

  if (!applicationId) {
    throw new Error("Application ID is required.");
  }

  if (!APPLICATION_STATUSES.has(status as ApplicationStatus)) {
    throw new Error("Unsupported application status.");
  }

  const repository = createFileApplicationRepository(resolve(repositoryPath));
  const workflow = createApplicationWorkflow(repository);

  const result = await workflow.updateApplicationStatusAndSave({
    applicationId,
    status: status as ApplicationStatus,
    timestamp: new Date().toISOString(),
  });

  if (!result.ok) {
    const message =
      result.error.kind === "domain"
        ? result.error.error.message
        : result.error.kind === "repository"
          ? result.error.error.message
          : "Application status could not be updated.";

    throw new Error(message);
  }

  redirect(`/applications/${encodeURIComponent(applicationId)}`);
}

export async function associateApplicationCandidateAction(formData: FormData) {
  const coachDir = process.env.COACH_DIR;
  const repositoryPath = process.env.APPLICATION_REPOSITORY;

  if (!coachDir) {
    throw new Error("COACH_DIR is not configured.");
  }

  if (!repositoryPath) {
    throw new Error("APPLICATION_REPOSITORY is not configured.");
  }

  const applicationIdValue = formData.get("applicationId");
  const candidateIdValue = formData.get("candidateId");

  const applicationId =
    typeof applicationIdValue === "string"
      ? applicationIdValue.trim()
      : "";

  const candidateId =
    typeof candidateIdValue === "string"
      ? candidateIdValue.trim()
      : "";

  if (!applicationId || !candidateId) {
    throw new Error("Application and candidate are required.");
  }

  const { createCoachApplicationWorkflow } =
    await import("../../../../.agents/job-search/cli/src/coach-application-workflow");

  const { createFileCandidateApplicationAssociationRepository } =
    await import("../../../../.agents/job-search/cli/src/coach-application-association-file-repository");

  const { resolveCoachRepositoryPaths } =
    await import("../../../../.agents/job-search/cli/src/coach-cli-paths");

  const { createFileCoachWorkspaceRepository } =
    await import("../../../../.agents/job-search/cli/src/coach-workspace-file-repository");

  const paths = resolveCoachRepositoryPaths(resolve(coachDir));

  const candidateRepository =
    createFileCoachWorkspaceRepository(paths.candidates);

  const applicationRepository =
    createFileApplicationRepository(resolve(repositoryPath));

  const associationRepository =
    createFileCandidateApplicationAssociationRepository(paths.associations);

  const workflow = createCoachApplicationWorkflow(
    candidateRepository,
    applicationRepository,
    associationRepository,
  );

  const result = await workflow.associateApplication({
    candidateId,
    applicationId,
    createdAt: new Date().toISOString(),
  });

  if (!result.ok) {
    if (result.error.kind === "ownership_conflict") {
      if (
        result.error.error.code ===
        "ALREADY_ASSOCIATED_WITH_CANDIDATE"
      ) {
        throw new Error(
          "This application is already assigned to this candidate.",
        );
      }

      throw new Error(
        "This application is already assigned to another candidate.",
      );
    }

    const message =
      "error" in result.error && "message" in result.error.error
        ? result.error.error.message
        : "Candidate could not be assigned.";

    throw new Error(message);
  }

  redirect(`/applications/${encodeURIComponent(applicationId)}`);
}
