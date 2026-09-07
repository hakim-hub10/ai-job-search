import type { DocumentType } from "../../../.agents/job-search/cli/src/application-documents";
import type { ApplicationDocumentRecord, ApplicationDocumentRepository } from "../../../.agents/job-search/cli/src/application-document-repository";
import { DOCUMENT_TEMPLATES, resolveDocumentTemplate, toDocumentPresentationModel, type DocumentPresentationModel, type DocumentTemplateId } from "./document-presentation";

export const MAX_DOCUMENT_EXPORT_LENGTH = 20_000;

export type DocumentExportFormat = "pdf" | "docx";

export interface DocumentExportRequest {
  applicationId: string;
  documentType: DocumentType;
  templateId: DocumentTemplateId;
  format: DocumentExportFormat;
}

export interface DocumentExportFormatDefinition {
  format: DocumentExportFormat;
  extension: "pdf" | "docx";
  mediaType: "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

export interface DocumentExportModel {
  applicationId: string;
  documentType: DocumentType;
  documentVersion: number;
  templateId: DocumentTemplateId;
  presentation: DocumentPresentationModel;
  format: DocumentExportFormatDefinition;
  suggestedFilename: string;
}

export type DocumentExportPreparationErrorCode =
  | "INVALID_APPLICATION_ID"
  | "INVALID_DOCUMENT_TYPE"
  | "INVALID_TEMPLATE"
  | "INVALID_FORMAT"
  | "DOCUMENT_NOT_FOUND"
  | "DOCUMENT_STORAGE_FAILURE"
  | "EXPORT_PREPARATION_FAILED";

export interface DocumentExportPreparationError {
  code: DocumentExportPreparationErrorCode;
  message: string;
}

export type DocumentExportPreparationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DocumentExportPreparationError };

const FORMAT_DEFINITIONS: Record<DocumentExportFormat, DocumentExportFormatDefinition> = {
  pdf: { format: "pdf", extension: "pdf", mediaType: "application/pdf" },
  docx: { format: "docx", extension: "docx", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
};

function failure<T>(code: DocumentExportPreparationErrorCode, message: string): DocumentExportPreparationResult<T> {
  return { ok: false, error: { code, message } };
}

function isDocumentType(value: unknown): value is DocumentType {
  return value === "cv" || value === "coverLetter";
}

function isTemplateId(value: unknown): value is DocumentTemplateId {
  return DOCUMENT_TEMPLATES.some((template) => template.id === value);
}

function isFormat(value: unknown): value is DocumentExportFormat {
  return value === "pdf" || value === "docx";
}

function safeFilenamePart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("sv-SE")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40) || "document";
}

export function suggestedDocumentFilename(
  documentType: DocumentType,
  templateId: DocumentTemplateId,
  version: number,
  format: DocumentExportFormat,
): string {
  const typePart = documentType === "cv" ? "cv" : "personligt-brev";
  return `${safeFilenamePart(typePart)}-${safeFilenamePart(templateId)}-v${version}.${FORMAT_DEFINITIONS[format].extension}`;
}

export function documentExportFormat(format: unknown): DocumentExportFormatDefinition | null {
  return isFormat(format) ? FORMAT_DEFINITIONS[format] : null;
}

/** Removes only characters forbidden by XML 1.0 while preserving normal document Unicode. */
export function sanitizeDocumentExportText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, "");
}

export function sanitizedDocumentExportModel(model: DocumentExportModel): DocumentExportModel | null {
  if (!model.presentation || !Array.isArray(model.presentation.sections) || typeof model.presentation.rawContent !== "string") return null;
  const sections: DocumentPresentationModel["sections"] = [];
  for (const section of model.presentation.sections) {
    if (!section || typeof section.heading !== "string" || !Array.isArray(section.items) || !section.items.every((item) => typeof item === "string")) return null;
    sections.push({ heading: sanitizeDocumentExportText(section.heading), items: section.items.map(sanitizeDocumentExportText) });
  }
  return {
    ...model,
    presentation: {
      ...model.presentation,
      rawContent: sanitizeDocumentExportText(model.presentation.rawContent),
      sections,
    },
  };
}

export interface PrepareDocumentExportDependencies {
  documentRepository: ApplicationDocumentRepository;
}

export async function prepareDocumentExport(
  request: DocumentExportRequest,
  dependencies: PrepareDocumentExportDependencies,
): Promise<DocumentExportPreparationResult<DocumentExportModel>> {
  if (typeof request?.applicationId !== "string" || request.applicationId.trim().length === 0) return failure("INVALID_APPLICATION_ID", "Application ID is required.");
  if (!isDocumentType(request.documentType)) return failure("INVALID_DOCUMENT_TYPE", "Document type is not supported.");
  if (!isTemplateId(request.templateId) || !resolveDocumentTemplate(request.templateId).ok) return failure("INVALID_TEMPLATE", "Document template is not supported.");
  const format = documentExportFormat(request.format);
  if (!format) return failure("INVALID_FORMAT", "Export format is not supported.");

  let latest: Awaited<ReturnType<ApplicationDocumentRepository["getLatest"]>>;
  try {
    latest = await dependencies.documentRepository.getLatest(request.applicationId.trim(), request.documentType);
  } catch {
    return failure("DOCUMENT_STORAGE_FAILURE", "Document storage could not be read.");
  }
  if (!latest.ok) {
    return latest.error.code === "NOT_FOUND"
      ? failure("DOCUMENT_NOT_FOUND", "Document version was not found.")
      : failure("DOCUMENT_STORAGE_FAILURE", "Document storage could not be read.");
  }

  const record: ApplicationDocumentRecord = latest.value;
  if (record.applicationId !== request.applicationId || record.documentType !== request.documentType || !Number.isInteger(record.version) || record.version < 1 || typeof record.renderedDocument?.content !== "string" || record.renderedDocument.content.length > MAX_DOCUMENT_EXPORT_LENGTH) {
    return failure("EXPORT_PREPARATION_FAILED", "Document export could not be prepared.");
  }
  try {
    const presentation = toDocumentPresentationModel({
      ...record,
      renderedDocument: { ...record.renderedDocument, content: sanitizeDocumentExportText(record.renderedDocument.content) },
    });
    return {
      ok: true,
      value: {
        applicationId: record.applicationId,
        documentType: record.documentType,
        documentVersion: record.version,
        templateId: request.templateId,
        presentation,
        format,
        suggestedFilename: suggestedDocumentFilename(record.documentType, request.templateId, record.version, request.format),
      },
    };
  } catch {
    return failure("EXPORT_PREPARATION_FAILED", "Document export could not be prepared.");
  }
}