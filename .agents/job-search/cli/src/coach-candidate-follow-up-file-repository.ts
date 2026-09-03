import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { validateCandidateFollowUp, type CandidateFollowUp } from "./coach-candidate-follow-up"
import type {
  CandidateFollowUpRepository,
  CandidateFollowUpRepositoryErrorCode,
  CandidateFollowUpRepositoryResult,
} from "./coach-candidate-follow-up-repository"

const SCHEMA_VERSION = 1

interface FollowUpEnvelope {
  schemaVersion: typeof SCHEMA_VERSION
  followUps: CandidateFollowUp[]
}

function failure<T>(code: CandidateFollowUpRepositoryErrorCode, message: string): CandidateFollowUpRepositoryResult<T> {
  return { ok: false, error: { code, message } }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join(",") === keys.sort().join(",")
}

function isFollowUp(value: unknown): value is CandidateFollowUp {
  if (!isObject(value)) return false
  const keys = ["candidateId", "createdAt", "dueAt", "id", "updatedAt"]
  if (value.applicationId !== undefined) keys.push("applicationId")
  if (value.completedAt !== undefined) keys.push("completedAt")
  return exactKeys(value, keys) && validateCandidateFollowUp(value).ok
}

function compareFollowUps(a: CandidateFollowUp, b: CandidateFollowUp): number {
  return a.dueAt.localeCompare(b.dueAt) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

function validateEnvelope(value: unknown): CandidateFollowUpRepositoryResult<FollowUpEnvelope> {
  if (!isObject(value) || !exactKeys(value, ["followUps", "schemaVersion"])
    || typeof value.schemaVersion !== "number" || !Array.isArray(value.followUps)) {
    return failure("CORRUPT_STORAGE", "Follow-up storage has an invalid envelope.")
  }
  if (value.schemaVersion !== SCHEMA_VERSION) return failure("UNSUPPORTED_SCHEMA_VERSION", "Follow-up storage schema version is not supported.")
  if (!value.followUps.every(isFollowUp)) return failure("CORRUPT_STORAGE", "Follow-up storage contains a malformed record.")
  const ids = new Set<string>()
  for (const followUp of value.followUps) {
    if (ids.has(followUp.id)) return failure("CORRUPT_STORAGE", "Follow-up storage contains duplicate IDs.")
    ids.add(followUp.id)
  }
  return { ok: true, value: { schemaVersion: SCHEMA_VERSION, followUps: structuredClone(value.followUps).sort(compareFollowUps) } }
}

function errorCode(error: unknown): string | undefined {
  return isObject(error) && typeof error.code === "string" ? error.code : undefined
}

export function createFileCandidateFollowUpRepository(filePath: string): CandidateFollowUpRepository {
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.tmp`)

  async function loadEnvelope(): Promise<CandidateFollowUpRepositoryResult<FollowUpEnvelope>> {
    let contents: string
    try {
      contents = await readFile(filePath, "utf8")
    } catch (error) {
      if (errorCode(error) === "ENOENT") return { ok: true, value: { schemaVersion: SCHEMA_VERSION, followUps: [] } }
      return failure("READ_FAILURE", "Follow-up storage could not be read.")
    }
    if (contents.trim().length === 0) return failure("CORRUPT_STORAGE", "Follow-up storage is empty.")
    try {
      return validateEnvelope(JSON.parse(contents))
    } catch {
      return failure("CORRUPT_STORAGE", "Follow-up storage contains malformed JSON.")
    }
  }

  async function writeEnvelope(envelope: FollowUpEnvelope): Promise<CandidateFollowUpRepositoryResult<void>> {
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
      return failure("WRITE_FAILURE", "Follow-up storage could not be written.")
    }
  }

  return {
    async create(followUp) {
      if (!isFollowUp(followUp)) return failure("INVALID_RECORD", "Candidate follow-up record is malformed.")
      const loaded = await loadEnvelope()
      if (!loaded.ok) return loaded
      if (loaded.value.followUps.some((existing) => existing.id === followUp.id)) return failure("DUPLICATE_ID", "A follow-up with this ID already exists.")
      const next: FollowUpEnvelope = { schemaVersion: SCHEMA_VERSION, followUps: [...loaded.value.followUps, structuredClone(followUp)] }
      const written = await writeEnvelope(next)
      return written.ok ? { ok: true, value: structuredClone(followUp) } : written
    },

    async getById(id) {
      const loaded = await loadEnvelope()
      if (!loaded.ok) return loaded
      const followUp = loaded.value.followUps.find((item) => item.id === id)
      return followUp ? { ok: true, value: structuredClone(followUp) } : failure("NOT_FOUND", "Candidate follow-up was not found.")
    },

    async listByCandidateId(candidateId) {
      const loaded = await loadEnvelope()
      if (!loaded.ok) return loaded
      return {
        ok: true,
        value: structuredClone(loaded.value.followUps).filter((item) => item.candidateId === candidateId).sort(compareFollowUps),
      }
    },

    async save(followUp) {
      if (!isFollowUp(followUp)) return failure("INVALID_RECORD", "Candidate follow-up record is malformed.")
      const loaded = await loadEnvelope()
      if (!loaded.ok) return loaded
      const index = loaded.value.followUps.findIndex((item) => item.id === followUp.id)
      if (index === -1) return failure("NOT_FOUND", "Candidate follow-up was not found.")
      const followUps = [...loaded.value.followUps]
      followUps[index] = structuredClone(followUp)
      const written = await writeEnvelope({ schemaVersion: SCHEMA_VERSION, followUps })
      return written.ok ? { ok: true, value: structuredClone(followUp) } : written
    },
  }
}