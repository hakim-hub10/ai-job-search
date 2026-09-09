/** Admission metadata only. Validation is not verification of career facts.
 * No durable session is created until a later phase defines resumable processing.
 */
export type CandidateImportFormat = "pdf" | "docx"

export interface ImportedDocument {
  id: string
  candidateId: string
  importId: string
  originalFilename: string
  byteSize: number
  /** docx means ZIP signature admission, not full OOXML package validation. */
  format: CandidateImportFormat
  sha256: string
  validationVersion: 1
}

export interface ImportSession {
  id: string
  candidateId: string
  document: ImportedDocument
  /** Bytes passed admission in this request; no extraction or approval occurred. */
  status: "validated"
  createdAt: string
  updatedAt: string
}

/** Internal candidate scoping, not authentication. Returns a detached snapshot. */
export function getCandidateImport(session: ImportSession, candidateId: string): ImportSession | null {
  if (!candidateId.trim() || session.candidateId !== candidateId
    || session.document.candidateId !== candidateId
    || session.document.importId !== session.id) return null
  return structuredClone(session)
}
