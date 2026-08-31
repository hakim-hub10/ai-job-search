import type { ApplicationRepository, ApplicationRepositoryError } from "./application-repository"
import type { DocumentType } from "./application-documents"
import type { GeneratedApplicationDocument, GeneratedDocumentRenderResult } from "./document-rendering"
import type {
  ApplicationDocumentRecord,
  ApplicationDocumentRepository,
  ApplicationDocumentRepositoryError,
  ApplicationDocumentRepositoryResult,
} from "./application-document-repository"

export interface SaveGeneratedApplicationDocumentInput {
  documentId: string
  createdAt: string
  generatedDocument: GeneratedApplicationDocument
  renderedDocument: GeneratedDocumentRenderResult
}

export type ApplicationDocumentStorageWorkflowError =
  | { kind: "application"; error: ApplicationRepositoryError }
  | { kind: "document"; error: ApplicationDocumentRepositoryError }

export type ApplicationDocumentStorageWorkflowResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ApplicationDocumentStorageWorkflowError }

export interface ApplicationDocumentStorageWorkflow {
  saveGeneratedApplicationDocument(input: SaveGeneratedApplicationDocumentInput): Promise<ApplicationDocumentStorageWorkflowResult<ApplicationDocumentRecord>>
}

function fromDocument<T>(result: ApplicationDocumentRepositoryResult<T>): ApplicationDocumentStorageWorkflowResult<T> {
  return result.ok ? result : { ok: false, error: { kind: "document", error: result.error } }
}

/**
 * Coordinates existing-application verification and deterministic per-type
 * version assignment. Generation, rendering, approval, and persistence
 * mutation of applications remain outside this boundary.
 */
export function createApplicationDocumentStorageWorkflow(
  applications: ApplicationRepository,
  documents: ApplicationDocumentRepository,
): ApplicationDocumentStorageWorkflow {
  return {
    async saveGeneratedApplicationDocument(input) {
      const applicationId = input.generatedDocument?.applicationId
      const application = await applications.getById(applicationId)
      if (!application.ok) return { ok: false, error: { kind: "application", error: application.error } }
      const documentType: DocumentType = input.generatedDocument.documentType
      const versions = await documents.listVersions(applicationId, documentType)
      if (!versions.ok) return fromDocument(versions)
      const record: ApplicationDocumentRecord = {
        id: input.documentId,
        applicationId,
        documentType,
        language: input.generatedDocument.language,
        version: versions.value.length === 0 ? 1 : versions.value.at(-1)!.version + 1,
        createdAt: input.createdAt,
        generatedDocument: structuredClone(input.generatedDocument),
        renderedDocument: structuredClone(input.renderedDocument),
      }
      return fromDocument(await documents.create(record))
    },
  }
}
