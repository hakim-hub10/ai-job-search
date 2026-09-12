import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import type { DocumentType } from "./application-documents"
import { renderGeneratedApplicationDocument, type GeneratedApplicationDocument, type GeneratedDocumentRenderResult } from "./document-rendering"
import type {
  ApplicationDocumentRecord,
  ApplicationDocumentRepository,
  ApplicationDocumentRepositoryErrorCode,
  ApplicationDocumentRepositoryResult,
} from "./application-document-repository"

const SCHEMA_VERSION = 1
const DOCUMENT_TYPES = new Set(["cv", "coverLetter"])
const LANGUAGES = new Set(["sv", "en"])
const SECTION_KINDS = new Set(["identity", "summary", "experience", "skill", "education", "certification", "language", "project", "achievement", "motivation", "other", "context"])

interface ApplicationDocumentStorageEnvelope {
  schemaVersion: typeof SCHEMA_VERSION
  documents: ApplicationDocumentRecord[]
}

function failure<T>(code: ApplicationDocumentRepositoryErrorCode, message: string): ApplicationDocumentRepositoryResult<T> {
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

function isWarningArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((warning) => isObject(warning)
    && hasText(warning.code) && typeof warning.message === "string"
    && (warning.requirementKey === undefined || hasText(warning.requirementKey)))
}

function isGeneratedDocument(value: unknown): value is GeneratedApplicationDocument {
  if (!isObject(value) || !hasText(value.applicationId) || typeof value.documentType !== "string" || !DOCUMENT_TYPES.has(value.documentType)
    || typeof value.language !== "string" || !LANGUAGES.has(value.language) || typeof value.requiresHumanReview !== "boolean"
    || !Array.isArray(value.sections) || !isWarningArray(value.warnings)) return false
  const claimIds = new Set<string>()
  let reviewRequired = false
  for (const section of value.sections) {
    if (!isObject(section) || !hasText(section.id) || typeof section.kind !== "string" || !SECTION_KINDS.has(section.kind) || !Array.isArray(section.claims)) return false
    for (const claim of section.claims) {
      if (!isObject(claim) || !hasText(claim.id) || !hasText(claim.text) || !Array.isArray(claim.evidenceIds)
        || !claim.evidenceIds.every(hasText) || new Set(claim.evidenceIds).size !== claim.evidenceIds.length) return false
      if (claimIds.has(claim.id)) return false
      claimIds.add(claim.id)
      if (claim.kind === "candidateFact") {
        if ((claim.provenance !== "verbatim" && claim.provenance !== "paraphrased") || claim.evidenceIds.length === 0) return false
        if (claim.provenance === "paraphrased") reviewRequired = true
      } else if (claim.kind === "neutralContext") {
        if (claim.provenance !== "neutral" || claim.evidenceIds.length !== 0) return false
        reviewRequired = true
      } else return false
    }
  }
  return !reviewRequired || value.requiresHumanReview
}

function isRenderedDocument(value: unknown, document: GeneratedApplicationDocument): value is GeneratedDocumentRenderResult {
  if (!isObject(value) || value.applicationId !== document.applicationId || value.documentType !== document.documentType
    || value.language !== document.language || value.format !== "markdown" || typeof value.content !== "string"
    || value.requiresHumanReview !== document.requiresHumanReview || !isWarningArray(value.warnings)
    || JSON.stringify(value.warnings) !== JSON.stringify(document.warnings) || !Array.isArray(value.renderMap)) return false
  const claims = new Map(document.sections.flatMap((section) => section.claims.map((claim) => [claim.id, claim])))
  if (value.renderMap.length !== claims.size) return false
  const mapped = new Set<string>()
  for (let index = 0; index < value.renderMap.length; index += 1) {
    const entry = value.renderMap[index]
    const claim = isObject(entry) && typeof entry.claimId === "string" ? claims.get(entry.claimId) : undefined
    const claimId = isObject(entry) && typeof entry.claimId === "string" ? entry.claimId : undefined
    if (!isObject(entry) || !hasText(entry.sectionId) || !claim || !claimId || mapped.has(claimId)
      || entry.blockIndex !== index || !Array.isArray(entry.evidenceIds)
      || JSON.stringify(entry.evidenceIds) !== JSON.stringify(claim.evidenceIds) || entry.provenance !== claim.provenance) return false
    mapped.add(claimId)
  }
  return mapped.size === claims.size
}

/** Current saves must preserve the exact deterministic Markdown snapshot. */
function matchesCurrentRender(document: GeneratedApplicationDocument, rendered: GeneratedDocumentRenderResult): boolean {
  const expected = renderGeneratedApplicationDocument(document)
  return expected.ok
    && expected.value.content === rendered.content
    && JSON.stringify(expected.value.renderMap) === JSON.stringify(rendered.renderMap)
    && JSON.stringify(expected.value.warnings) === JSON.stringify(rendered.warnings)
    && expected.value.requiresHumanReview === rendered.requiresHumanReview
}

function recordError(record: unknown): ApplicationDocumentRepositoryErrorCode | null {
  if (!isObject(record) || !hasText(record.id) || !hasText(record.applicationId) || typeof record.documentType !== "string" || !DOCUMENT_TYPES.has(record.documentType)
    || typeof record.language !== "string" || !LANGUAGES.has(record.language) || !Number.isInteger(record.version) || typeof record.version !== "number" || record.version < 1 || !isTimestamp(record.createdAt)) return "INVALID_RECORD"
  if (!isGeneratedDocument(record.generatedDocument) || record.generatedDocument.applicationId !== record.applicationId
    || record.generatedDocument.documentType !== record.documentType || record.generatedDocument.language !== record.language
    || !isRenderedDocument(record.renderedDocument, record.generatedDocument)) return "INVALID_PROVENANCE"
  return null
}

function validateEnvelope(value: unknown): ApplicationDocumentRepositoryResult<ApplicationDocumentStorageEnvelope> {
  if (!isObject(value) || !Array.isArray(value.documents) || typeof value.schemaVersion !== "number") {
    return failure("CORRUPT_STORAGE", "Document storage has an invalid envelope.")
  }
  if (value.schemaVersion !== SCHEMA_VERSION) return failure("UNSUPPORTED_SCHEMA_VERSION", "Document storage schema version is not supported.")
  const ids = new Set<string>()
  const versions = new Set<string>()
  for (const record of value.documents) {
    if (recordError(record)) return failure("CORRUPT_STORAGE", "Document storage contains a malformed document record.")
    if (ids.has(record.id)) return failure("CORRUPT_STORAGE", "Document storage contains duplicate document IDs.")
    const versionKey = `${record.applicationId}\u0000${record.documentType}\u0000${record.version}`
    if (versions.has(versionKey)) return failure("CORRUPT_STORAGE", "Document storage contains duplicate document versions.")
    ids.add(record.id); versions.add(versionKey)
  }
  return { ok: true, value: { schemaVersion: SCHEMA_VERSION, documents: structuredClone(value.documents) } }
}

function compareRecords(a: ApplicationDocumentRecord, b: ApplicationDocumentRecord): number {
  return a.applicationId.localeCompare(b.applicationId)
    || a.documentType.localeCompare(b.documentType)
    || a.version - b.version
    || a.createdAt.localeCompare(b.createdAt)
    || a.id.localeCompare(b.id)
}

function errorCode(error: unknown): string | undefined {
  return isObject(error) && typeof error.code === "string" ? error.code : undefined
}

/** Independent JSON storage for append-only generated document history. */
export function createFileApplicationDocumentRepository(filePath: string): ApplicationDocumentRepository {
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.tmp`)

  async function loadEnvelope(): Promise<ApplicationDocumentRepositoryResult<ApplicationDocumentStorageEnvelope>> {
    let text: string
    try { text = await readFile(filePath, "utf8") } catch (error) {
      return errorCode(error) === "ENOENT"
        ? { ok: true, value: { schemaVersion: SCHEMA_VERSION, documents: [] } }
        : failure("READ_FAILURE", "Document storage could not be read.")
    }
    if (!text.trim()) return failure("CORRUPT_STORAGE", "Document storage is empty.")
    try { return validateEnvelope(JSON.parse(text)) } catch { return failure("CORRUPT_STORAGE", "Document storage contains malformed JSON.") }
  }

  async function writeEnvelope(envelope: ApplicationDocumentStorageEnvelope): Promise<ApplicationDocumentRepositoryResult<void>> {
    const validated = validateEnvelope(envelope)
    if (!validated.ok) return validated
    try {
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
      await writeFile(tempPath, `${JSON.stringify(validated.value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
      const handle = await open(tempPath, "r")
      try { await handle.sync() } finally { await handle.close() }
      await rename(tempPath, filePath)
      return { ok: true, value: undefined }
    } catch {
      await rm(tempPath, { force: true }).catch(() => undefined)
      return failure("WRITE_FAILURE", "Document storage could not be written.")
    }
  }

  return {
    async create(record) {
      const invalid = recordError(record)
      if (invalid) return failure(invalid, invalid === "INVALID_PROVENANCE" ? "Document provenance is invalid." : "Document record is malformed.")
      if (!matchesCurrentRender(record.generatedDocument, record.renderedDocument)) {
        return failure("INVALID_PROVENANCE", "Document Markdown does not match its validated structured snapshot.")
      }
      const loaded = await loadEnvelope()
      if (!loaded.ok) return loaded
      if (loaded.value.documents.some((item) => item.id === record.id)) return failure("DUPLICATE_ID", "A document with this ID already exists.")
      if (loaded.value.documents.some((item) => item.applicationId === record.applicationId && item.documentType === record.documentType && item.version === record.version)) {
        return failure("DUPLICATE_VERSION", "A document version already exists for this application and document type.")
      }
      const written = await writeEnvelope({ schemaVersion: SCHEMA_VERSION, documents: [...loaded.value.documents, structuredClone(record)] })
      return written.ok ? { ok: true, value: structuredClone(record) } : written
    },
    async getById(id) {
      const loaded = await loadEnvelope(); if (!loaded.ok) return loaded
      const record = loaded.value.documents.find((item) => item.id === id)
      return record ? { ok: true, value: structuredClone(record) } : failure("NOT_FOUND", "Document record was not found.")
    },
    async listByApplication(applicationId) {
      const loaded = await loadEnvelope(); if (!loaded.ok) return loaded
      return { ok: true, value: structuredClone(loaded.value.documents.filter((item) => item.applicationId === applicationId)).sort(compareRecords) }
    },
    async listVersions(applicationId, documentType) {
      const loaded = await loadEnvelope(); if (!loaded.ok) return loaded
      return { ok: true, value: structuredClone(loaded.value.documents.filter((item) => item.applicationId === applicationId && item.documentType === documentType)).sort(compareRecords) }
    },
    async getLatest(applicationId, documentType) {
      const versions = await this.listVersions(applicationId, documentType)
      if (!versions.ok) return versions
      const record = versions.value.at(-1)
      return record ? { ok: true, value: structuredClone(record) } : failure("NOT_FOUND", "No document version was found.")
    },

    async deleteByApplication(applicationId) {
      const loaded = await loadEnvelope(); if (!loaded.ok) return loaded
      const remaining = loaded.value.documents.filter((item) => item.applicationId !== applicationId)
      const removedCount = loaded.value.documents.length - remaining.length
      if (removedCount === 0) return { ok: true, value: 0 }
      const written = await writeEnvelope({ schemaVersion: SCHEMA_VERSION, documents: remaining })
      return written.ok ? { ok: true, value: removedCount } : written
    },
  }
}
