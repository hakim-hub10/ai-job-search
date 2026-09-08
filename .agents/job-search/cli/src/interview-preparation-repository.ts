import type { CandidateDocumentEvidence, RequirementEvidenceContext } from "./application-documents"
import type { InterviewPreparationPlan } from "./interview-preparation"

/** Immutable historical snapshot. Trusted callers supply verified evidence;
 * structural validation does not establish factual truth or external ownership.
 * No current profile, generated documents, or session state is stored here.
 */
export interface InterviewPreparationRecord {
  id: string
  applicationId: string
  candidateId: string
  plan: InterviewPreparationPlan
  evidenceSnapshot: CandidateDocumentEvidence[]
  requirementContext: RequirementEvidenceContext[]
}
export type InterviewPreparationRepositoryErrorCode =
  | "NOT_FOUND" | "DUPLICATE_ID" | "INVALID_RECORD" | "CORRUPT_STORAGE"
  | "UNSUPPORTED_SCHEMA_VERSION" | "READ_FAILURE" | "WRITE_FAILURE"
export interface InterviewPreparationRepositoryError {
  code: InterviewPreparationRepositoryErrorCode
  message: string
}
export type InterviewPreparationRepositoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: InterviewPreparationRepositoryError }
export interface InterviewPreparationRepository {
  create(record: InterviewPreparationRecord): Promise<InterviewPreparationRepositoryResult<InterviewPreparationRecord>>
  getById(id: string): Promise<InterviewPreparationRepositoryResult<InterviewPreparationRecord>>
  /** Stable ID order, not chronology. Each result retains candidate ownership. */
  listByApplicationId(applicationId: string): Promise<InterviewPreparationRepositoryResult<InterviewPreparationRecord[]>>
}
