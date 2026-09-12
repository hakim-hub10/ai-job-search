import type { CandidateApplicationAssociation } from "./coach-application-association"

export type CandidateApplicationAssociationRepositoryErrorCode =
  | "NOT_FOUND"
  | "DUPLICATE_ASSOCIATION"
  | "READ_FAILURE"
  | "WRITE_FAILURE"
  | "CORRUPT_STORAGE"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "INVALID_RECORD"

export interface CandidateApplicationAssociationRepositoryError {
  code: CandidateApplicationAssociationRepositoryErrorCode
  message: string
}

export type CandidateApplicationAssociationRepositoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CandidateApplicationAssociationRepositoryError }

/** Storage boundary for candidate/application ownership references only. */
export interface CandidateApplicationAssociationRepository {
  create(
    association: CandidateApplicationAssociation,
  ): Promise<CandidateApplicationAssociationRepositoryResult<CandidateApplicationAssociation>>
  getByApplicationId(
    applicationId: string,
  ): Promise<CandidateApplicationAssociationRepositoryResult<CandidateApplicationAssociation>>
  listByCandidateId(
    candidateId: string,
  ): Promise<CandidateApplicationAssociationRepositoryResult<CandidateApplicationAssociation[]>>
  /** Idempotent: succeeds whether or not an association existed for this application. */
  deleteByApplicationId(
    applicationId: string,
  ): Promise<CandidateApplicationAssociationRepositoryResult<void>>
}
