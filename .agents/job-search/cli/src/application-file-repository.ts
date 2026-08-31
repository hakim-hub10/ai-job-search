import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import type { ApplicationRecord, ApplicationStatus } from "./applications"
import type {
  ApplicationRepository,
  ApplicationRepositoryErrorCode,
  ApplicationRepositoryResult,
} from "./application-repository"

const SCHEMA_VERSION = 1
const STATUSES = new Set<ApplicationStatus>(["saved", "preparing", "applied", "interview", "offer", "rejected", "withdrawn", "closed"])

interface ApplicationStorageEnvelope {
  schemaVersion: typeof SCHEMA_VERSION
  applications: ApplicationRecord[]
}

function failure<T>(code: ApplicationRepositoryErrorCode, message: string): ApplicationRepositoryResult<T> {
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

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isNormalizedJob(value: unknown): boolean {
  if (!isObject(value)) return false
  return hasText(value.id)
    && hasText(value.title)
    && isStringOrNull(value.company)
    && isStringOrNull(value.location)
    && isStringOrNull(value.country)
    && isStringOrNull(value.url)
    && isStringOrNull(value.applyUrl)
    && hasText(value.source)
    && isStringOrNull(value.sourceId)
    && isStringOrNull(value.date)
    && isStringOrNull(value.employmentType)
    && isStringOrNull(value.remote)
    && isStringOrNull(value.description)
    && isStringOrNull(value.salary)
    && isStringArray(value.skills)
    && isStringOrNull(value.seniority)
    && isStringOrNull(value.category)
}

function isEvidenceArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => isObject(item) && hasText(item.dimension) && typeof item.detail === "string")
}

function isMatchingResult(value: unknown): boolean {
  if (!isObject(value)) return false
  return hasText(value.jobId)
    && hasText(value.jobTitle)
    && typeof value.candidateHeadline === "string"
    && isEvidenceArray(value.matched)
    && isEvidenceArray(value.missing)
    && isEvidenceArray(value.conflicting)
    && isEvidenceArray(value.unknown)
    && isFiniteNumber(value.totalMatched)
    && isFiniteNumber(value.totalMissing)
    && isFiniteNumber(value.totalConflicting)
    && isFiniteNumber(value.totalUnknown)
    && isStringArray(value.matchedDimensions)
    && isStringArray(value.missingDimensions)
    && isStringArray(value.conflictingDimensions)
    && isStringArray(value.unknownDimensions)
}

function isScoringResult(value: unknown): boolean {
  if (!isObject(value) || !isObject(value.breakdown)) return false
  const breakdown = value.breakdown
  return hasText(value.jobId)
    && hasText(value.jobTitle)
    && isFiniteNumber(value.score)
    && isFiniteNumber(value.confidence)
    && (value.confidenceLabel === "high" || value.confidenceLabel === "medium" || value.confidenceLabel === "low")
    && typeof value.summary === "string"
    && isFiniteNumber(breakdown.totalDimensions)
    && isFiniteNumber(breakdown.knownDimensions)
    && isFiniteNumber(breakdown.unknownDimensions)
    && isFiniteNumber(breakdown.totalPoints)
    && isFiniteNumber(breakdown.pointsAchieved)
    && Array.isArray(breakdown.dimensions)
    && isEvidenceArray(value.matched)
    && isEvidenceArray(value.missing)
    && isEvidenceArray(value.conflicting)
    && isEvidenceArray(value.unknown)
}

function isSkillGapResult(value: unknown): boolean {
  if (!isObject(value)) return false
  return hasText(value.jobId)
    && hasText(value.jobTitle)
    && typeof value.candidateHeadline === "string"
    && Array.isArray(value.gaps)
    && Array.isArray(value.strengths)
    && Array.isArray(value.unknowns)
    && Array.isArray(value.recommendations)
    && isFiniteNumber(value.totalGaps)
    && isFiniteNumber(value.criticalGaps)
    && isFiniteNumber(value.highGaps)
    && typeof value.summary === "string"
}

function isApplicationRecord(value: unknown): value is ApplicationRecord {
  if (!isObject(value) || "candidateProfile" in value || !isObject(value.analysisSnapshot)) return false
  const analysis = value.analysisSnapshot
  if (!hasText(value.id)
    || !isNormalizedJob(value.jobSnapshot)
    || !isFiniteNumber(analysis.rank)
    || !isMatchingResult(analysis.matchingResult)
    || !isScoringResult(analysis.scoringResult)
    || !isSkillGapResult(analysis.skillGapResult)
    || typeof analysis.explanation !== "string"
    || !STATUSES.has(value.status as ApplicationStatus)
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)
    || !Array.isArray(value.statusHistory)
    || !Array.isArray(value.notes)) return false

  return value.statusHistory.every((event) => isObject(event)
    && STATUSES.has(event.status as ApplicationStatus)
    && isTimestamp(event.timestamp)
    && (event.note === undefined || hasText(event.note)))
    && value.notes.every((note) => isObject(note) && hasText(note.text) && isTimestamp(note.createdAt))
}

function validateEnvelope(value: unknown): ApplicationRepositoryResult<ApplicationStorageEnvelope> {
  if (!isObject(value) || !Array.isArray(value.applications) || typeof value.schemaVersion !== "number") {
    return failure("CORRUPT_STORAGE", "Application storage has an invalid envelope.")
  }
  if (value.schemaVersion !== SCHEMA_VERSION) {
    return failure("UNSUPPORTED_SCHEMA_VERSION", "Application storage schema version is not supported.")
  }
  if (!value.applications.every(isApplicationRecord)) {
    return failure("CORRUPT_STORAGE", "Application storage contains a malformed application record.")
  }
  const ids = new Set<string>()
  for (const record of value.applications) {
    if (ids.has(record.id)) return failure("CORRUPT_STORAGE", "Application storage contains duplicate application IDs.")
    ids.add(record.id)
  }
  return { ok: true, value: { schemaVersion: SCHEMA_VERSION, applications: structuredClone(value.applications) } }
}

function compareApplications(a: ApplicationRecord, b: ApplicationRecord): number {
  return b.updatedAt.localeCompare(a.updatedAt)
    || b.createdAt.localeCompare(a.createdAt)
    || a.id.localeCompare(b.id)
}

function errorCode(error: unknown): string | undefined {
  return isObject(error) && typeof error.code === "string" ? error.code : undefined
}

/**
 * JSON-file repository for a local single-writer MVP. Concurrent processes are
 * intentionally not coordinated; callers must serialize concurrent saves.
 */
export function createFileApplicationRepository(filePath: string): ApplicationRepository {
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.tmp`)

  async function loadEnvelope(): Promise<ApplicationRepositoryResult<ApplicationStorageEnvelope>> {
    let text: string
    try {
      text = await readFile(filePath, "utf8")
    } catch (error) {
      if (errorCode(error) === "ENOENT") return { ok: true, value: { schemaVersion: SCHEMA_VERSION, applications: [] } }
      return failure("READ_FAILURE", "Application storage could not be read.")
    }
    if (text.trim().length === 0) return failure("CORRUPT_STORAGE", "Application storage is empty.")
    try {
      return validateEnvelope(JSON.parse(text))
    } catch {
      return failure("CORRUPT_STORAGE", "Application storage contains malformed JSON.")
    }
  }

  async function writeEnvelope(envelope: ApplicationStorageEnvelope): Promise<ApplicationRepositoryResult<void>> {
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
      return failure("WRITE_FAILURE", "Application storage could not be written.")
    }
  }

  return {
    async create(record) {
      if (!isApplicationRecord(record)) return failure("INVALID_RECORD", "Application record is malformed.")
      const loaded = await loadEnvelope()
      if (!loaded.ok) return loaded
      if (loaded.value.applications.some((existing) => existing.id === record.id)) {
        return failure("DUPLICATE_ID", "An application with this ID already exists.")
      }
      const next: ApplicationStorageEnvelope = { schemaVersion: SCHEMA_VERSION, applications: [...loaded.value.applications, structuredClone(record)] }
      const written = await writeEnvelope(next)
      return written.ok ? { ok: true, value: structuredClone(record) } : written
    },

    async save(record) {
      if (!isApplicationRecord(record)) return failure("INVALID_RECORD", "Application record is malformed.")
      const loaded = await loadEnvelope()
      if (!loaded.ok) return loaded
      const index = loaded.value.applications.findIndex((existing) => existing.id === record.id)
      if (index === -1) return failure("NOT_FOUND", "Application record was not found.")
      const applications = [...loaded.value.applications]
      applications[index] = structuredClone(record)
      const written = await writeEnvelope({ schemaVersion: SCHEMA_VERSION, applications })
      return written.ok ? { ok: true, value: structuredClone(record) } : written
    },

    async getById(id) {
      const loaded = await loadEnvelope()
      if (!loaded.ok) return loaded
      const record = loaded.value.applications.find((existing) => existing.id === id)
      return record
        ? { ok: true, value: structuredClone(record) }
        : failure("NOT_FOUND", "Application record was not found.")
    },

    async list() {
      const loaded = await loadEnvelope()
      if (!loaded.ok) return loaded
      return { ok: true, value: structuredClone(loaded.value.applications).sort(compareApplications) }
    },
  }
}
