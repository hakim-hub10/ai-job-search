import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import type { CoachCandidate } from "./coach-workspace"
import type {
  CoachWorkspaceRepository,
  CoachWorkspaceRepositoryErrorCode,
  CoachWorkspaceRepositoryResult,
} from "./coach-workspace-repository"

const SCHEMA_VERSION = 1

interface CoachWorkspaceEnvelope {
  schemaVersion: typeof SCHEMA_VERSION
  candidates: CoachCandidate[]
}

function failure<T>(code: CoachWorkspaceRepositoryErrorCode, message: string): CoachWorkspaceRepositoryResult<T> {
  return { ok: false, error: { code, message } }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    && !Number.isNaN(Date.parse(value))
}

function isCoachCandidate(value: unknown): value is CoachCandidate {
  if (!isObject(value)) return false
  const keys = Object.keys(value).sort()
  return keys.length === 4
    && keys.join(",") === "createdAt,displayName,id,updatedAt"
    && hasText(value.id)
    && hasText(value.displayName)
    && isTimestamp(value.createdAt)
    && isTimestamp(value.updatedAt)
    && Date.parse(value.updatedAt) >= Date.parse(value.createdAt)
}

function compareCandidates(a: CoachCandidate, b: CoachCandidate): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

function validateEnvelope(value: unknown): CoachWorkspaceRepositoryResult<CoachWorkspaceEnvelope> {
  if (!isObject(value) || typeof value.schemaVersion !== "number" || !Array.isArray(value.candidates)) {
    return failure("CORRUPT_STORAGE", "Coach workspace storage has an invalid envelope.")
  }
  if (value.schemaVersion !== SCHEMA_VERSION) {
    return failure("UNSUPPORTED_SCHEMA_VERSION", "Coach workspace storage schema version is not supported.")
  }
  if (!value.candidates.every(isCoachCandidate)) {
    return failure("CORRUPT_STORAGE", "Coach workspace storage contains a malformed candidate record.")
  }
  const ids = new Set<string>()
  for (const candidate of value.candidates) {
    if (ids.has(candidate.id)) return failure("CORRUPT_STORAGE", "Coach workspace storage contains duplicate candidate IDs.")
    ids.add(candidate.id)
  }
  return {
    ok: true,
    value: { schemaVersion: SCHEMA_VERSION, candidates: structuredClone(value.candidates).sort(compareCandidates) },
  }
}

function errorCode(error: unknown): string | undefined {
  return isObject(error) && typeof error.code === "string" ? error.code : undefined
}

/** Local single-writer repository; callers must serialize concurrent writes. */
export function createFileCoachWorkspaceRepository(filePath: string): CoachWorkspaceRepository {
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.tmp`)

  async function loadEnvelope(): Promise<CoachWorkspaceRepositoryResult<CoachWorkspaceEnvelope>> {
    let contents: string
    try {
      contents = await readFile(filePath, "utf8")
    } catch (error) {
      if (errorCode(error) === "ENOENT") return { ok: true, value: { schemaVersion: SCHEMA_VERSION, candidates: [] } }
      return failure("READ_FAILURE", "Coach workspace storage could not be read.")
    }
    if (contents.trim().length === 0) return failure("CORRUPT_STORAGE", "Coach workspace storage is empty.")
    try {
      return validateEnvelope(JSON.parse(contents))
    } catch {
      return failure("CORRUPT_STORAGE", "Coach workspace storage contains malformed JSON.")
    }
  }

  async function writeEnvelope(envelope: CoachWorkspaceEnvelope): Promise<CoachWorkspaceRepositoryResult<void>> {
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
      return failure("WRITE_FAILURE", "Coach workspace storage could not be written.")
    }
  }

  return {
    async createCandidate(candidate) {
      if (!isCoachCandidate(candidate)) return failure("INVALID_RECORD", "Coach candidate record is malformed.")
      const loaded = await loadEnvelope()
      if (!loaded.ok) return loaded
      if (loaded.value.candidates.some((existing) => existing.id === candidate.id)) {
        return failure("DUPLICATE_ID", "A coach candidate with this ID already exists.")
      }
      const next: CoachWorkspaceEnvelope = { schemaVersion: SCHEMA_VERSION, candidates: [...loaded.value.candidates, structuredClone(candidate)] }
      const written = await writeEnvelope(next)
      return written.ok ? { ok: true, value: structuredClone(candidate) } : written
    },

    async getCandidateById(id) {
      const loaded = await loadEnvelope()
      if (!loaded.ok) return loaded
      const candidate = loaded.value.candidates.find((existing) => existing.id === id)
      return candidate
        ? { ok: true, value: structuredClone(candidate) }
        : failure("NOT_FOUND", "Coach candidate record was not found.")
    },

    async listCandidates() {
      const loaded = await loadEnvelope()
      return loaded.ok
        ? { ok: true, value: structuredClone(loaded.value.candidates).sort(compareCandidates) }
        : loaded
    },
  }
}
