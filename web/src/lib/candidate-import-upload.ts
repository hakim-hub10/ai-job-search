import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { ImportSession, CandidateImportFormat } from "../../../.agents/job-search/cli/src/candidate-import";
import type { CoachCandidate } from "../../../.agents/job-search/cli/src/coach-workspace";

// 5 MiB accommodates ordinary text CVs while bounding signature/hash work.
// A future HTTP adapter must also bound the request BEFORE allocating its bytes.
export const MAX_CANDIDATE_IMPORT_BYTES = 5 * 1024 * 1024;

export interface CandidateImportUpload {
  candidateId: string;
  filename: string;
  mimeType?: string;
  bytes: Uint8Array;
}

const messages = {
  INVALID_CANDIDATE: "The upload does not belong to the selected candidate.",
  INVALID_FILENAME: "Use a plain filename without path or control characters.",
  INVALID_BYTES: "The upload must contain binary bytes.",
  EMPTY_FILE: "The uploaded file is empty.",
  FILE_TOO_LARGE: "The uploaded file exceeds the 5 MiB limit.",
  UNSUPPORTED_FORMAT: "Only PDF and DOCX uploads are supported.",
  FORMAT_MISMATCH: "The filename, media type and file signature must agree.",
  INVALID_SIGNATURE: "The file does not have a supported admission signature.",
} as const;

export type CandidateImportUploadErrorCode = keyof typeof messages;
export type CandidateImportUploadResult =
  | { ok: true; value: ImportSession }
  | { ok: false; error: { code: CandidateImportUploadErrorCode; message: string } };

function failure(code: CandidateImportUploadErrorCode): CandidateImportUploadResult {
  return { ok: false, error: { code, message: messages[code] } };
}

const mimeTypes: Record<CandidateImportFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function signature(bytes: Uint8Array): CandidateImportFormat | null {
  // Strict header admission: %PDF-1.x or %PDF-2.0 followed by a line ending.
  if (bytes.length >= 9 && bytes[0] === 37 && bytes[1] === 80
    && bytes[2] === 68 && bytes[3] === 70 && bytes[4] === 45
    && bytes[6] === 46
    && ((bytes[5] === 49 && bytes[7] >= 48 && bytes[7] <= 55)
      || (bytes[5] === 50 && bytes[7] === 48))
    && (bytes[8] === 10 || bytes[8] === 13)) return "pdf";
  // ZIP local-file header only. This deliberately does not decompress, inspect
  // entries, validate OOXML, or establish that a document is safe to parse.
  if (bytes.length >= 30 && bytes[0] === 80 && bytes[1] === 75
    && bytes[2] === 3 && bytes[3] === 4) return "docx";
  return null;
}

/** The caller supplies a candidate resolved server-side, never a client assertion
 * of identity. Bytes remain caller-owned and are neither stored nor returned.
 * This synchronous admission boundary performs no parsing or external calls.
 */
export function validateCandidateImportUpload(
  upload: CandidateImportUpload,
  candidate: Pick<CoachCandidate, "id">,
): CandidateImportUploadResult {
  if (typeof upload.candidateId !== "string" || !upload.candidateId.trim()
    || upload.candidateId !== candidate.id) return failure("INVALID_CANDIDATE");
  if (!(upload.bytes instanceof Uint8Array)) return failure("INVALID_BYTES");
  const size = upload.bytes.byteLength;
  if (size === 0) return failure("EMPTY_FILE");
  if (size > MAX_CANDIDATE_IMPORT_BYTES) return failure("FILE_TOO_LARGE");
  // Reject POSIX/Windows paths, alternate streams, controls and bidi overrides.
  if (typeof upload.filename !== "string" || !upload.filename.trim()
    || upload.filename !== upload.filename.trim() || upload.filename.length > 255
    || [...upload.filename].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    || /[\\/:<>"|?*\u202a-\u202e\u2066-\u2069]/u.test(upload.filename)) {
    return failure("INVALID_FILENAME");
  }
  const extension = upload.filename.slice(upload.filename.lastIndexOf(".") + 1).toLowerCase();
  if (!upload.filename.includes(".") || (extension !== "pdf" && extension !== "docx")) return failure("UNSUPPORTED_FORMAT");
  if (upload.mimeType !== undefined && typeof upload.mimeType !== "string") return failure("UNSUPPORTED_FORMAT");
  const mime = upload.mimeType?.trim().toLowerCase();
  if (mime && !Object.values(mimeTypes).includes(mime)) return failure("UNSUPPORTED_FORMAT");
  if (mime && mime !== mimeTypes[extension]) return failure("FORMAT_MISMATCH");
  const detected = signature(upload.bytes);
  if (!detected) return failure("INVALID_SIGNATURE");
  if (detected !== extension) return failure("FORMAT_MISMATCH");

  const id = randomUUID();
  const now = new Date().toISOString();
  return {
    ok: true,
    value: {
      id, candidateId: candidate.id, status: "validated", createdAt: now, updatedAt: now,
      document: {
        id: randomUUID(), candidateId: candidate.id, importId: id,
        originalFilename: upload.filename, byteSize: size, format: detected,
        sha256: createHash("sha256").update(upload.bytes).digest("hex"),
        validationVersion: 1,
      },
    },
  };
}
