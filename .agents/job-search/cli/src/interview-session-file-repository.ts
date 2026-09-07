import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import type { InterviewSession } from "./interview-session"
import { isPersistableInterviewSession } from "./interview-session-storage-validation"
import type {
  InterviewSessionRepository,
  InterviewSessionRepositoryErrorCode,
  InterviewSessionRepositoryResult,
} from "./interview-session-repository"

const SCHEMA_VERSION = 1
interface SessionEnvelope {
  schemaVersion: typeof SCHEMA_VERSION
  sessions: InterviewSession[]
}
function failure<T>(code: InterviewSessionRepositoryErrorCode, message: string): InterviewSessionRepositoryResult<T> {
  return { ok: false, error: { code, message } }
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function validateEnvelope(value: unknown): InterviewSessionRepositoryResult<SessionEnvelope> {
  if (!isObject(value) || Object.keys(value).sort().join(",") !== "schemaVersion,sessions"
    || typeof value.schemaVersion !== "number" || !Array.isArray(value.sessions)) {
    return failure("CORRUPT_STORAGE", "Interview session storage has an invalid envelope.")
  }
  if (value.schemaVersion !== SCHEMA_VERSION) return failure("UNSUPPORTED_SCHEMA_VERSION", "Interview session storage schema version is not supported.")
  if (!value.sessions.every(isPersistableInterviewSession)) return failure("CORRUPT_STORAGE", "Interview session storage contains a malformed record.")
  if (new Set(value.sessions.map((session) => session.id)).size !== value.sessions.length) {
    return failure("CORRUPT_STORAGE", "Interview session storage contains duplicate IDs.")
  }
  return { ok: true, value: { schemaVersion: SCHEMA_VERSION, sessions: structuredClone(value.sessions) } }
}
function errorCode(error: unknown): string | undefined {
  return isObject(error) && typeof error.code === "string" ? error.code : undefined
}

/**
 * Local single-writer JSON repository; callers must serialize saves, including
 * across instances/processes. Atomic replacement does not provide coordination.
 * filePath must come from trusted runtime configuration, never browser input.
 */
export function createFileInterviewSessionRepository(filePath: string): InterviewSessionRepository {
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.tmp`)

  async function loadEnvelope(): Promise<InterviewSessionRepositoryResult<SessionEnvelope>> {
    let contents: string
    try {
      contents = await readFile(filePath, "utf8")
    } catch (error) {
      if (errorCode(error) === "ENOENT") return { ok: true, value: { schemaVersion: SCHEMA_VERSION, sessions: [] } }
      return failure("READ_FAILURE", "Interview session storage could not be read.")
    }
    if (contents.trim().length === 0) return failure("CORRUPT_STORAGE", "Interview session storage is empty.")
    try {
      return validateEnvelope(JSON.parse(contents))
    } catch {
      return failure("CORRUPT_STORAGE", "Interview session storage contains malformed JSON.")
    }
  }

  async function writeEnvelope(envelope: SessionEnvelope): Promise<InterviewSessionRepositoryResult<void>> {
    const validated = validateEnvelope(envelope)
    if (!validated.ok) return validated
    try {
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
      await writeFile(tempPath, `${JSON.stringify(validated.value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
      const handle = await open(tempPath, "r")
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(tempPath, filePath)
      return { ok: true, value: undefined }
    } catch {
      await rm(tempPath, { force: true }).catch(() => undefined)
      return failure("WRITE_FAILURE", "Interview session storage could not be written.")
    }
  }

  return {
    async save(session) {
      if (!isPersistableInterviewSession(session)) return failure("INVALID_RECORD", "Interview session record is malformed.")
      // Snapshot before I/O so caller changes cannot affect the pending save.
      const snapshot = structuredClone(session)
      const loaded = await loadEnvelope()
      if (!loaded.ok) return loaded
      const index = loaded.value.sessions.findIndex((item) => item.id === snapshot.id)
      if (index !== -1 && loaded.value.sessions[index].applicationId !== snapshot.applicationId) {
        return failure("INVALID_RECORD", "Interview session application ownership cannot change.")
      }
      const sessions = [...loaded.value.sessions]
      if (index === -1) sessions.push(snapshot)
      else sessions[index] = snapshot
      const written = await writeEnvelope({ schemaVersion: SCHEMA_VERSION, sessions })
      return written.ok ? { ok: true, value: structuredClone(snapshot) } : written
    },
    async getById(id) {
      const loaded = await loadEnvelope()
      if (!loaded.ok) return loaded
      const session = loaded.value.sessions.find((item) => item.id === id)
      return session ? { ok: true, value: structuredClone(session) } : failure("NOT_FOUND", "Interview session was not found.")
    },
    async listByApplicationId(applicationId) {
      const loaded = await loadEnvelope()
      if (!loaded.ok) return loaded
      return { ok: true, value: loaded.value.sessions.filter((item) => item.applicationId === applicationId)
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) }
    },
  }
}
