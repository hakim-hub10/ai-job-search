"use server";

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { redirect } from "next/navigation";

import { createCoachCandidateWorkflow } from "../../../../.agents/job-search/cli/src/coach-candidate-workflow";
import { createFileCoachWorkspaceRepository } from "../../../../.agents/job-search/cli/src/coach-workspace-file-repository";
import { resolveCoachRepositoryPaths } from "../../../../.agents/job-search/cli/src/coach-cli-paths";
import { getAuthenticatedUser } from "@/lib/auth-session";

export async function createCandidateAction(formData: FormData) {
  if (await getAuthenticatedUser()) {
    throw new Error("Kandidatens arbetsyta skapas genom det personliga onboardingflödet.");
  }
  const coachDir = process.env.COACH_DIR;

  if (!coachDir) {
    throw new Error("COACH_DIR is not configured.");
  }

  const displayNameValue = formData.get("displayName");
  const displayName =
    typeof displayNameValue === "string" ? displayNameValue.trim() : "";

  const paths = resolveCoachRepositoryPaths(resolve(coachDir));
  const repository = createFileCoachWorkspaceRepository(paths.candidates);
  const workflow = createCoachCandidateWorkflow(repository);

  const result = await workflow.createCandidate({
    id: randomUUID(),
    displayName,
    createdAt: new Date().toISOString(),
  });

  if (!result.ok) {
    const message =
      result.error.kind === "candidate_domain"
        ? result.error.error.message
        : "Candidate could not be saved.";

    throw new Error(message);
  }

  redirect(`/candidates/${result.value.id}`);
}
