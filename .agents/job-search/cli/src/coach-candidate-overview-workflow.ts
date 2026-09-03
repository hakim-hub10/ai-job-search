import type { ApplicationRepository, ApplicationRepositoryError } from "./application-repository"
import type { ApplicationRecord } from "./applications"
import type { CandidateApplicationAssociationRepository, CandidateApplicationAssociationRepositoryError } from "./coach-application-association-repository"
import type { CandidateFollowUp } from "./coach-candidate-follow-up"
import type { CandidateFollowUpRepository, CandidateFollowUpRepositoryError } from "./coach-candidate-follow-up-repository"
import { createCandidateOverview, type CandidateOverview, type CandidateOverviewError } from "./coach-candidate-overview"
import type { CoachCandidate } from "./coach-workspace"
import type { CoachWorkspaceRepository, CoachWorkspaceRepositoryError } from "./coach-workspace-repository"

export type CoachCandidateOverviewWorkflowError =
  | { kind: "overview_domain"; error: CandidateOverviewError }
  | { kind: "candidate_repository"; error: CoachWorkspaceRepositoryError }
  | { kind: "association_repository"; error: CandidateApplicationAssociationRepositoryError }
  | { kind: "application_repository"; error: ApplicationRepositoryError }
  | { kind: "follow_up_repository"; error: CandidateFollowUpRepositoryError }
  | { kind: "orphaned_application_reference"; applicationId: string; candidateId: string }
  | { kind: "follow_up_application_mismatch"; followUpId: string; applicationId: string; candidateId: string }

export type CoachCandidateOverviewWorkflowResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CoachCandidateOverviewWorkflowError }

export interface CoachCandidateOverviewWorkflow {
  getCandidateOverview(candidateId: string, asOf: string): Promise<CoachCandidateOverviewWorkflowResult<CandidateOverview>>
}

function candidateError(error: CoachWorkspaceRepositoryError): CoachCandidateOverviewWorkflowResult<never> {
  return { ok: false, error: { kind: "candidate_repository", error } }
}

export function createCoachCandidateOverviewWorkflow(
  candidates: CoachWorkspaceRepository,
  applications: ApplicationRepository,
  associations: CandidateApplicationAssociationRepository,
  followUps: CandidateFollowUpRepository,
): CoachCandidateOverviewWorkflow {
  async function loadCandidate(candidateId: string): Promise<CoachCandidateOverviewWorkflowResult<CoachCandidate>> {
    const result = await candidates.getCandidateById(candidateId)
    return result.ok ? { ok: true, value: result.value } : candidateError(result.error)
  }

  async function loadApplications(candidateId: string): Promise<CoachCandidateOverviewWorkflowResult<ApplicationRecord[]>> {
    const listed = await associations.listByCandidateId(candidateId)
    if (!listed.ok) return { ok: false, error: { kind: "association_repository", error: listed.error } }
    const records: ApplicationRecord[] = []
    for (const association of listed.value) {
      const application = await applications.getById(association.applicationId)
      if (!application.ok) {
        return application.error.code === "NOT_FOUND"
          ? { ok: false, error: { kind: "orphaned_application_reference", applicationId: association.applicationId, candidateId } }
          : { ok: false, error: { kind: "application_repository", error: application.error } }
      }
      records.push(structuredClone(application.value))
    }
    return { ok: true, value: records }
  }

  async function validateFollowUpOwnership(candidateId: string, followUp: CandidateFollowUp): Promise<CoachCandidateOverviewWorkflowResult<void>> {
    if (followUp.applicationId === undefined) return { ok: true, value: undefined }
    const association = await associations.getByApplicationId(followUp.applicationId)
    if (!association.ok) {
      return association.error.code === "NOT_FOUND"
        ? { ok: false, error: { kind: "follow_up_application_mismatch", followUpId: followUp.id, applicationId: followUp.applicationId, candidateId } }
        : { ok: false, error: { kind: "association_repository", error: association.error } }
    }
    if (association.value.candidateId !== candidateId) return { ok: false, error: { kind: "follow_up_application_mismatch", followUpId: followUp.id, applicationId: followUp.applicationId, candidateId } }
    const application = await applications.getById(followUp.applicationId)
    if (!application.ok) {
      return application.error.code === "NOT_FOUND"
        ? { ok: false, error: { kind: "orphaned_application_reference", applicationId: followUp.applicationId, candidateId } }
        : { ok: false, error: { kind: "application_repository", error: application.error } }
    }
    return { ok: true, value: undefined }
  }

  return {
    async getCandidateOverview(candidateId, asOf) {
      const candidate = await loadCandidate(candidateId)
      if (!candidate.ok) return candidate
      const loadedApplications = await loadApplications(candidate.value.id)
      if (!loadedApplications.ok) return loadedApplications
      const loadedFollowUps = await followUps.listByCandidateId(candidate.value.id)
      if (!loadedFollowUps.ok) return { ok: false, error: { kind: "follow_up_repository", error: loadedFollowUps.error } }
      for (const followUp of loadedFollowUps.value) {
        const ownership = await validateFollowUpOwnership(candidate.value.id, followUp)
        if (!ownership.ok) return ownership
      }
      const overview = createCandidateOverview({ candidate: candidate.value, applications: loadedApplications.value, followUps: loadedFollowUps.value, asOf })
      return overview.ok ? overview : { ok: false, error: { kind: "overview_domain", error: overview.error } }
    },
  }
}