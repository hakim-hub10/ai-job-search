"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  initializeCandidateBaseCv,
  updateCandidateBaseCv,
} from "@/lib/candidate-base-cv-state";
import type { CandidateBaseCvVisibility } from "@/lib/candidate-base-cv";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function visibility(formData: FormData): CandidateBaseCvVisibility {
  return {
    headline: formData.get("visibility.headline") === "on",
    summary: formData.get("visibility.summary") === "on",
    workExperience: formData.get("visibility.workExperience") === "on",
    education: formData.get("visibility.education") === "on",
    technicalSkills: formData.get("visibility.technicalSkills") === "on",
    softSkills: formData.get("visibility.softSkills") === "on",
    certifications: formData.get("visibility.certifications") === "on",
    languages: formData.get("visibility.languages") === "on",
  };
}

function throwForFailure(message: string, error: { code: string }): never {
  const messages: Record<string, string> = {
    CONFIGURATION_MISSING: "Jobbcoachens arbetsyta är inte konfigurerad.",
    INVALID_CANDIDATE_ID: "Kandidatens ID saknas.",
    CANDIDATE_NOT_FOUND: "Kandidaten hittades inte.",
    CANDIDATE_STORAGE_FAILURE: "Kandidatregistret kunde inte läsas.",
    PROFILE_NOT_FOUND: "Kandidatprofil saknas. Lägg till profilinformation innan du skapar ett grund-CV.",
    PROFILE_STORAGE_FAILURE: "Kandidatprofilen kunde inte läsas.",
    BASE_CV_STORAGE_FAILURE: "Grund-CV-lagringen kunde inte uppdateras.",
    BASE_CV_NOT_FOUND: "Grund-CV:t är inte skapat ännu.",
    BASE_CV_INVALID_INPUT: "Grund-CV:ts presentation är ogiltig.",
  };
  throw new Error(messages[error.code] ?? message);
}

export async function createBaseCvAction(formData: FormData) {
  const candidateId = text(formData, "candidateId");
  const result = await initializeCandidateBaseCv(candidateId);

  if (!result.ok) throwForFailure("Grund-CV:t kunde inte skapas.", result);

  revalidatePath(`/candidates/${encodeURIComponent(candidateId)}`);
  redirect(`/candidates/${encodeURIComponent(candidateId)}`);
}

export async function updateBaseCvAction(formData: FormData) {
  const candidateId = text(formData, "candidateId");
  const result = await updateCandidateBaseCv(candidateId, {
    headline: text(formData, "headline"),
    summary: text(formData, "summary"),
    visibility: visibility(formData),
    updatedAt: new Date().toISOString(),
  });

  if (!result.ok) throwForFailure("Grund-CV:t kunde inte sparas.", result);

  revalidatePath(`/candidates/${encodeURIComponent(candidateId)}`);
  redirect(`/candidates/${encodeURIComponent(candidateId)}`);
}
