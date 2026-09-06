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
import { createCoverLetter } from "@/lib/cover-letter";
import {
  buildApplicationDocumentFoundation,
  createTailoringPlan,
  generateDocumentProposal,
  renderGeneratedApplicationDocument,
  createOpenAIDocumentGenerator,
} from "../../../../.agents/job-search/cli/src/index";
import {
  createConfiguredDocumentEditorDependencies,
  type DocumentRewriteProviderRequest,
  requestDocumentAiRewrite,
  saveDocumentEdit,
} from "@/lib/document-editor";
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

export async function createCoverLetterAction(formData: FormData) {
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
  const result = await createCoverLetter(
    { applicationId },
    {
      applicationRepository: createFileApplicationRepository(resolve(applicationRepositoryPath)),
      associationRepository: createFileCandidateApplicationAssociationRepository(paths.associations),
      candidateRepository: createFileCoachWorkspaceRepository(paths.candidates),
      profileRepository: loadCandidateProfileRepository().repository!,
      documentRepository: createFileApplicationDocumentRepository(resolve(documentRepositoryPath)),
    },
  );

  if (!result.ok) {
    const messages: Record<string, string> = {
      APPLICATION_NOT_FOUND: "Ansökan hittades inte.",
      ASSOCIATION_NOT_FOUND: "Ansökan saknar kandidatkoppling.",
      CANDIDATE_NOT_FOUND: "Den kopplade kandidaten hittades inte.",
      PROFILE_NOT_FOUND: "Kandidatprofil saknas.",
      APPLICATION_STORAGE_FAILURE: "Ansökningsarkivet kunde inte läsas.",
      ASSOCIATION_STORAGE_FAILURE: "Kandidatkopplingen kunde inte läsas.",
      CANDIDATE_STORAGE_FAILURE: "Kandidatregistret kunde inte läsas.",
      PROFILE_STORAGE_FAILURE: "Kandidatprofilen kunde inte läsas.",
      TAILORING_FAILED: "Det personliga brevet kunde inte skapas.",
      DOCUMENT_STORAGE_FAILURE: "Det personliga brevet kunde inte sparas.",
    };
    throw new Error(messages[result.code] ?? "Det personliga brevet kunde inte skapas.");
  }

  revalidatePath(`/applications/${encodeURIComponent(applicationId)}`);
  revalidatePath(`/applications/${encodeURIComponent(applicationId)}/documents/cover-letter`);
  redirect(`/applications/${encodeURIComponent(applicationId)}`);
}

export async function saveDocumentEditAction(formData: FormData) {
  const applicationId = typeof formData.get("applicationId") === "string"
    ? String(formData.get("applicationId")).trim()
    : "";
  const documentType = typeof formData.get("documentType") === "string"
    ? String(formData.get("documentType")).trim()
    : "";
  const content = typeof formData.get("content") === "string"
    ? String(formData.get("content"))
    : "";
  const dependencies = createConfiguredDocumentEditorDependencies();

  if (!dependencies) throw new Error("Dokumentvyn är inte fullständigt konfigurerad.");
  const result = await saveDocumentEdit(
    { applicationId, documentType, content },
    dependencies,
  );

  if (!result.ok) throw new Error(result.message);
  const documentPath = documentType === "coverLetter" ? "cover-letter" : documentType;
  revalidatePath(`/applications/${encodeURIComponent(applicationId)}`);
  revalidatePath(`/applications/${encodeURIComponent(applicationId)}/documents/${documentPath}`);
  redirect(`/applications/${encodeURIComponent(applicationId)}/documents/${documentPath}`);
}

export async function requestDocumentAiRewriteAction(formData: FormData) {
  const applicationId = typeof formData.get("applicationId") === "string"
    ? String(formData.get("applicationId")).trim()
    : "";
  const documentType = typeof formData.get("documentType") === "string"
    ? String(formData.get("documentType")).trim()
    : "";
  const mode = typeof formData.get("rewriteMode") === "string"
    ? String(formData.get("rewriteMode")).trim()
    : "";
  const currentDraft = typeof formData.get("currentDraft") === "string"
    ? String(formData.get("currentDraft"))
    : "";
  const dependencies = createConfiguredDocumentEditorDependencies();

  if (!dependencies) {
    return { ok: false as const, code: "AI_UNAVAILABLE", message: "AI-assistans är inte konfigurerad." };
  }

  const enabled = process.env.AI_DOCUMENTS_ENABLED === "true";
  const consent = process.env.AI_REMOTE_GENERATION_CONSENT === "true";
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  if (!enabled || !consent || !apiKey) {
    return { ok: false as const, code: "AI_UNAVAILABLE", message: "AI-assistans är inte konfigurerad." };
  }

  const provider = {
    async rewrite(request: DocumentRewriteProviderRequest) {
      const generator = createOpenAIDocumentGenerator({
        enabled,
        remoteGenerationConsent: consent,
        apiKey,
        model: process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
        maxOutputTokens: 1200,
        timeoutMs: 30_000,
      });
      const foundation = buildApplicationDocumentFoundation(request.application, {
        evidence: request.candidateEvidence,
      });
      if (!foundation.ok) return { ok: false as const, message: "AI-förslaget kunde inte valideras." };
      const plan = createTailoringPlan(foundation.value, {
        type: request.documentType,
        language: "sv",
      });
      if (!plan.ok) return { ok: false as const, message: "AI-förslaget kunde inte valideras." };
      const generated = await generateDocumentProposal(foundation.value, plan.value, generator, {
        untrustedJobDescription: request.untrustedJobContext.description ?? undefined,
      });
      if (!generated.ok) return { ok: false as const, message: "AI-förslaget kunde inte skapas." };
      const document = {
        applicationId: request.applicationId,
        documentType: request.documentType,
        language: "sv" as const,
        requiresHumanReview: generated.value.requiresHumanReview,
        warnings: [],
        sections: generated.value.proposal.sections,
      };
      const rendered = renderGeneratedApplicationDocument(document);
      if (!rendered.ok) return { ok: false as const, message: "AI-förslaget kunde inte valideras." };
      return {
        ok: true as const,
        value: {
          content: rendered.value.content,
          evidenceIds: document.sections.flatMap((section) => section.claims.flatMap((claim) => claim.evidenceIds)),
        },
      };
    },
  };

  return requestDocumentAiRewrite(
    { applicationId, documentType, mode, currentDraft },
    dependencies,
    provider,
  );
}
