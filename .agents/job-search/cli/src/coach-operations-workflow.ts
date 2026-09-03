import { createCoachActivity, transitionCoachActivity, updateCoachActivity, type CoachActivity, type CoachActivityError, type CreateCoachActivityInput, type TransitionCoachActivityInput, type UpdateCoachActivityInput } from "./coach-activity"
import { createCoachGoal, transitionCoachGoal, updateCoachGoal, type CoachGoal, type CoachGoalError, type CreateCoachGoalInput, type TransitionCoachGoalInput, type UpdateCoachGoalInput } from "./coach-goal"
import { createCoachNote, updateCoachNote, type CoachNote, type CoachNoteError, type CreateCoachNoteInput, type UpdateCoachNoteInput } from "./coach-note"
import type { CoachOperationsRepository, CoachOperationsRepositoryError } from "./coach-operations-repository"
import type { ApplicationRepository, ApplicationRepositoryError } from "./application-repository"
import type { CandidateApplicationAssociationRepository, CandidateApplicationAssociationRepositoryError } from "./coach-application-association-repository"
import type { CoachWorkspaceRepository, CoachWorkspaceRepositoryError } from "./coach-workspace-repository"

export type CoachOperationsWorkflowError =
  | { kind: "candidate_repository"; error: CoachWorkspaceRepositoryError }
  | { kind: "application_repository"; error: ApplicationRepositoryError }
  | { kind: "association_repository"; error: CandidateApplicationAssociationRepositoryError }
  | { kind: "operations_repository"; error: CoachOperationsRepositoryError }
  | { kind: "note_domain"; error: CoachNoteError }
  | { kind: "goal_domain"; error: CoachGoalError }
  | { kind: "activity_domain"; error: CoachActivityError }
  | { kind: "application_candidate_mismatch"; applicationId: string; candidateId: string }
export type CoachOperationsWorkflowResult<T> = { ok: true; value: T } | { ok: false; error: CoachOperationsWorkflowError }
export interface CoachOperationsWorkflow {
  createNote(input: CreateCoachNoteInput): Promise<CoachOperationsWorkflowResult<CoachNote>>
  listNotes(candidateId: string): Promise<CoachOperationsWorkflowResult<CoachNote[]>>
  updateNote(noteId: string, candidateId: string, input: UpdateCoachNoteInput): Promise<CoachOperationsWorkflowResult<CoachNote>>
  createGoal(input: CreateCoachGoalInput): Promise<CoachOperationsWorkflowResult<CoachGoal>>
  listGoals(candidateId: string): Promise<CoachOperationsWorkflowResult<CoachGoal[]>>
  updateGoal(goalId: string, candidateId: string, input: UpdateCoachGoalInput): Promise<CoachOperationsWorkflowResult<CoachGoal>>
  transitionGoal(goalId: string, candidateId: string, input: TransitionCoachGoalInput): Promise<CoachOperationsWorkflowResult<CoachGoal>>
  createActivity(input: CreateCoachActivityInput): Promise<CoachOperationsWorkflowResult<CoachActivity>>
  listActivities(candidateId: string): Promise<CoachOperationsWorkflowResult<CoachActivity[]>>
  updateActivity(activityId: string, candidateId: string, input: UpdateCoachActivityInput): Promise<CoachOperationsWorkflowResult<CoachActivity>>
  transitionActivity(activityId: string, candidateId: string, input: TransitionCoachActivityInput): Promise<CoachOperationsWorkflowResult<CoachActivity>>
}
function candidateFailure(error: CoachWorkspaceRepositoryError): CoachOperationsWorkflowResult<never> { return { ok: false, error: { kind: "candidate_repository", error } } }
function operationsFailure<T>(result: { ok: false; error: CoachOperationsRepositoryError }): CoachOperationsWorkflowResult<T> { return { ok: false, error: { kind: "operations_repository", error: result.error } } }
export function createCoachOperationsWorkflow(candidates: CoachWorkspaceRepository, operations: CoachOperationsRepository, applications: ApplicationRepository, associations: CandidateApplicationAssociationRepository): CoachOperationsWorkflow {
  async function verifyCandidate(candidateId: string): Promise<CoachOperationsWorkflowResult<void>> { const result = await candidates.getCandidateById(candidateId); return result.ok ? { ok: true, value: undefined } : candidateFailure(result.error) }
  async function verifyApplication(candidateId: string, applicationId: string): Promise<CoachOperationsWorkflowResult<void>> {
    const application = await applications.getById(applicationId)
    if (!application.ok) return { ok: false, error: { kind: "application_repository", error: application.error } }
    const association = await associations.getByApplicationId(applicationId)
    if (!association.ok) return { ok: false, error: { kind: "association_repository", error: association.error } }
    return association.value.candidateId === candidateId ? { ok: true, value: undefined } : { ok: false, error: { kind: "application_candidate_mismatch", applicationId, candidateId } }
  }
  return {
    async createNote(input) { const candidate = await verifyCandidate(input?.candidateId); if (!candidate.ok) return candidate; const created = createCoachNote(input); if (!created.ok) return { ok: false, error: { kind: "note_domain", error: created.error } }; const result = await operations.createNote(created.value); return result.ok ? { ok: true, value: structuredClone(result.value) } : operationsFailure(result) },
    async listNotes(candidateId) { const candidate = await verifyCandidate(candidateId); if (!candidate.ok) return candidate; const result = await operations.listNotesByCandidateId(candidateId); return result.ok ? { ok: true, value: structuredClone(result.value) } : operationsFailure(result) },
    async updateNote(noteId, candidateId, input) { const candidate = await verifyCandidate(candidateId); if (!candidate.ok) return candidate; const loaded = await operations.getNoteById(noteId); if (!loaded.ok) return operationsFailure(loaded); if (loaded.value.candidateId !== candidateId) return { ok: false, error: { kind: "operations_repository", error: { code: "NOT_FOUND", message: "Coach note was not found." } } }; const updated = updateCoachNote(loaded.value, input); if (!updated.ok) return { ok: false, error: { kind: "note_domain", error: updated.error } }; const result = await operations.saveNote(updated.value); return result.ok ? { ok: true, value: structuredClone(result.value) } : operationsFailure(result) },
    async createGoal(input) { const candidate = await verifyCandidate(input?.candidateId); if (!candidate.ok) return candidate; const created = createCoachGoal(input); if (!created.ok) return { ok: false, error: { kind: "goal_domain", error: created.error } }; const result = await operations.createGoal(created.value); return result.ok ? { ok: true, value: structuredClone(result.value) } : operationsFailure(result) },
    async listGoals(candidateId) { const candidate = await verifyCandidate(candidateId); if (!candidate.ok) return candidate; const result = await operations.listGoalsByCandidateId(candidateId); return result.ok ? { ok: true, value: structuredClone(result.value) } : operationsFailure(result) },
    async updateGoal(goalId, candidateId, input) { const candidate = await verifyCandidate(candidateId); if (!candidate.ok) return candidate; const loaded = await operations.getGoalById(goalId); if (!loaded.ok) return operationsFailure(loaded); if (loaded.value.candidateId !== candidateId) return { ok: false, error: { kind: "operations_repository", error: { code: "NOT_FOUND", message: "Coach goal was not found." } } }; const updated = updateCoachGoal(loaded.value, input); if (!updated.ok) return { ok: false, error: { kind: "goal_domain", error: updated.error } }; const result = await operations.saveGoal(updated.value); return result.ok ? { ok: true, value: structuredClone(result.value) } : operationsFailure(result) },
    async transitionGoal(goalId, candidateId, input) { const candidate = await verifyCandidate(candidateId); if (!candidate.ok) return candidate; const loaded = await operations.getGoalById(goalId); if (!loaded.ok) return operationsFailure(loaded); if (loaded.value.candidateId !== candidateId) return { ok: false, error: { kind: "operations_repository", error: { code: "NOT_FOUND", message: "Coach goal was not found." } } }; const updated = transitionCoachGoal(loaded.value, input); if (!updated.ok) return { ok: false, error: { kind: "goal_domain", error: updated.error } }; const result = await operations.saveGoal(updated.value); return result.ok ? { ok: true, value: structuredClone(result.value) } : operationsFailure(result) },
    async createActivity(input) { const candidate = await verifyCandidate(input?.candidateId); if (!candidate.ok) return candidate; if (input.applicationId !== undefined) { const ownership = await verifyApplication(input.candidateId, input.applicationId); if (!ownership.ok) return ownership }; const created = createCoachActivity(input); if (!created.ok) return { ok: false, error: { kind: "activity_domain", error: created.error } }; const result = await operations.createActivity(created.value); return result.ok ? { ok: true, value: structuredClone(result.value) } : operationsFailure(result) },
    async listActivities(candidateId) { const candidate = await verifyCandidate(candidateId); if (!candidate.ok) return candidate; const result = await operations.listActivitiesByCandidateId(candidateId); return result.ok ? { ok: true, value: structuredClone(result.value) } : operationsFailure(result) },
    async updateActivity(activityId, candidateId, input) { const candidate = await verifyCandidate(candidateId); if (!candidate.ok) return candidate; const loaded = await operations.getActivityById(activityId); if (!loaded.ok) return operationsFailure(loaded); if (loaded.value.candidateId !== candidateId) return { ok: false, error: { kind: "operations_repository", error: { code: "NOT_FOUND", message: "Coach activity was not found." } } }; const updated = updateCoachActivity(loaded.value, input); if (!updated.ok) return { ok: false, error: { kind: "activity_domain", error: updated.error } }; const result = await operations.saveActivity(updated.value); return result.ok ? { ok: true, value: structuredClone(result.value) } : operationsFailure(result) },
    async transitionActivity(activityId, candidateId, input) { const candidate = await verifyCandidate(candidateId); if (!candidate.ok) return candidate; const loaded = await operations.getActivityById(activityId); if (!loaded.ok) return operationsFailure(loaded); if (loaded.value.candidateId !== candidateId) return { ok: false, error: { kind: "operations_repository", error: { code: "NOT_FOUND", message: "Coach activity was not found." } } }; const updated = transitionCoachActivity(loaded.value, input); if (!updated.ok) return { ok: false, error: { kind: "activity_domain", error: updated.error } }; const result = await operations.saveActivity(updated.value); return result.ok ? { ok: true, value: structuredClone(result.value) } : operationsFailure(result) },
  }
}