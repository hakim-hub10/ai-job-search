import type { DocumentLanguage, DocumentType } from "./application-documents"
import type { GeneratedApplicationDocument, GeneratedDocumentRenderResult } from "./document-rendering"

/** Immutable historical snapshot of one validated generated application document. */
export interface ApplicationDocumentRecord {
  id: string
  applicationId: string
  documentType: DocumentType
  language: DocumentLanguage
  version: number
  createdAt: string
  generatedDocument: GeneratedApplicationDocument
  renderedDocument: GeneratedDocumentRenderResult
}

export type ApplicationDocumentRepositoryErrorCode =
  | "NOT_FOUND"
  | "DUPLICATE_ID"
  | "DUPLICATE_VERSION"
  | "READ_FAILURE"
  | "WRITE_FAILURE"
  | "CORRUPT_STORAGE"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "INVALID_RECORD"
  | "INVALID_PROVENANCE"

export interface ApplicationDocumentRepositoryError {
  code: ApplicationDocumentRepositoryErrorCode
  message: string
}

export type ApplicationDocumentRepositoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ApplicationDocumentRepositoryError }

/** Append-only storage boundary for generated document history. */
export interface ApplicationDocumentRepository {
  create(record: ApplicationDocumentRecord): Promise<ApplicationDocumentRepositoryResult<ApplicationDocumentRecord>>
  getById(id: string): Promise<ApplicationDocumentRepositoryResult<ApplicationDocumentRecord>>
  listByApplication(applicationId: string): Promise<ApplicationDocumentRepositoryResult<ApplicationDocumentRecord[]>>
  listVersions(applicationId: string, documentType: DocumentType): Promise<ApplicationDocumentRepositoryResult<ApplicationDocumentRecord[]>>
  getLatest(applicationId: string, documentType: DocumentType): Promise<ApplicationDocumentRepositoryResult<ApplicationDocumentRecord>>
}
