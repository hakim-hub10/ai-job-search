import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

import { parseCandidateProfile } from "./profile-input"
import type {
  CandidateProfileRecord,
  CandidateProfileRepository,
  CandidateProfileRepositoryErrorCode,
  CandidateProfileRepositoryResult,
} from "./candidate-profile-repository"

const SCHEMA_VERSION = 1

interface CandidateProfileEnvelope {
  schemaVersion: typeof SCHEMA_VERSION
  profiles: CandidateProfileRecord[]
}

function failure<T>(
  code: CandidateProfileRepositoryErrorCode,
  message: string,
): CandidateProfileRepositoryResult<T> {
  return { ok: false, error: { code, message } }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function validateRecord(
  value: unknown,
): CandidateProfileRepositoryResult<CandidateProfileRecord> {
  if (!isObject(value)) {
    return failure("INVALID_RECORD", "Candidate profile record is malformed.")
  }

  const keys = Object.keys(value).sort()
  if (
    keys.length !== 2
    || keys.join(",") !== "candidateId,profile"
    || !hasText(value.candidateId)
  ) {
    return failure("INVALID_RECORD", "Candidate profile record is malformed.")
  }

  try {
    const profile = parseCandidateProfile(value.profile)

    return {
      ok: true,
      value: {
        candidateId: value.candidateId,
        profile,
      },
    }
  } catch {
    return failure("INVALID_RECORD", "Candidate profile record is malformed.")
  }
}

function compareProfiles(
  a: CandidateProfileRecord,
  b: CandidateProfileRecord,
): number {
  return a.candidateId.localeCompare(b.candidateId)
}

function validateEnvelope(
  value: unknown,
): CandidateProfileRepositoryResult<CandidateProfileEnvelope> {
  if (
    !isObject(value)
    || typeof value.schemaVersion !== "number"
    || !Array.isArray(value.profiles)
  ) {
    return failure(
      "CORRUPT_STORAGE",
      "Candidate profile storage has an invalid envelope.",
    )
  }

  if (value.schemaVersion !== SCHEMA_VERSION) {
    return failure(
      "UNSUPPORTED_SCHEMA_VERSION",
      "Candidate profile storage schema version is not supported.",
    )
  }

  const profiles: CandidateProfileRecord[] = []
  const candidateIds = new Set<string>()

  for (const valueRecord of value.profiles) {
    const record = validateRecord(valueRecord)

    if (!record.ok) {
      return failure(
        "CORRUPT_STORAGE",
        "Candidate profile storage contains a malformed profile record.",
      )
    }

    if (candidateIds.has(record.value.candidateId)) {
      return failure(
        "CORRUPT_STORAGE",
        "Candidate profile storage contains duplicate candidate IDs.",
      )
    }

    candidateIds.add(record.value.candidateId)
    profiles.push(record.value)
  }

  return {
    ok: true,
    value: {
      schemaVersion: SCHEMA_VERSION,
      profiles: structuredClone(profiles).sort(compareProfiles),
    },
  }
}

function errorCode(error: unknown): string | undefined {
  return isObject(error) && typeof error.code === "string"
    ? error.code
    : undefined
}

/** Local single-writer repository; callers must serialize concurrent writes. */
export function createFileCandidateProfileRepository(
  filePath: string,
): CandidateProfileRepository {
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.tmp`)

  async function loadEnvelope(): Promise<
    CandidateProfileRepositoryResult<CandidateProfileEnvelope>
  > {
    let contents: string

    try {
      contents = await readFile(filePath, "utf8")
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        return {
          ok: true,
          value: { schemaVersion: SCHEMA_VERSION, profiles: [] },
        }
      }

      return failure(
        "READ_FAILURE",
        "Candidate profile storage could not be read.",
      )
    }

    if (contents.trim().length === 0) {
      return failure("CORRUPT_STORAGE", "Candidate profile storage is empty.")
    }

    try {
      return validateEnvelope(JSON.parse(contents))
    } catch {
      return failure(
        "CORRUPT_STORAGE",
        "Candidate profile storage contains malformed JSON.",
      )
    }
  }

  async function writeEnvelope(
    envelope: CandidateProfileEnvelope,
  ): Promise<CandidateProfileRepositoryResult<void>> {
    const validated = validateEnvelope(envelope)
    if (!validated.ok) return validated

    try {
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
      await writeFile(
        tempPath,
        `${JSON.stringify(validated.value, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      )

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
      return failure(
        "WRITE_FAILURE",
        "Candidate profile storage could not be written.",
      )
    }
  }

  return {
    async saveProfile(candidateId, profile) {
      const validated = validateRecord({ candidateId, profile })
      if (!validated.ok) return validated

      const loaded = await loadEnvelope()
      if (!loaded.ok) return loaded

      const nextProfiles = loaded.value.profiles.filter(
        (existing) => existing.candidateId !== validated.value.candidateId,
      )

      nextProfiles.push(structuredClone(validated.value))

      const next: CandidateProfileEnvelope = {
        schemaVersion: SCHEMA_VERSION,
        profiles: nextProfiles,
      }

      const written = await writeEnvelope(next)
      return written.ok
        ? { ok: true, value: structuredClone(validated.value) }
        : written
    },

    async getProfileByCandidateId(candidateId) {
      const loaded = await loadEnvelope()
      if (!loaded.ok) return loaded

      const record = loaded.value.profiles.find(
        (existing) => existing.candidateId === candidateId,
      )

      return record
        ? { ok: true, value: structuredClone(record) }
        : failure("NOT_FOUND", "Candidate profile was not found.")
    },

    async listProfiles() {
      const loaded = await loadEnvelope()

      return loaded.ok
        ? {
            ok: true,
            value: structuredClone(loaded.value.profiles).sort(compareProfiles),
          }
        : loaded
    },
  }
}
