import type { ApplicationRepository, ApplicationRepositoryError } from "./application-repository"
import type { ApplicationStatus } from "./applications"
import type { CandidateApplicationAssociationRepository, CandidateApplicationAssociationRepositoryError } from "./coach-application-association-repository"
import type { CandidateFollowUp } from "./coach-candidate-follow-up"
import type { CandidateFollowUpRepository, CandidateFollowUpRepositoryError } from "./coach-candidate-follow-up-repository"
import type { CoachActivity } from "./coach-activity"
import type { CoachOperationsRepository, CoachOperationsRepositoryError } from "./coach-operations-repository"
import { createCandidateActivityReport, type CandidateActivityReport, type CandidateActivityReportError } from "./candidate-activity-report"
import type { CoachCandidate } from "./coach-workspace"
import type { CoachWorkspaceRepository, CoachWorkspaceRepositoryError } from "./coach-workspace-repository"

export type CandidateActivityReportWorkflowError =
  | { kind: "report_domain"; error: CandidateActivityReportError }
  | { kind: "candidate_repository"; error: CoachWorkspaceRepositoryError }
  | { kind: "association_repository"; error: CandidateApplicationAssociationRepositoryError }
  | { kind: "application_repository"; error: ApplicationRepositoryError }
  | { kind: "follow_up_repository"; error: CandidateFollowUpRepositoryError }
  | { kind: "operations_repository"; error: CoachOperationsRepositoryError }
  | { kind: "orphaned_application_reference"; applicationId: string; candidateId: string }
  | { kind: "application_candidate_mismatch"; applicationId: string; candidateId: string }
  | { kind: "follow_up_application_mismatch"; followUpId: string; applicationId: string; candidateId: string }
  | { kind: "activity_application_mismatch"; activityId: string; applicationId: string; candidateId: string }

export type CandidateActivityReportWorkflowResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CandidateActivityReportWorkflowError }

export interface CandidateActivityReportWorkflow {
  getCandidateActivityReport(
    candidateId: string,
    period: { startAt: string; endAt: string },
  ): Promise<CandidateActivityReportWorkflowResult<CandidateActivityReport>>
}

function candidateFailure(error: CoachWorkspaceRepositoryError): CandidateActivityReportWorkflowResult<never> {
  return { ok: false, error: { kind: "candidate_repository", error } }
}

function isNotFound(code: string): boolean { return code === "NOT_FOUND" }

export function createCandidateActivityReportWorkflow(
  candidates: CoachWorkspaceRepository,
  applications: ApplicationRepository,
  associations: CandidateApplicationAssociationRepository,
  followUps: CandidateFollowUpRepository,
  operations: CoachOperationsRepository,
): CandidateActivityReportWorkflow {
  async function loadCandidate(candidateId: string): Promise<CandidateActivityReportWorkflowResult<CoachCandidate>> {
    const result = await candidates.getCandidateById(candidateId)
    return result.ok ? { ok: true, value: result.value } : candidateFailure(result.error)
  }

  async function loadApplications(candidateId: string): Promise<CandidateActivityReportWorkflowResult<Array<{ id: string; status: ApplicationStatus; createdAt: string; statusHistory: Array<{ status: ApplicationStatus; timestamp: string }> }>>> {
    const listed = await associations.listByCandidateId(candidateId)
    if (!listed.ok) return { ok: false, error: { kind: "association_repository", error: listed.error } }
    const records = []
    for (const association of listed.value) {
      if (association.candidateId !== candidateId) return { ok: false, error: { kind: "application_candidate_mismatch", applicationId: association.applicationId, candidateId } }
      const application = await applications.getById(association.applicationId)
      if (!application.ok) return isNotFound(application.error.code)
        ? { ok: false, error: { kind: "orphaned_application_reference", applicationId: association.applicationId, candidateId } }
        : { ok: false, error: { kind: "application_repository", error: application.error } }
      records.push({ id: application.value.id, status: application.value.status, createdAt: application.value.createdAt, statusHistory: application.value.statusHistory.map((event) => ({ status: event.status, timestamp: event.timestamp })) })
    }
    return { ok: true, value: records }
  }

  async function validateFollowUp(candidateId: string, followUp: CandidateFollowUp): Promise<CandidateActivityReportWorkflowResult<void>> {
    if (followUp.applicationId === undefined) return { ok: true, value: undefined }
    const association = await associations.getByApplicationId(followUp.applicationId)
    if (!association.ok) return isNotFound(association.error.code)
      ? { ok: false, error: { kind: "follow_up_application_mismatch", followUpId: followUp.id, applicationId: followUp.applicationId, candidateId } }
      : { ok: false, error: { kind: "association_repository", error: association.error } }
    if (association.value.candidateId !== candidateId) return { ok: false, error: { kind: "follow_up_application_mismatch", followUpId: followUp.id, applicationId: followUp.applicationId, candidateId } }
    const application = await applications.getById(followUp.applicationId)
    if (!application.ok) return isNotFound(application.error.code)
      ? { ok: false, error: { kind: "orphaned_application_reference", applicationId: followUp.applicationId, candidateId } }
      : { ok: false, error: { kind: "application_repository", error: application.error } }
    return { ok: true, value: undefined }
  }

  async function validateActivity(candidateId: string, activity: CoachActivity): Promise<CandidateActivityReportWorkflowResult<void>> {
    if (activity.applicationId === undefined) return { ok: true, value: undefined }
    const association = await associations.getByApplicationId(activity.applicationId)
    if (!association.ok) return isNotFound(association.error.code)
      ? { ok: false, error: { kind: "activity_application_mismatch", activityId: activity.id, applicationId: activity.applicationId, candidateId } }
      : { ok: false, error: { kind: "association_repository", error: association.error } }
    if (association.value.candidateId !== candidateId) return { ok: false, error: { kind: "activity_application_mismatch", activityId: activity.id, applicationId: activity.applicationId, candidateId } }
    const application = await applications.getById(activity.applicationId)
    if (!application.ok) return isNotFound(application.error.code)
      ? { ok: false, error: { kind: "orphaned_application_reference", applicationId: activity.applicationId, candidateId } }
      : { ok: false, error: { kind: "application_repository", error: application.error } }
    return { ok: true, value: undefined }
  }

  return {
    async getCandidateActivityReport(candidateId, period) {
      const candidate = await loadCandidate(candidateId)
      if (!candidate.ok) return candidate
      const loadedApplications = await loadApplications(candidate.value.id)
      if (!loadedApplications.ok) return loadedApplications
      const loadedFollowUps = await followUps.listByCandidateId(candidate.value.id)
      if (!loadedFollowUps.ok) return { ok: false, error: { kind: "follow_up_repository", error: loadedFollowUps.error } }
      for (const followUp of loadedFollowUps.value) {
        const checked = await validateFollowUp(candidate.value.id, followUp)
        if (!checked.ok) return checked
      }
      const loadedActivities = await operations.listActivitiesByCandidateId(candidate.value.id)
      if (!loadedActivities.ok) return { ok: false, error: { kind: "operations_repository", error: loadedActivities.error } }
      for (const activity of loadedActivities.value) {
        if (activity.candidateId !== candidate.value.id) return { ok: false, error: { kind: "activity_application_mismatch", activityId: activity.id, applicationId: activity.applicationId ?? "", candidateId: candidate.value.id } }
        const checked = await validateActivity(candidate.value.id, activity)
        if (!checked.ok) return checked
      }
      const report = createCandidateActivityReport({ candidateId: candidate.value.id, period, applications: loadedApplications.value, followUps: loadedFollowUps.value, activities: loadedActivities.value })
      return report.ok ? report : { ok: false, error: { kind: "report_domain", error: report.error } }
    },
  }
}