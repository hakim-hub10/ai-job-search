import type { ApplicationDocumentRepository } from "../../../.agents/job-search/cli/src/application-document-repository";

import { exportDocumentToDocx, type DocumentDocxExportResult } from "./document-docx-export";
import { exportDocumentToPdf, type DocumentPdfExportResult } from "./document-pdf-export";
import { prepareDocumentExport, type DocumentExportModel } from "./document-export";

export interface DocumentDownloadRequest {
  applicationId: unknown;
  documentType: unknown;
  templateId: unknown;
  format: unknown;
  /** Cover-letter header only - see DocumentExportRequest. */
  jobTitle?: unknown;
  employerName?: unknown;
  employerLocation?: unknown;
  candidateName?: unknown;
  candidateEmail?: unknown;
}

export interface DocumentDownloadDependencies {
  documentRepository: ApplicationDocumentRepository;
  exportPdf?: (model: DocumentExportModel) => Promise<DocumentPdfExportResult>;
  exportDocx?: (model: DocumentExportModel) => Promise<DocumentDocxExportResult>;
}

function errorResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function validApplicationId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim() === value && !/[\u0000\\/]/u.test(value);
}

function validDocumentType(value: unknown): value is "cv" | "coverLetter" {
  return value === "cv" || value === "coverLetter";
}

function validTemplate(value: unknown): value is "modern" | "classic" | "minimal" {
  return value === "modern" || value === "classic" || value === "minimal";
}

function validFormat(value: unknown): value is "pdf" | "docx" {
  return value === "pdf" || value === "docx";
}

function safeAttachmentFilename(value: string): string | null {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9][0-9]*\.(?:pdf|docx)$/u.test(value) ? value : null;
}

function expectedMediaType(format: "pdf" | "docx"): "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" {
  return format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

export async function downloadDocument(
  request: DocumentDownloadRequest,
  dependencies: DocumentDownloadDependencies,
): Promise<Response> {
  if (!validApplicationId(request.applicationId) || !validDocumentType(request.documentType) || !validTemplate(request.templateId) || !validFormat(request.format)) {
    return errorResponse(400, "Exportbegäran är ogiltig.");
  }

  const prepared = await prepareDocumentExport({
    applicationId: request.applicationId,
    documentType: request.documentType,
    templateId: request.templateId,
    format: request.format,
    ...(typeof request.jobTitle === "string" ? { jobTitle: request.jobTitle } : {}),
    ...(typeof request.employerName === "string" ? { employerName: request.employerName } : {}),
    ...(typeof request.employerLocation === "string" ? { employerLocation: request.employerLocation } : {}),
    ...(typeof request.candidateName === "string" ? { candidateName: request.candidateName } : {}),
    ...(typeof request.candidateEmail === "string" ? { candidateEmail: request.candidateEmail } : {}),
  }, { documentRepository: dependencies.documentRepository });
  if (!prepared.ok) {
    return prepared.error.code === "DOCUMENT_NOT_FOUND"
      ? errorResponse(404, "Dokumentet hittades inte.")
      : errorResponse(prepared.error.code.startsWith("INVALID_") ? 400 : 500, "Exporten kunde inte genomföras.");
  }

  const exported = request.format === "pdf"
    ? await (dependencies.exportPdf ?? exportDocumentToPdf)(prepared.value)
    : await (dependencies.exportDocx ?? exportDocumentToDocx)(prepared.value);
  if (!exported.ok) return errorResponse(500, "Exporten kunde inte genomföras.");

  const filename = safeAttachmentFilename(exported.value.filename);
  if (!filename || !filename.endsWith(`.${request.format}`) || exported.value.mediaType !== expectedMediaType(request.format)) return errorResponse(500, "Exporten kunde inte genomföras.");
  const bytes = new Uint8Array(exported.value.bytes).buffer;
  return new Response(bytes, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": exported.value.mediaType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}