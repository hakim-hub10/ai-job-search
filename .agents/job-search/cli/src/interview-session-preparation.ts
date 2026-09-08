import { getCurrentInterviewQuestion } from "./interview-session"
import { isPersistableInterviewSession } from "./interview-session-storage-validation"
import { isInterviewPreparationRecord } from "./interview-preparation-storage-validation"
import type { InterviewPreparationRecord } from "./interview-preparation-repository"
import type {
  InterviewSessionPreparationLink, InterviewSessionPreparationDependencies,
  InterviewSessionPreparationLinkRepository, InterviewSessionPreparationLinkResult,
  InterviewSessionPreparationLinkErrorCode,
} from "./interview-session-preparation-link-repository"

export function linkFailure<T>(code: InterviewSessionPreparationLinkErrorCode): InterviewSessionPreparationLinkResult<T> {
  const messages: Record<InterviewSessionPreparationLinkErrorCode, string> = {
    NOT_FOUND: "Interview session, preparation or link was not found.",
    UNLINKED_SESSION: "Interview session has no explicit preparation link.",
    DUPLICATE_LINK: "Interview session already has a preparation link.",
    INVALID_LINK: "Interview session preparation link is invalid or incompatible.",
    CORRUPT_STORAGE: "Interview link storage is malformed.",
    UNSUPPORTED_SCHEMA_VERSION: "Interview link storage schema version is not supported.",
    READ_FAILURE: "Interview linkage context could not be read.",
    WRITE_FAILURE: "Interview link storage could not be written.",
  }
  return { ok: false, error: { code, message: messages[code] } }
}
export function isInterviewSessionPreparationLink(value: unknown): value is InterviewSessionPreparationLink {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const object = value as Record<string, unknown>
  return Object.keys(object).sort().join(",") === "applicationId,preparationRecordId,sessionId"
    && [object.sessionId, object.applicationId, object.preparationRecordId].every((id) => typeof id === "string" && id.trim().length > 0)
}
function sourceFailure<T>(code: string): InterviewSessionPreparationLinkResult<T> {
  if (code === "NOT_FOUND") return linkFailure("NOT_FOUND")
  return linkFailure(["CORRUPT_STORAGE", "INVALID_RECORD", "UNSUPPORTED_SCHEMA_VERSION"].includes(code) ? "INVALID_LINK" : "READ_FAILURE")
}

/** Shared create/read verification. A preparation ID explicitly selects context;
 * matching question IDs validate compatibility, never discover a preparation. */
export async function validateInterviewSessionPreparationLink(
  link: InterviewSessionPreparationLink,
  dependencies: InterviewSessionPreparationDependencies,
): Promise<InterviewSessionPreparationLinkResult<InterviewPreparationRecord>> {
  if (!isInterviewSessionPreparationLink(link)) return linkFailure("INVALID_LINK")
  try {
    const session = await dependencies.sessionRepository.getById(link.sessionId)
    if (!session.ok) return sourceFailure(session.error.code)
    if (!isPersistableInterviewSession(session.value) || session.value.id !== link.sessionId
      || session.value.applicationId !== link.applicationId) return linkFailure("INVALID_LINK")
    const preparation = await dependencies.preparationRepository.getById(link.preparationRecordId)
    if (!preparation.ok) return sourceFailure(preparation.error.code)
    if (!isInterviewPreparationRecord(preparation.value) || preparation.value.id !== link.preparationRecordId
      || preparation.value.applicationId !== link.applicationId) return linkFailure("INVALID_LINK")
    if (!getCurrentInterviewQuestion(session.value, preparation.value.plan).ok) return linkFailure("INVALID_LINK")
    // Candidate ownership is preserved by the immutable preparation. Sessions
    // have no candidate identity; do not invent one or consult current profiles.
    return { ok: true, value: structuredClone(preparation.value) }
  } catch { return linkFailure("READ_FAILURE") }
}

/** Read-only resolution. Legacy sessions remain unlinked, even when a plan with
 * identical question IDs exists. No lists, current profiles or generation APIs. */
export async function resolveInterviewSessionPreparation(
  input: { applicationId: string; sessionId: string },
  dependencies: InterviewSessionPreparationDependencies & { linkRepository: Pick<InterviewSessionPreparationLinkRepository, "getBySessionId"> },
): Promise<InterviewSessionPreparationLinkResult<InterviewPreparationRecord>> {
  if (!input || typeof input.applicationId !== "string" || !input.applicationId.trim()
    || typeof input.sessionId !== "string" || !input.sessionId.trim()) return linkFailure("INVALID_LINK")
  try {
    const session = await dependencies.sessionRepository.getById(input.sessionId)
    if (!session.ok) return sourceFailure(session.error.code)
    if (!isPersistableInterviewSession(session.value) || session.value.id !== input.sessionId
      || session.value.applicationId !== input.applicationId) return linkFailure("INVALID_LINK")
    const linked = await dependencies.linkRepository.getBySessionId(input.sessionId)
    if (!linked.ok) return linkFailure(linked.error.code === "NOT_FOUND" ? "UNLINKED_SESSION" : linked.error.code)
    if (!isInterviewSessionPreparationLink(linked.value) || linked.value.sessionId !== input.sessionId
      || linked.value.applicationId !== input.applicationId) return linkFailure("INVALID_LINK")
    return validateInterviewSessionPreparationLink(linked.value, dependencies)
  } catch { return linkFailure("READ_FAILURE") }
}
