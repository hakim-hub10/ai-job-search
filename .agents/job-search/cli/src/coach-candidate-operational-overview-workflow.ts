import type { ApplicationRepository, ApplicationRepositoryError } from "./application-repository"
import type { CandidateApplicationAssociationRepository, CandidateApplicationAssociationRepositoryError } from "./coach-application-association-repository"
import type { CandidateFollowUpRepository, CandidateFollowUpRepositoryError } from "./coach-candidate-follow-up-repository"
import type { CoachActivity } from "./coach-activity"
import type { CoachGoal } from "./coach-goal"
import type { CoachNote } from "./coach-note"
import type { CoachOperationsRepository, CoachOperationsRepositoryError } from "./coach-operations-repository"
import { createCandidateOperationalOverview, type CandidateOperationalOverview, type CandidateOperationalOverviewError } from "./coach-candidate-operational-overview"
import { createCoachCandidateOverviewWorkflow, type CoachCandidateOverviewWorkflowError } from "./coach-candidate-overview-workflow"
import type { CoachCandidate } from "./coach-workspace"
import type { CoachWorkspaceRepository, CoachWorkspaceRepositoryError } from "./coach-workspace-repository"

export type CoachCandidateOperationalOverviewWorkflowError =
  | { kind: "operational_overview_domain"; error: CandidateOperationalOverviewError }
  | { kind: "candidate_repository"; error: CoachWorkspaceRepositoryError }
  | { kind: "candidate_overview"; error: CoachCandidateOverviewWorkflowError }
  | { kind: "operations_repository"; error: CoachOperationsRepositoryError }
  | { kind: "application_repository"; error: ApplicationRepositoryError }
  | { kind: "association_repository"; error: CandidateApplicationAssociationRepositoryError }
  | { kind: "follow_up_repository"; error: CandidateFollowUpRepositoryError }
  | { kind: "activity_application_mismatch"; activityId: string; applicationId: string; candidateId: string }
  | { kind: "operations_candidate_mismatch"; recordId: string; recordType: "note" | "goal" | "activity"; candidateId: string }

export type CoachCandidateOperationalOverviewWorkflowResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CoachCandidateOperationalOverviewWorkflowError }

export interface CoachCandidateOperationalOverviewWorkflow {
  getCandidateOperationalOverview(candidateId: string, asOf: string): Promise<CoachCandidateOperationalOverviewWorkflowResult<CandidateOperationalOverview>>
}

function candidateFailure(error: CoachWorkspaceRepositoryError): CoachCandidateOperationalOverviewWorkflowResult<never> { return { ok: false, error: { kind: "candidate_repository", error } } }

export function createCoachCandidateOperationalOverviewWorkflow(
  candidates: CoachWorkspaceRepository,
  applications: ApplicationRepository,
  associations: CandidateApplicationAssociationRepository,
  followUps: CandidateFollowUpRepository,
  operations: CoachOperationsRepository,
): CoachCandidateOperationalOverviewWorkflow {
  const candidateOverviewWorkflow = createCoachCandidateOverviewWorkflow(candidates, applications, associations, followUps)
  async function loadCandidate(candidateId: string): Promise<CoachCandidateOperationalOverviewWorkflowResult<CoachCandidate>> {
    const result = await candidates.getCandidateById(candidateId)
    return result.ok ? { ok: true, value: result.value } : candidateFailure(result.error)
  }
  async function validateActivityOwnership(candidateId: string, activity: CoachActivity): Promise<CoachCandidateOperationalOverviewWorkflowResult<void>> {
    if (activity.applicationId === undefined) return { ok: true, value: undefined }
    const application = await applications.getById(activity.applicationId)
    if (!application.ok) return { ok: false, error: { kind: "application_repository", error: application.error } }
    const association = await associations.getByApplicationId(activity.applicationId)
    if (!association.ok) {
      return association.error.code === "NOT_FOUND"
        ? { ok: false, error: { kind: "activity_application_mismatch", activityId: activity.id, applicationId: activity.applicationId, candidateId } }
        : { ok: false, error: { kind: "association_repository", error: association.error } }
    }
    return association.value.candidateId === candidateId
      ? { ok: true, value: undefined }
      : { ok: false, error: { kind: "activity_application_mismatch", activityId: activity.id, applicationId: activity.applicationId, candidateId } }
  }
  return {
    async getCandidateOperationalOverview(candidateId, asOf) {
      const candidate = await loadCandidate(candidateId)
      if (!candidate.ok) return candidate
      const overview = await candidateOverviewWorkflow.getCandidateOverview(candidate.value.id, asOf)
      if (!overview.ok) return { ok: false, error: { kind: "candidate_overview", error: overview.error } }
      const [notes, goals, activities] = await Promise.all([
        operations.listNotesByCandidateId(candidate.value.id),
        operations.listGoalsByCandidateId(candidate.value.id),
        operations.listActivitiesByCandidateId(candidate.value.id),
      ])
      if (!notes.ok) return { ok: false, error: { kind: "operations_repository", error: notes.error } }
      if (!goals.ok) return { ok: false, error: { kind: "operations_repository", error: goals.error } }
      if (!activities.ok) return { ok: false, error: { kind: "operations_repository", error: activities.error } }
      const mismatchedNote = notes.value.find((note: CoachNote) => note.candidateId !== candidate.value.id)
      if (mismatchedNote) return { ok: false, error: { kind: "operations_candidate_mismatch", recordId: mismatchedNote.id, recordType: "note", candidateId: candidate.value.id } }
      const mismatchedGoal = goals.value.find((goal: CoachGoal) => goal.candidateId !== candidate.value.id)
      if (mismatchedGoal) return { ok: false, error: { kind: "operations_candidate_mismatch", recordId: mismatchedGoal.id, recordType: "goal", candidateId: candidate.value.id } }
      const mismatchedActivity = activities.value.find((activity: CoachActivity) => activity.candidateId !== candidate.value.id)
      if (mismatchedActivity) return { ok: false, error: { kind: "operations_candidate_mismatch", recordId: mismatchedActivity.id, recordType: "activity", candidateId: candidate.value.id } }
      for (const activity of activities.value) {
        const ownership = await validateActivityOwnership(candidate.value.id, activity)
        if (!ownership.ok) return ownership
      }
      const derived = createCandidateOperationalOverview({ candidate: candidate.value, overview: overview.value, notes: notes.value, goals: goals.value, activities: activities.value, asOf })
      return derived.ok ? derived : { ok: false, error: { kind: "operational_overview_domain", error: derived.error } }
    },
  }
}