import {
  createCandidateApplicationAssociation,
  type CandidateApplicationAssociation,
  type CandidateApplicationAssociationError,
  type CreateCandidateApplicationAssociationInput,
} from "./coach-application-association"
import type {
  CandidateApplicationAssociationRepository,
  CandidateApplicationAssociationRepositoryError,
} from "./coach-application-association-repository"
import type { ApplicationRepository, ApplicationRepositoryError } from "./application-repository"
import type { ApplicationRecord } from "./applications"
import type { CoachCandidate } from "./coach-workspace"
import type { CoachWorkspaceRepository, CoachWorkspaceRepositoryError } from "./coach-workspace-repository"

export type CoachApplicationOwnershipConflictCode =
  | "ALREADY_ASSOCIATED_WITH_CANDIDATE"
  | "ASSOCIATED_WITH_ANOTHER_CANDIDATE"

export interface CoachApplicationOwnershipConflict {
  code: CoachApplicationOwnershipConflictCode
  association: CandidateApplicationAssociation
}

export type CoachApplicationWorkflowError =
  | { kind: "association_domain"; error: CandidateApplicationAssociationError }
  | { kind: "candidate_repository"; error: CoachWorkspaceRepositoryError }
  | { kind: "application_repository"; error: ApplicationRepositoryError }
  | { kind: "association_repository"; error: CandidateApplicationAssociationRepositoryError }
  | { kind: "ownership_conflict"; error: CoachApplicationOwnershipConflict }

export type CoachApplicationWorkflowResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CoachApplicationWorkflowError }

export interface CoachApplicationWorkflow {
  associateApplication(
    input: CreateCandidateApplicationAssociationInput,
  ): Promise<CoachApplicationWorkflowResult<CandidateApplicationAssociation>>
  listCandidateApplications(candidateId: string): Promise<CoachApplicationWorkflowResult<ApplicationRecord[]>>
  getApplicationCandidate(applicationId: string): Promise<CoachApplicationWorkflowResult<CoachCandidate>>
}

function invalidId(
  code: "INVALID_CANDIDATE_ID" | "INVALID_APPLICATION_ID",
  message: string,
): CoachApplicationWorkflowResult<never> {
  return { ok: false, error: { kind: "association_domain", error: { code, message } } }
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

/** Composes existing authorities without mutating candidates or applications. */
export function createCoachApplicationWorkflow(
  candidates: CoachWorkspaceRepository,
  applications: ApplicationRepository,
  associations: CandidateApplicationAssociationRepository,
): CoachApplicationWorkflow {
  return {
    async associateApplication(input) {
      const created = createCandidateApplicationAssociation(input)
      if (!created.ok) return { ok: false, error: { kind: "association_domain", error: created.error } }

      const candidate = await candidates.getCandidateById(created.value.candidateId)
      if (!candidate.ok) return { ok: false, error: { kind: "candidate_repository", error: candidate.error } }

      const application = await applications.getById(created.value.applicationId)
      if (!application.ok) return { ok: false, error: { kind: "application_repository", error: application.error } }

      const existing = await associations.getByApplicationId(created.value.applicationId)
      if (existing.ok) {
        const code = existing.value.candidateId === created.value.candidateId
          ? "ALREADY_ASSOCIATED_WITH_CANDIDATE"
          : "ASSOCIATED_WITH_ANOTHER_CANDIDATE"
        return {
          ok: false,
          error: {
            kind: "ownership_conflict",
            error: { code, association: structuredClone(existing.value) },
          },
        }
      }
      if (existing.error.code !== "NOT_FOUND") {
        return { ok: false, error: { kind: "association_repository", error: existing.error } }
      }

      const persisted = await associations.create(created.value)
      return persisted.ok
        ? { ok: true, value: structuredClone(persisted.value) }
        : { ok: false, error: { kind: "association_repository", error: persisted.error } }
    },

    async listCandidateApplications(candidateId) {
      if (!hasText(candidateId)) return invalidId("INVALID_CANDIDATE_ID", "Candidate association IDs must be non-empty strings.")
      const candidate = await candidates.getCandidateById(candidateId)
      if (!candidate.ok) return { ok: false, error: { kind: "candidate_repository", error: candidate.error } }

      const listed = await associations.listByCandidateId(candidateId)
      if (!listed.ok) return { ok: false, error: { kind: "association_repository", error: listed.error } }

      const records: ApplicationRecord[] = []
      for (const association of listed.value) {
        const application = await applications.getById(association.applicationId)
        if (!application.ok) return { ok: false, error: { kind: "application_repository", error: application.error } }
        records.push(structuredClone(application.value))
      }
      return { ok: true, value: records }
    },

    async getApplicationCandidate(applicationId) {
      if (!hasText(applicationId)) return invalidId("INVALID_APPLICATION_ID", "Application association IDs must be non-empty strings.")
      const association = await associations.getByApplicationId(applicationId)
      if (!association.ok) return { ok: false, error: { kind: "association_repository", error: association.error } }

      const application = await applications.getById(applicationId)
      if (!application.ok) return { ok: false, error: { kind: "application_repository", error: application.error } }

      const candidate = await candidates.getCandidateById(association.value.candidateId)
      return candidate.ok
        ? { ok: true, value: structuredClone(candidate.value) }
        : { ok: false, error: { kind: "candidate_repository", error: candidate.error } }
    },
  }
}
