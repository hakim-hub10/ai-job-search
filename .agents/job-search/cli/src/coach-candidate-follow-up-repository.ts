import type { CandidateFollowUp } from "./coach-candidate-follow-up"

export type CandidateFollowUpRepositoryErrorCode =
  | "NOT_FOUND"
  | "DUPLICATE_ID"
  | "READ_FAILURE"
  | "WRITE_FAILURE"
  | "CORRUPT_STORAGE"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "INVALID_RECORD"

export interface CandidateFollowUpRepositoryError {
  code: CandidateFollowUpRepositoryErrorCode
  message: string
}

export type CandidateFollowUpRepositoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CandidateFollowUpRepositoryError }

export interface CandidateFollowUpRepository {
  create(followUp: CandidateFollowUp): Promise<CandidateFollowUpRepositoryResult<CandidateFollowUp>>
  getById(id: string): Promise<CandidateFollowUpRepositoryResult<CandidateFollowUp>>
  listByCandidateId(candidateId: string): Promise<CandidateFollowUpRepositoryResult<CandidateFollowUp[]>>
  save(followUp: CandidateFollowUp): Promise<CandidateFollowUpRepositoryResult<CandidateFollowUp>>
}