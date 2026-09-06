"use server";

import { resolve } from "node:path";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createFileApplicationRepository } from "../../../../.agents/job-search/cli/src/application-file-repository";
import { createFileApplicationDocumentRepository } from "../../../../.agents/job-search/cli/src/application-document-file-repository";
import { createFileCandidateBaseCvRepository } from "@/lib/candidate-base-cv-file-repository";
import { createFileCandidateApplicationAssociationRepository } from "../../../../.agents/job-search/cli/src/coach-application-association-file-repository";
import { resolveCoachRepositoryPaths } from "../../../../.agents/job-search/cli/src/coach-cli-paths";
import { createFileCoachWorkspaceRepository } from "../../../../.agents/job-search/cli/src/coach-workspace-file-repository";
import { loadCandidateProfileRepository } from "@/lib/candidate-profiles";
import { createTailoredCv } from "@/lib/tailored-cv";
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
    throw new Error("Ansökningsarkivet är inte konfigurerat.");
  }

  const applicationIdValue = formData.get("applicationId");
  const statusValue = formData.get("status");

  const applicationId =
    typeof applicationIdValue === "string" ? applicationIdValue.trim() : "";

  const status =
    typeof statusValue === "string" ? statusValue.trim() : "";

  if (!applicationId) {
    throw new Error("Ansökans ID saknas.");
  }

  if (!APPLICATION_STATUSES.has(status as ApplicationStatus)) {
    throw new Error("Statusen kunde inte användas.");
  }

  const repository = createFileApplicationRepository(resolve(repositoryPath));
  const workflow = createApplicationWorkflow(repository);

  const result = await workflow.updateApplicationStatusAndSave({
    applicationId,
    status: status as ApplicationStatus,
    timestamp: new Date().toISOString(),
  });

  if (!result.ok) {
    throw new Error("Ansökans status kunde inte uppdateras.");
  }

  redirect(`/applications/${encodeURIComponent(applicationId)}`);
}

export async function associateApplicationCandidateAction(formData: FormData) {
  const coachDir = process.env.COACH_DIR;
  const repositoryPath = process.env.APPLICATION_REPOSITORY;

  if (!coachDir) {
    throw new Error("Jobbcoachens arbetsyta är inte konfigurerad.");
  }

  if (!repositoryPath) {
    throw new Error("Ansökningsarkivet är inte konfigurerat.");
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
    throw new Error("Ansökan och kandidat måste anges.");
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
        throw new Error("Ansökan är redan kopplad till den här kandidaten.");
      }

      throw new Error("Ansökan är redan kopplad till en annan kandidat.");
    }

    throw new Error("Kandidaten kunde inte kopplas till ansökan.");
  }

  redirect(`/applications/${encodeURIComponent(applicationId)}`);
}

export async function createTailoredCvAction(formData: FormData) {
  const applicationIdValue = formData.get("applicationId");
  const applicationId =
    typeof applicationIdValue === "string" ? applicationIdValue.trim() : "";
  const coachDir = process.env.COACH_DIR?.trim();
  const applicationRepositoryPath = process.env.APPLICATION_REPOSITORY?.trim();
  const documentRepositoryPath = process.env.APPLICATION_DOCUMENT_REPOSITORY?.trim();

  if (!applicationId) throw new Error("Ansökans ID saknas.");
  if (!coachDir || !applicationRepositoryPath || !documentRepositoryPath) {
    throw new Error("Dokumentvyn är inte fullständigt konfigurerad.");
  }

  const paths = resolveCoachRepositoryPaths(resolve(coachDir));
  const result = await createTailoredCv(
    { applicationId },
    {
      applicationRepository: createFileApplicationRepository(resolve(applicationRepositoryPath)),
      associationRepository: createFileCandidateApplicationAssociationRepository(paths.associations),
      candidateRepository: createFileCoachWorkspaceRepository(paths.candidates),
      profileRepository: loadCandidateProfileRepository().repository!,
      baseCvRepository: createFileCandidateBaseCvRepository(resolve(coachDir, "candidate-cvs.json")),
      documentRepository: createFileApplicationDocumentRepository(resolve(documentRepositoryPath)),
    },
  );

  if (!result.ok) {
    const messages: Record<string, string> = {
      APPLICATION_NOT_FOUND: "Ansökan hittades inte.",
      ASSOCIATION_NOT_FOUND: "Ansökan saknar kandidatkoppling.",
      CANDIDATE_NOT_FOUND: "Den kopplade kandidaten hittades inte.",
      PROFILE_NOT_FOUND: "Kandidatprofil saknas.",
      BASE_CV_NOT_FOUND: "Grund-CV saknas. Skapa ett grund-CV innan du skapar ett anpassat CV.",
      APPLICATION_STORAGE_FAILURE: "Ansökningsarkivet kunde inte läsas.",
      ASSOCIATION_STORAGE_FAILURE: "Kandidatkopplingen kunde inte läsas.",
      CANDIDATE_STORAGE_FAILURE: "Kandidatregistret kunde inte läsas.",
      PROFILE_STORAGE_FAILURE: "Kandidatprofilen kunde inte läsas.",
      BASE_CV_STORAGE_FAILURE: "Grund-CV-lagringen kunde inte läsas.",
      TAILORING_FAILED: "Det anpassade CV:t kunde inte skapas.",
      DOCUMENT_STORAGE_FAILURE: "Det anpassade CV:t kunde inte sparas.",
    };
    throw new Error(messages[result.code] ?? "Det anpassade CV:t kunde inte skapas.");
  }

  revalidatePath(`/applications/${encodeURIComponent(applicationId)}`);
  revalidatePath(`/applications/${encodeURIComponent(applicationId)}/documents/cv`);
  redirect(`/applications/${encodeURIComponent(applicationId)}`);
}
