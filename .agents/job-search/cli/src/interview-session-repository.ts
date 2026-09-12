import type { InterviewSession } from "./interview-session"

export type InterviewSessionRepositoryErrorCode =
  | "NOT_FOUND"
  | "READ_FAILURE"
  | "WRITE_FAILURE"
  | "CORRUPT_STORAGE"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "INVALID_RECORD"

export interface InterviewSessionRepositoryError {
  code: InterviewSessionRepositoryErrorCode
  message: string
}

export type InterviewSessionRepositoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: InterviewSessionRepositoryError }

/** Storage only. Callers perform domain transitions before saving their result. */
export interface InterviewSessionRepository {
  /** Insert or replace by ID. An existing ID cannot move to another application. */
  save(session: InterviewSession): Promise<InterviewSessionRepositoryResult<InterviewSession>>
  getById(id: string): Promise<InterviewSessionRepositoryResult<InterviewSession>>
  /** Stable ID order, not chronological order. */
  listByApplicationId(applicationId: string): Promise<InterviewSessionRepositoryResult<InterviewSession[]>>
  /** Removes every session for this application. Returns the count removed. */
  deleteByApplicationId(applicationId: string): Promise<InterviewSessionRepositoryResult<number>>
}
