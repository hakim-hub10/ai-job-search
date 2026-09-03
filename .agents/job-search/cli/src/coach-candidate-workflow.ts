import { createCoachCandidate, type CoachCandidate, type CoachCandidateError, type CreateCoachCandidateInput } from "./coach-workspace"
import type { CoachWorkspaceRepository, CoachWorkspaceRepositoryError } from "./coach-workspace-repository"

export type CoachCandidateWorkflowError =
  | { kind: "candidate_domain"; error: CoachCandidateError }
  | { kind: "candidate_repository"; error: CoachWorkspaceRepositoryError }
export type CoachCandidateWorkflowResult<T> = { ok: true; value: T } | { ok: false; error: CoachCandidateWorkflowError }

export interface CoachCandidateWorkflow {
  createCandidate(input: CreateCoachCandidateInput): Promise<CoachCandidateWorkflowResult<CoachCandidate>>
  listCandidates(): Promise<CoachCandidateWorkflowResult<CoachCandidate[]>>
  getCandidate(id: string): Promise<CoachCandidateWorkflowResult<CoachCandidate>>
}

export function createCoachCandidateWorkflow(repository: CoachWorkspaceRepository): CoachCandidateWorkflow {
  return {
    async createCandidate(input) {
      const candidate = createCoachCandidate(input)
      if (!candidate.ok) return { ok: false, error: { kind: "candidate_domain", error: candidate.error } }
      const saved = await repository.createCandidate(candidate.value)
      return saved.ok ? { ok: true, value: structuredClone(saved.value) } : { ok: false, error: { kind: "candidate_repository", error: saved.error } }
    },
    async listCandidates() {
      const listed = await repository.listCandidates()
      return listed.ok ? { ok: true, value: structuredClone(listed.value) } : { ok: false, error: { kind: "candidate_repository", error: listed.error } }
    },
    async getCandidate(id) {
      const result = await repository.getCandidateById(id)
      return result.ok ? { ok: true, value: structuredClone(result.value) } : { ok: false, error: { kind: "candidate_repository", error: result.error } }
    },
  }
}