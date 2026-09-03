import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import type { CandidateApplicationAssociation } from "./coach-application-association"
import type {
  CandidateApplicationAssociationRepository,
  CandidateApplicationAssociationRepositoryErrorCode,
  CandidateApplicationAssociationRepositoryResult,
} from "./coach-application-association-repository"

const SCHEMA_VERSION = 1

interface AssociationEnvelope {
  schemaVersion: typeof SCHEMA_VERSION
  associations: CandidateApplicationAssociation[]
}

function failure<T>(
  code: CandidateApplicationAssociationRepositoryErrorCode,
  message: string,
): CandidateApplicationAssociationRepositoryResult<T> {
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

function isAssociation(value: unknown): value is CandidateApplicationAssociation {
  if (!isObject(value)) return false
  const keys = Object.keys(value).sort()
  return keys.length === 3
    && keys.join(",") === "applicationId,candidateId,createdAt"
    && hasText(value.candidateId)
    && hasText(value.applicationId)
    && isTimestamp(value.createdAt)
}

function compareAssociations(a: CandidateApplicationAssociation, b: CandidateApplicationAssociation): number {
  return a.createdAt.localeCompare(b.createdAt)
    || a.candidateId.localeCompare(b.candidateId)
    || a.applicationId.localeCompare(b.applicationId)
}

function validateEnvelope(value: unknown): CandidateApplicationAssociationRepositoryResult<AssociationEnvelope> {
  if (!isObject(value)) return failure("CORRUPT_STORAGE", "Association storage has an invalid envelope.")
  const keys = Object.keys(value).sort()
  if (keys.length !== 2 || keys.join(",") !== "associations,schemaVersion"
    || typeof value.schemaVersion !== "number" || !Array.isArray(value.associations)) {
    return failure("CORRUPT_STORAGE", "Association storage has an invalid envelope.")
  }
  if (value.schemaVersion !== SCHEMA_VERSION) {
    return failure("UNSUPPORTED_SCHEMA_VERSION", "Association storage schema version is not supported.")
  }
  if (!value.associations.every(isAssociation)) {
    return failure("CORRUPT_STORAGE", "Association storage contains a malformed record.")
  }
  const applicationIds = new Set<string>()
  for (const association of value.associations) {
    if (applicationIds.has(association.applicationId)) {
      return failure("CORRUPT_STORAGE", "Association storage contains duplicate application ownership.")
    }
    applicationIds.add(association.applicationId)
  }
  return {
    ok: true,
    value: {
      schemaVersion: SCHEMA_VERSION,
      associations: structuredClone(value.associations).sort(compareAssociations),
    },
  }
}

function errorCode(error: unknown): string | undefined {
  return isObject(error) && typeof error.code === "string" ? error.code : undefined
}

/** Local single-writer repository; callers must serialize concurrent writes. */
export function createFileCandidateApplicationAssociationRepository(
  filePath: string,
): CandidateApplicationAssociationRepository {
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.tmp`)

  async function loadEnvelope(): Promise<CandidateApplicationAssociationRepositoryResult<AssociationEnvelope>> {
    let contents: string
    try {
      contents = await readFile(filePath, "utf8")
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        return { ok: true, value: { schemaVersion: SCHEMA_VERSION, associations: [] } }
      }
      return failure("READ_FAILURE", "Association storage could not be read.")
    }
    if (contents.trim().length === 0) return failure("CORRUPT_STORAGE", "Association storage is empty.")
    try {
      return validateEnvelope(JSON.parse(contents))
    } catch {
      return failure("CORRUPT_STORAGE", "Association storage contains malformed JSON.")
    }
  }

  async function writeEnvelope(
    envelope: AssociationEnvelope,
  ): Promise<CandidateApplicationAssociationRepositoryResult<void>> {
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
      return failure("WRITE_FAILURE", "Association storage could not be written.")
    }
  }

  return {
    async create(association) {
      if (!isAssociation(association)) return failure("INVALID_RECORD", "Candidate application association is malformed.")
      const loaded = await loadEnvelope()
      if (!loaded.ok) return loaded
      if (loaded.value.associations.some((existing) => existing.applicationId === association.applicationId)) {
        return failure("DUPLICATE_ASSOCIATION", "This application already has a candidate association.")
      }
      const next: AssociationEnvelope = {
        schemaVersion: SCHEMA_VERSION,
        associations: [...loaded.value.associations, structuredClone(association)],
      }
      const written = await writeEnvelope(next)
      return written.ok ? { ok: true, value: structuredClone(association) } : written
    },

    async getByApplicationId(applicationId) {
      const loaded = await loadEnvelope()
      if (!loaded.ok) return loaded
      const association = loaded.value.associations.find((existing) => existing.applicationId === applicationId)
      return association
        ? { ok: true, value: structuredClone(association) }
        : failure("NOT_FOUND", "Candidate application association was not found.")
    },

    async listByCandidateId(candidateId) {
      const loaded = await loadEnvelope()
      return loaded.ok
        ? {
            ok: true,
            value: structuredClone(loaded.value.associations)
              .filter((association) => association.candidateId === candidateId)
              .sort(compareAssociations),
          }
        : loaded
    },
  }
}
