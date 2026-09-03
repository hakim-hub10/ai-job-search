"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createCandidateFollowUpWebWorkflow } from "@/lib/candidate-follow-ups";

function candidatePath(candidateId: string) {
  return `/candidates/${encodeURIComponent(candidateId)}`;
}

function localDateTimeToUtc(value: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Follow-up due date is invalid.");
  }

  return parsed.toISOString();
}

export async function createFollowUpAction(formData: FormData) {
  const candidateIdValue = formData.get("candidateId");
  const applicationIdValue = formData.get("applicationId");
  const dueAtValue = formData.get("dueAt");

  const candidateId =
    typeof candidateIdValue === "string" ? candidateIdValue.trim() : "";

  const applicationId =
    typeof applicationIdValue === "string"
      ? applicationIdValue.trim()
      : "";

  const dueAt =
    typeof dueAtValue === "string" ? dueAtValue.trim() : "";

  if (!candidateId) {
    throw new Error("Candidate ID is required.");
  }

  if (!dueAt) {
    throw new Error("Follow-up due date is required.");
  }

  const workflow = createCandidateFollowUpWebWorkflow();

  if (!workflow) {
    throw new Error(
      "COACH_DIR and APPLICATION_REPOSITORY must be configured.",
    );
  }

  const now = new Date().toISOString();

  const result = await workflow.createCandidateFollowUp({
    id: randomUUID(),
    candidateId,
    ...(applicationId ? { applicationId } : {}),
    dueAt: localDateTimeToUtc(dueAt),
    createdAt: now,
    updatedAt: now,
  });

  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }

  redirect(candidatePath(candidateId));
}

export async function completeFollowUpAction(formData: FormData) {
  const candidateIdValue = formData.get("candidateId");
  const followUpIdValue = formData.get("followUpId");

  const candidateId =
    typeof candidateIdValue === "string" ? candidateIdValue.trim() : "";

  const followUpId =
    typeof followUpIdValue === "string" ? followUpIdValue.trim() : "";

  if (!candidateId || !followUpId) {
    throw new Error("Candidate ID and follow-up ID are required.");
  }

  const workflow = createCandidateFollowUpWebWorkflow();

  if (!workflow) {
    throw new Error(
      "COACH_DIR and APPLICATION_REPOSITORY must be configured.",
    );
  }

  const result = await workflow.completeCandidateFollowUp({
    candidateId,
    followUpId,
    completedAt: new Date().toISOString(),
  });

  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }

  redirect(candidatePath(candidateId));
}

import { createCoachOperationsWebWorkflow } from "@/lib/coach-operations";

const goalStatuses = new Set([
  "planned",
  "inProgress",
  "completed",
  "cancelled",
]);

export async function createGoalAction(formData: FormData) {
  const candidateIdValue = formData.get("candidateId");
  const titleValue = formData.get("title");
  const descriptionValue = formData.get("description");
  const dueAtValue = formData.get("dueAt");

  const candidateId =
    typeof candidateIdValue === "string" ? candidateIdValue.trim() : "";

  const title =
    typeof titleValue === "string" ? titleValue.trim() : "";

  const description =
    typeof descriptionValue === "string" ? descriptionValue.trim() : "";

  const dueAt =
    typeof dueAtValue === "string" ? dueAtValue.trim() : "";

  if (!candidateId) {
    throw new Error("Candidate ID is required.");
  }

  if (!title) {
    throw new Error("Goal title is required.");
  }

  const workflow = createCoachOperationsWebWorkflow();

  if (!workflow) {
    throw new Error(
      "COACH_DIR and APPLICATION_REPOSITORY must be configured.",
    );
  }

  const createdAt = new Date().toISOString();

  const result = await workflow.createGoal({
    id: randomUUID(),
    candidateId,
    title,
    ...(description ? { description } : {}),
    ...(dueAt ? { dueAt: localDateTimeToUtc(dueAt) } : {}),
    createdAt,
  });

  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }

  redirect(candidatePath(candidateId));
}

export async function transitionGoalAction(formData: FormData) {
  const candidateIdValue = formData.get("candidateId");
  const goalIdValue = formData.get("goalId");
  const statusValue = formData.get("status");

  const candidateId =
    typeof candidateIdValue === "string" ? candidateIdValue.trim() : "";

  const goalId =
    typeof goalIdValue === "string" ? goalIdValue.trim() : "";

  const status =
    typeof statusValue === "string" ? statusValue.trim() : "";

  if (!candidateId || !goalId || !goalStatuses.has(status)) {
    throw new Error("Candidate ID, goal ID, and valid status are required.");
  }

  const workflow = createCoachOperationsWebWorkflow();

  if (!workflow) {
    throw new Error(
      "COACH_DIR and APPLICATION_REPOSITORY must be configured.",
    );
  }

  const result = await workflow.transitionGoal(
    goalId,
    candidateId,
    {
      status: status as "planned" | "inProgress" | "completed" | "cancelled",
      updatedAt: new Date().toISOString(),
    },
  );

  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }

  revalidatePath(candidatePath(candidateId));
  redirect(candidatePath(candidateId));
}

const activityKinds = new Set([
  "applyForJob",
  "updateCv",
  "contactEmployer",
  "attendInterview",
  "completeCourseStep",
  "coachingMeeting",
]);

const activityStatuses = new Set([
  "planned",
  "completed",
  "cancelled",
]);

export async function createActivityAction(formData: FormData) {
  const candidateIdValue = formData.get("candidateId");
  const kindValue = formData.get("kind");
  const plannedAtValue = formData.get("plannedAt");

  const candidateId =
    typeof candidateIdValue === "string" ? candidateIdValue.trim() : "";

  const kind =
    typeof kindValue === "string" ? kindValue.trim() : "";

  const plannedAt =
    typeof plannedAtValue === "string" ? plannedAtValue.trim() : "";

  if (!candidateId || !activityKinds.has(kind)) {
    throw new Error("Candidate ID and valid activity kind are required.");
  }

  const workflow = createCoachOperationsWebWorkflow();

  if (!workflow) {
    throw new Error(
      "COACH_DIR and APPLICATION_REPOSITORY must be configured.",
    );
  }

  const createdAt = new Date().toISOString();

  const result = await workflow.createActivity({
    id: randomUUID(),
    candidateId,
    kind: kind as
      | "applyForJob"
      | "updateCv"
      | "contactEmployer"
      | "attendInterview"
      | "completeCourseStep"
      | "coachingMeeting",
    ...(plannedAt
      ? { plannedAt: localDateTimeToUtc(plannedAt) }
      : {}),
    createdAt,
  });

  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }

  revalidatePath(candidatePath(candidateId));
  redirect(candidatePath(candidateId));
}

export async function transitionActivityAction(formData: FormData) {
  const candidateIdValue = formData.get("candidateId");
  const activityIdValue = formData.get("activityId");
  const statusValue = formData.get("status");

  const candidateId =
    typeof candidateIdValue === "string" ? candidateIdValue.trim() : "";

  const activityId =
    typeof activityIdValue === "string" ? activityIdValue.trim() : "";

  const status =
    typeof statusValue === "string" ? statusValue.trim() : "";

  if (
    !candidateId ||
    !activityId ||
    !activityStatuses.has(status)
  ) {
    throw new Error(
      "Candidate ID, activity ID, and valid status are required.",
    );
  }

  const workflow = createCoachOperationsWebWorkflow();

  if (!workflow) {
    throw new Error(
      "COACH_DIR and APPLICATION_REPOSITORY must be configured.",
    );
  }

  const result = await workflow.transitionActivity(
    activityId,
    candidateId,
    {
      status: status as "planned" | "completed" | "cancelled",
      updatedAt: new Date().toISOString(),
    },
  );

  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }

  revalidatePath(candidatePath(candidateId));
  redirect(candidatePath(candidateId));
}

export async function createNoteAction(formData: FormData) {
  const candidateIdValue = formData.get("candidateId");
  const textValue = formData.get("text");

  const candidateId =
    typeof candidateIdValue === "string" ? candidateIdValue.trim() : "";

  const text =
    typeof textValue === "string" ? textValue.trim() : "";

  if (!candidateId || !text) {
    throw new Error("Candidate ID and note text are required.");
  }

  const workflow = createCoachOperationsWebWorkflow();

  if (!workflow) {
    throw new Error(
      "COACH_DIR and APPLICATION_REPOSITORY must be configured.",
    );
  }

  const createdAt = new Date().toISOString();

  const result = await workflow.createNote({
    id: randomUUID(),
    candidateId,
    text,
    createdAt,
  });

  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }

  revalidatePath(candidatePath(candidateId));
  redirect(candidatePath(candidateId));
}

export async function updateNoteAction(formData: FormData) {
  const candidateIdValue = formData.get("candidateId");
  const noteIdValue = formData.get("noteId");
  const textValue = formData.get("text");

  const candidateId =
    typeof candidateIdValue === "string" ? candidateIdValue.trim() : "";

  const noteId =
    typeof noteIdValue === "string" ? noteIdValue.trim() : "";

  const text =
    typeof textValue === "string" ? textValue.trim() : "";

  if (!candidateId || !noteId || !text) {
    throw new Error(
      "Candidate ID, note ID, and note text are required.",
    );
  }

  const workflow = createCoachOperationsWebWorkflow();

  if (!workflow) {
    throw new Error(
      "COACH_DIR and APPLICATION_REPOSITORY must be configured.",
    );
  }

  const result = await workflow.updateNote(
    noteId,
    candidateId,
    {
      text,
      updatedAt: new Date().toISOString(),
    },
  );

  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }

  revalidatePath(candidatePath(candidateId));
  redirect(candidatePath(candidateId));
}
