import type { InterviewSessionRepository } from "./interview-session-repository"
import type { InterviewPreparationRepository } from "./interview-preparation-repository"

export interface InterviewSessionPreparationLink {
  sessionId: string
  applicationId: string
  preparationRecordId: string
}
export type InterviewSessionPreparationLinkErrorCode =
  | "NOT_FOUND" | "UNLINKED_SESSION" | "DUPLICATE_LINK" | "INVALID_LINK"
  | "CORRUPT_STORAGE" | "UNSUPPORTED_SCHEMA_VERSION" | "READ_FAILURE" | "WRITE_FAILURE"
export interface InterviewSessionPreparationLinkError {
  code: InterviewSessionPreparationLinkErrorCode
  message: string
}
export type InterviewSessionPreparationLinkResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: InterviewSessionPreparationLinkError }
export interface InterviewSessionPreparationDependencies {
  sessionRepository: Pick<InterviewSessionRepository, "getById">
  preparationRepository: Pick<InterviewPreparationRepository, "getById">
}
export interface InterviewSessionPreparationLinkRepository {
  /** Explicit association only. Implementations must validate both referenced
   * records before create; no backfill or reassignment is permitted. */
  create(link: InterviewSessionPreparationLink): Promise<InterviewSessionPreparationLinkResult<InterviewSessionPreparationLink>>
  getBySessionId(sessionId: string): Promise<InterviewSessionPreparationLinkResult<InterviewSessionPreparationLink>>
  /** Idempotent: succeeds whether or not a link existed for this session. */
  deleteBySessionId(sessionId: string): Promise<InterviewSessionPreparationLinkResult<void>>
}
