import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { isInterviewSessionPreparationLink, linkFailure, validateInterviewSessionPreparationLink } from "./interview-session-preparation"
import type { InterviewSessionPreparationLink, InterviewSessionPreparationLinkRepository, InterviewSessionPreparationDependencies, InterviewSessionPreparationLinkResult } from "./interview-session-preparation-link-repository"

const SCHEMA_VERSION = 1
interface LinkEnvelope {
  schemaVersion: typeof SCHEMA_VERSION
  links: InterviewSessionPreparationLink[]
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function errorCode(error: unknown): string | undefined {
  return isObject(error) && typeof error.code === "string" ? error.code : undefined
}
function validateEnvelope(value: unknown): InterviewSessionPreparationLinkResult<LinkEnvelope> {
  if (!isObject(value) || Object.keys(value).sort().join(",") !== "links,schemaVersion"
    || typeof value.schemaVersion !== "number" || !Array.isArray(value.links)) return linkFailure("CORRUPT_STORAGE")
  if (value.schemaVersion !== SCHEMA_VERSION) return linkFailure("UNSUPPORTED_SCHEMA_VERSION")
  if (!value.links.every(isInterviewSessionPreparationLink)
    || new Set(value.links.map((link) => link.sessionId)).size !== value.links.length) return linkFailure("CORRUPT_STORAGE")
  return { ok: true, value: { schemaVersion: SCHEMA_VERSION, links: structuredClone(value.links) } }
}

/** Trusted runtime path only. Single writer: callers serialize creation with
 * session writes across instances/processes. No cross-file transaction; if link
 * creation fails, the persisted session remains explicitly unlinked. No reads
 * rewrite legacy storage. File permissions and atomic replacement follow core.
 */
export function createFileInterviewSessionPreparationLinkRepository(
  filePath: string,
  dependencies: InterviewSessionPreparationDependencies,
): InterviewSessionPreparationLinkRepository {
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.tmp`)

  async function loadEnvelope(): Promise<InterviewSessionPreparationLinkResult<LinkEnvelope>> {
    let contents: string
    try {
      contents = await readFile(filePath, "utf8")
    } catch (error) {
      if (errorCode(error) === "ENOENT") return { ok: true, value: { schemaVersion: SCHEMA_VERSION, links: [] } }
      return linkFailure("READ_FAILURE")
    }
    if (contents.trim().length === 0) return linkFailure("CORRUPT_STORAGE")
    try {
      return validateEnvelope(JSON.parse(contents))
    } catch {
      return linkFailure("CORRUPT_STORAGE")
    }
  }

  async function writeEnvelope(envelope: LinkEnvelope): Promise<InterviewSessionPreparationLinkResult<void>> {
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
      return linkFailure("WRITE_FAILURE")
    }
  }

  return {
    async create(link) {
      if (!isInterviewSessionPreparationLink(link)) return linkFailure("INVALID_LINK")
      const snapshot = structuredClone(link)
      const loaded = await loadEnvelope()
      if (!loaded.ok) return loaded
      if (loaded.value.links.some((item) => item.sessionId === snapshot.sessionId)) return linkFailure("DUPLICATE_LINK")
      const validated = await validateInterviewSessionPreparationLink(snapshot, dependencies)
      if (!validated.ok) return validated
      const written = await writeEnvelope({ schemaVersion: SCHEMA_VERSION, links: [...loaded.value.links, snapshot] })
      return written.ok ? { ok: true, value: structuredClone(snapshot) } : written
    },
    async getBySessionId(sessionId) {
      const loaded = await loadEnvelope()
      if (!loaded.ok) return loaded
      const link = loaded.value.links.find((item) => item.sessionId === sessionId)
      return link ? { ok: true, value: structuredClone(link) } : linkFailure("NOT_FOUND")
    },
  }
}
