import {
  completeCandidateFollowUp,
  createCandidateFollowUp,
  type CandidateFollowUp,
  type CandidateFollowUpError,
  type CompleteCandidateFollowUpInput,
  type CreateCandidateFollowUpInput,
} from "./coach-candidate-follow-up"
import type {
  CandidateFollowUpRepository,
  CandidateFollowUpRepositoryError,
} from "./coach-candidate-follow-up-repository"
import { createCandidateProgressSummary, type CandidateProgressError, type CandidateProgressSummary } from "./coach-candidate-progress"
import type { ApplicationRepository, ApplicationRepositoryError } from "./application-repository"
import type { ApplicationRecord } from "./applications"
import type { CandidateApplicationAssociationRepository, CandidateApplicationAssociationRepositoryError } from "./coach-application-association-repository"
import type { CoachCandidate } from "./coach-workspace"
import type { CoachWorkspaceRepository, CoachWorkspaceRepositoryError } from "./coach-workspace-repository"

export type CoachCandidateProgressWorkflowError =
  | { kind: "progress_domain"; error: CandidateProgressError }
  | { kind: "follow_up_domain"; error: CandidateFollowUpError }
  | { kind: "candidate_repository"; error: CoachWorkspaceRepositoryError }
  | { kind: "application_repository"; error: ApplicationRepositoryError }
  | { kind: "association_repository"; error: CandidateApplicationAssociationRepositoryError }
  | { kind: "follow_up_repository"; error: CandidateFollowUpRepositoryError }
  | { kind: "application_candidate_mismatch"; applicationId: string; candidateId: string }
  | { kind: "follow_up_candidate_mismatch"; followUpId: string; candidateId: string }

export type CoachCandidateProgressWorkflowResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CoachCandidateProgressWorkflowError }

export interface CompleteCandidateFollowUpWorkflowInput extends CompleteCandidateFollowUpInput {
  candidateId: string
  followUpId: string
}

export interface CoachCandidateProgressWorkflow {
  getCandidateProgress(candidateId: string, asOf: string): Promise<CoachCandidateProgressWorkflowResult<CandidateProgressSummary>>
  listCandidateFollowUps(candidateId: string): Promise<CoachCandidateProgressWorkflowResult<CandidateFollowUp[]>>
  createCandidateFollowUp(input: CreateCandidateFollowUpInput): Promise<CoachCandidateProgressWorkflowResult<CandidateFollowUp>>
  completeCandidateFollowUp(input: CompleteCandidateFollowUpWorkflowInput): Promise<CoachCandidateProgressWorkflowResult<CandidateFollowUp>>
}

function candidateError(error: CoachWorkspaceRepositoryError): CoachCandidateProgressWorkflowResult<never> {
  return { ok: false, error: { kind: "candidate_repository", error } }
}

async function loadCandidate(
  candidates: CoachWorkspaceRepository,
  candidateId: string,
): Promise<CoachCandidateProgressWorkflowResult<CoachCandidate>> {
  const result = await candidates.getCandidateById(candidateId)
  return result.ok ? { ok: true, value: result.value } : candidateError(result.error)
}

export function createCoachCandidateProgressWorkflow(
  candidates: CoachWorkspaceRepository,
  applications: ApplicationRepository,
  associations: CandidateApplicationAssociationRepository,
  followUps: CandidateFollowUpRepository,
): CoachCandidateProgressWorkflow {
  async function loadApplications(candidateId: string): Promise<CoachCandidateProgressWorkflowResult<ApplicationRecord[]>> {
    const listed = await associations.listByCandidateId(candidateId)
    if (!listed.ok) return { ok: false, error: { kind: "association_repository", error: listed.error } }
    const records: ApplicationRecord[] = []
    for (const association of listed.value) {
      const application = await applications.getById(association.applicationId)
      if (!application.ok) return { ok: false, error: { kind: "application_repository", error: application.error } }
      records.push(structuredClone(application.value))
    }
    return { ok: true, value: records }
  }

  async function verifyApplicationOwnership(candidateId: string, applicationId: string): Promise<CoachCandidateProgressWorkflowResult<void>> {
    const application = await applications.getById(applicationId)
    if (!application.ok) return { ok: false, error: { kind: "application_repository", error: application.error } }
    const association = await associations.getByApplicationId(applicationId)
    if (!association.ok) return { ok: false, error: { kind: "association_repository", error: association.error } }
    if (association.value.candidateId !== candidateId) return { ok: false, error: { kind: "application_candidate_mismatch", applicationId, candidateId } }
    return { ok: true, value: undefined }
  }

  return {
    async getCandidateProgress(candidateId, asOf) {
      const candidate = await loadCandidate(candidates, candidateId)
      if (!candidate.ok) return candidate
      const loadedApplications = await loadApplications(candidate.value.id)
      if (!loadedApplications.ok) return loadedApplications
      const loadedFollowUps = await followUps.listByCandidateId(candidate.value.id)
      if (!loadedFollowUps.ok) return { ok: false, error: { kind: "follow_up_repository", error: loadedFollowUps.error } }
      const summary = createCandidateProgressSummary({ candidateId: candidate.value.id, applications: loadedApplications.value, followUps: loadedFollowUps.value, asOf })
      return summary.ok ? summary : { ok: false, error: { kind: "progress_domain", error: summary.error } }
    },

    async listCandidateFollowUps(candidateId) {
      const candidate = await loadCandidate(candidates, candidateId)
      if (!candidate.ok) return candidate
      const listed = await followUps.listByCandidateId(candidate.value.id)
      return listed.ok ? { ok: true, value: structuredClone(listed.value) } : { ok: false, error: { kind: "follow_up_repository", error: listed.error } }
    },

    async createCandidateFollowUp(input) {
      const candidate = await loadCandidate(candidates, input?.candidateId)
      if (!candidate.ok) return candidate
      if (input.applicationId !== undefined) {
        const ownership = await verifyApplicationOwnership(candidate.value.id, input.applicationId)
        if (!ownership.ok) return ownership
      }
      const created = createCandidateFollowUp(input)
      if (!created.ok) return { ok: false, error: { kind: "follow_up_domain", error: created.error } }
      const persisted = await followUps.create(created.value)
      return persisted.ok ? { ok: true, value: structuredClone(persisted.value) } : { ok: false, error: { kind: "follow_up_repository", error: persisted.error } }
    },

    async completeCandidateFollowUp(input) {
      const candidate = await loadCandidate(candidates, input?.candidateId)
      if (!candidate.ok) return candidate
      const loaded = await followUps.getById(input.followUpId)
      if (!loaded.ok) return { ok: false, error: { kind: "follow_up_repository", error: loaded.error } }
      if (loaded.value.candidateId !== candidate.value.id) return { ok: false, error: { kind: "follow_up_candidate_mismatch", followUpId: input.followUpId, candidateId: candidate.value.id } }
      const completed = completeCandidateFollowUp(loaded.value, input)
      if (!completed.ok) return { ok: false, error: { kind: "follow_up_domain", error: completed.error } }
      const saved = await followUps.save(completed.value)
      return saved.ok ? { ok: true, value: structuredClone(saved.value) } : { ok: false, error: { kind: "follow_up_repository", error: saved.error } }
    },
  }
}