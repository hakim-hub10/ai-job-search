import { createCoachOperationsWebWorkflow } from "./coach-operations";

export async function loadCandidateNotes(candidateId: string) {
  const workflow = createCoachOperationsWebWorkflow();

  if (!workflow) {
    return {
      configured: false as const,
      notes: [],
      error: null,
    };
  }

  const result = await workflow.listNotes(candidateId);

  if (!result.ok) {
    return {
      configured: true as const,
      notes: [],
      error: result.error,
    };
  }

  return {
    configured: true as const,
    notes: result.value,
    error: null,
  };
}
