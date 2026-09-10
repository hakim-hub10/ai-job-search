"use server";

import { resolve } from "node:path";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parseCandidateProfile } from "../../../../../.agents/job-search/cli/src/profile-input";
import { createFileCoachWorkspaceRepository } from "../../../../../.agents/job-search/cli/src/coach-workspace-file-repository";
import { resolveCoachRepositoryPaths } from "../../../../../.agents/job-search/cli/src/coach-cli-paths";
import { loadCandidateProfileRepository } from "@/lib/candidate-profiles";
import { configuredAuthorizationDependencies, requireOwnedCandidate } from "@/lib/authorization";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function lines(formData: FormData, name: string): string[] {
  return text(formData, name)
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function number(formData: FormData, name: string): number {
  const value = text(formData, name);
  const parsed = Number(value);

  if (!value || !Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }

  return parsed;
}

export async function saveCandidateProfileAction(formData: FormData) {
  const candidateId = text(formData, "candidateId");

  if (!candidateId) {
    throw new Error("Candidate ID is required.");
  }

  const authorization = configuredAuthorizationDependencies();
  const owned = authorization.ok ? await requireOwnedCandidate(candidateId, authorization.value) : authorization;
  if (!owned.ok) throw new Error("Kandidatprofilen kunde inte sparas.");

  const coachDir = process.env.COACH_DIR?.trim();

  if (!coachDir) {
    throw new Error("COACH_DIR is not configured.");
  }

  const paths = resolveCoachRepositoryPaths(resolve(coachDir));
  const candidates = createFileCoachWorkspaceRepository(paths.candidates);
  const candidate = await candidates.getCandidateById(candidateId);

  if (!candidate.ok) {
    if (candidate.error.code === "NOT_FOUND") {
      throw new Error("Candidate was not found.");
    }

    throw new Error("Candidate repository could not be read.");
  }

  const context = loadCandidateProfileRepository();

  if (!context.configured || !context.repository) {
    throw new Error("COACH_DIR is not configured.");
  }

  const existing = await context.repository.getProfileByCandidateId(candidateId);

  if (!existing.ok && existing.error.code !== "NOT_FOUND") {
    throw new Error("Candidate profile could not be read.");
  }

  const profile = parseCandidateProfile({
    headline: text(formData, "headline"),
    targetRoles: lines(formData, "targetRoles"),
    locationPreferences: lines(formData, "locationPreferences"),
    workMode: text(formData, "workMode"),
    remotePreference: formData.get("remotePreference") === "on",
    preferredIndustries: lines(formData, "preferredIndustries"),
    preferredEmploymentType: formData.getAll("preferredEmploymentType"),
    skills: {
      technical: lines(formData, "technicalSkills"),
      soft: lines(formData, "softSkills"),
    },
    workExperience: existing.ok
      ? existing.value.profile.workExperience
      : [],
    education: existing.ok
      ? existing.value.profile.education
      : [],
    certifications: lines(formData, "certifications"),
    languages: lines(formData, "languages").map((entry) => {
      const separator = entry.indexOf("|");

      if (separator === -1) {
        throw new Error(
          "Each language must use the format Language | Level.",
        );
      }

      const name = entry.slice(0, separator).trim();
      const level = entry.slice(separator + 1).trim();

      if (!name || !level) {
        throw new Error(
          "Each language must include both language and level.",
        );
      }

      return { name, level };
    }),
    yearsOfExperience: number(formData, "yearsOfExperience"),
    careerGoals: lines(formData, "careerGoals"),
    ...(text(formData, "summary")
      ? { summary: text(formData, "summary") }
      : {}),
    updatedAt: new Date().toISOString(),
  });

  const saved = await context.repository.saveProfile(candidateId, profile);

  if (!saved.ok) {
    throw new Error("Candidate profile could not be saved.");
  }

  revalidatePath(`/candidates/${candidateId}`);
  revalidatePath("/jobs");

  redirect(`/candidates/${encodeURIComponent(candidateId)}`);
}
