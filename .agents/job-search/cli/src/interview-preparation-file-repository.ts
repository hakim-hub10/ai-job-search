import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import type { InterviewPreparationRecord } from "./interview-preparation-repository"
import { isInterviewPreparationRecord } from "./interview-preparation-storage-validation"
import type {
  InterviewPreparationRepository,
  InterviewPreparationRepositoryErrorCode,
  InterviewPreparationRepositoryResult,
} from "./interview-preparation-repository"

const SCHEMA_VERSION = 1
interface PreparationEnvelope {
  schemaVersion: typeof SCHEMA_VERSION
  preparations: InterviewPreparationRecord[]
}
function failure<T>(code: InterviewPreparationRepositoryErrorCode, message: string): InterviewPreparationRepositoryResult<T> {
  return { ok: false, error: { code, message } }
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function validateEnvelope(value: unknown): InterviewPreparationRepositoryResult<PreparationEnvelope> {
  if (!isObject(value) || Object.keys(value).sort().join(",") !== "preparations,schemaVersion"
    || typeof value.schemaVersion !== "number" || !Array.isArray(value.preparations)) {
    return failure("CORRUPT_STORAGE", "Interview preparation storage has an invalid envelope.")
  }
  if (value.schemaVersion !== SCHEMA_VERSION) return failure("UNSUPPORTED_SCHEMA_VERSION", "Interview preparation storage schema version is not supported.")
  if (!value.preparations.every(isInterviewPreparationRecord)) return failure("CORRUPT_STORAGE", "Interview preparation storage contains a malformed record.")
  if (new Set(value.preparations.map((preparation) => preparation.id)).size !== value.preparations.length) {
    return failure("CORRUPT_STORAGE", "Interview preparation storage contains duplicate IDs.")
  }
  return { ok: true, value: { schemaVersion: SCHEMA_VERSION, preparations: structuredClone(value.preparations) } }
}
function errorCode(error: unknown): string | undefined {
  return isObject(error) && typeof error.code === "string" ? error.code : undefined
}

/**
 * Local single-writer JSON repository; callers must serialize saves, including
 * across instances/processes. Atomic replacement does not provide coordination.
 * filePath must come from trusted runtime configuration, never browser input.
 */
export function createFileInterviewPreparationRepository(filePath: string): InterviewPreparationRepository {
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.tmp`)

  async function loadEnvelope(): Promise<InterviewPreparationRepositoryResult<PreparationEnvelope>> {
    let contents: string
    try {
      contents = await readFile(filePath, "utf8")
    } catch (error) {
      if (errorCode(error) === "ENOENT") return { ok: true, value: { schemaVersion: SCHEMA_VERSION, preparations: [] } }
      return failure("READ_FAILURE", "Interview preparation storage could not be read.")
    }
    if (contents.trim().length === 0) return failure("CORRUPT_STORAGE", "Interview preparation storage is empty.")
    try {
      return validateEnvelope(JSON.parse(contents))
    } catch {
      return failure("CORRUPT_STORAGE", "Interview preparation storage contains malformed JSON.")
    }
  }

  async function writeEnvelope(envelope: PreparationEnvelope): Promise<InterviewPreparationRepositoryResult<void>> {
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
      return failure("WRITE_FAILURE", "Interview preparation storage could not be written.")
    }
  }

  return {
    async create(record) {
      if (!isInterviewPreparationRecord(record)) return failure("INVALID_RECORD", "Interview preparation record is malformed.")
      const snapshot = structuredClone(record)
      const loaded = await loadEnvelope()
      if (!loaded.ok) return loaded
      if (loaded.value.preparations.some((item) => item.id === snapshot.id)) return failure("DUPLICATE_ID", "Interview preparation ID already exists.")
      const written = await writeEnvelope({ schemaVersion: SCHEMA_VERSION, preparations: [...loaded.value.preparations, snapshot] })
      return written.ok ? { ok: true, value: structuredClone(snapshot) } : written
    },
    async getById(id) {
      const loaded = await loadEnvelope()
      if (!loaded.ok) return loaded
      const preparation = loaded.value.preparations.find((item) => item.id === id)
      return preparation ? { ok: true, value: structuredClone(preparation) } : failure("NOT_FOUND", "Interview preparation was not found.")
    },
    async listByApplicationId(applicationId) {
      const loaded = await loadEnvelope()
      if (!loaded.ok) return loaded
      return { ok: true, value: loaded.value.preparations.filter((item) => item.applicationId === applicationId)
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) }
    },
  }
}
