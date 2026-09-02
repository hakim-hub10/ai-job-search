import type { CoachCandidate } from "./coach-workspace"

export type CoachWorkspaceRepositoryErrorCode =
  | "NOT_FOUND"
  | "DUPLICATE_ID"
  | "READ_FAILURE"
  | "WRITE_FAILURE"
  | "CORRUPT_STORAGE"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "INVALID_RECORD"

export interface CoachWorkspaceRepositoryError {
  code: CoachWorkspaceRepositoryErrorCode
  message: string
}

export type CoachWorkspaceRepositoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CoachWorkspaceRepositoryError }

/** Storage boundary for minimal coach-candidate metadata only. */
export interface CoachWorkspaceRepository {
  createCandidate(candidate: CoachCandidate): Promise<CoachWorkspaceRepositoryResult<CoachCandidate>>
  getCandidateById(id: string): Promise<CoachWorkspaceRepositoryResult<CoachCandidate>>
  listCandidates(): Promise<CoachWorkspaceRepositoryResult<CoachCandidate[]>>
}
