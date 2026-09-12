import type { ApplicationRepository } from "./application-repository"
import type { CandidateApplicationAssociationRepository } from "./coach-application-association-repository"
import type { ApplicationDocumentRepository } from "./application-document-repository"
import type { InterviewSessionRepository } from "./interview-session-repository"
import type { InterviewPreparationRepository } from "./interview-preparation-repository"
import type { InterviewSessionPreparationLinkRepository } from "./interview-session-preparation-link-repository"

export interface ApplicationDeletionDependencies {
  applicationRepository: ApplicationRepository
  associationRepository: CandidateApplicationAssociationRepository
  documentRepository: ApplicationDocumentRepository
  sessionRepository: InterviewSessionRepository
  preparationRepository: InterviewPreparationRepository
  sessionPreparationLinkRepository: InterviewSessionPreparationLinkRepository
}

export type ApplicationDeletionStage =
  | "list_sessions"
  | "delete_links"
  | "delete_sessions"
  | "delete_preparations"
  | "delete_documents"
  | "delete_association"
  | "delete_application"

export interface ApplicationDeletionSummary {
  applicationId: string
  sessionsDeleted: number
  preparationsDeleted: number
  documentsDeleted: number
}

export interface ApplicationDeletionError {
  stage: ApplicationDeletionStage
  code: string
  message: string
}

export type ApplicationDeletionResult =
  | { ok: true; value: ApplicationDeletionSummary }
  | { ok: false; error: ApplicationDeletionError }

/**
 * Deletes an application and every artifact exclusively owned by it: interview
 * sessions/preparations and their link, generated CV/cover-letter document
 * versions, and the candidate/application ownership association. Never
 * touches CandidateProfile, CoachCandidate, or CandidateBaseCv - those are
 * candidate-level facts that outlive any single application.
 *
 * Leaf artifacts are removed before the application record itself. This local
 * JSON storage has no cross-file transactions (the same limitation documented
 * on interview-session-preparation-link-file-repository.ts), so if a step
 * fails partway, the application record is left in place - still visible on
 * /applications and still deletable again - rather than disappearing from the
 * list while orphaned artifacts remain and duplicate detection stays blocked.
 */
export async function deleteApplicationAndOwnedData(
  applicationId: string,
  dependencies: ApplicationDeletionDependencies,
): Promise<ApplicationDeletionResult> {
  const sessions = await dependencies.sessionRepository.listByApplicationId(applicationId)
  if (!sessions.ok) {
    return { ok: false, error: { stage: "list_sessions", code: sessions.error.code, message: sessions.error.message } }
  }

  for (const session of sessions.value) {
    const deletedLink = await dependencies.sessionPreparationLinkRepository.deleteBySessionId(session.id)
    if (!deletedLink.ok) {
      return { ok: false, error: { stage: "delete_links", code: deletedLink.error.code, message: deletedLink.error.message } }
    }
  }

  const deletedSessions = await dependencies.sessionRepository.deleteByApplicationId(applicationId)
  if (!deletedSessions.ok) {
    return { ok: false, error: { stage: "delete_sessions", code: deletedSessions.error.code, message: deletedSessions.error.message } }
  }

  const deletedPreparations = await dependencies.preparationRepository.deleteByApplicationId(applicationId)
  if (!deletedPreparations.ok) {
    return { ok: false, error: { stage: "delete_preparations", code: deletedPreparations.error.code, message: deletedPreparations.error.message } }
  }

  const deletedDocuments = await dependencies.documentRepository.deleteByApplication(applicationId)
  if (!deletedDocuments.ok) {
    return { ok: false, error: { stage: "delete_documents", code: deletedDocuments.error.code, message: deletedDocuments.error.message } }
  }

  const deletedAssociation = await dependencies.associationRepository.deleteByApplicationId(applicationId)
  if (!deletedAssociation.ok) {
    return { ok: false, error: { stage: "delete_association", code: deletedAssociation.error.code, message: deletedAssociation.error.message } }
  }

  const deletedApplication = await dependencies.applicationRepository.remove(applicationId)
  if (!deletedApplication.ok) {
    return { ok: false, error: { stage: "delete_application", code: deletedApplication.error.code, message: deletedApplication.error.message } }
  }

  return {
    ok: true,
    value: {
      applicationId,
      sessionsDeleted: deletedSessions.value,
      preparationsDeleted: deletedPreparations.value,
      documentsDeleted: deletedDocuments.value,
    },
  }
}
