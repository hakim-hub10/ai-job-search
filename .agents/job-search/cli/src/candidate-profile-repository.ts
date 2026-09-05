import type { CandidateProfile } from "./profile"

export interface CandidateProfileRecord {
  candidateId: string
  profile: CandidateProfile
}

export type CandidateProfileRepositoryErrorCode =
  | "NOT_FOUND"
  | "READ_FAILURE"
  | "WRITE_FAILURE"
  | "CORRUPT_STORAGE"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "INVALID_RECORD"

export interface CandidateProfileRepositoryError {
  code: CandidateProfileRepositoryErrorCode
  message: string
}

export type CandidateProfileRepositoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CandidateProfileRepositoryError }

/**
 * Storage boundary for verified candidate career-profile facts.
 * Profiles remain separate from minimal coach-candidate metadata.
 */
export interface CandidateProfileRepository {
  saveProfile(
    candidateId: string,
    profile: CandidateProfile,
  ): Promise<CandidateProfileRepositoryResult<CandidateProfileRecord>>

  getProfileByCandidateId(
    candidateId: string,
  ): Promise<CandidateProfileRepositoryResult<CandidateProfileRecord>>

  listProfiles(): Promise<
    CandidateProfileRepositoryResult<CandidateProfileRecord[]>
  >
}
