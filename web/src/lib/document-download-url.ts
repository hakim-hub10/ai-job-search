import type { DocumentTemplateId, PresentationDocumentType } from "./document-presentation";

export type DocumentDownloadFormat = "pdf" | "docx";

export function documentDownloadHref(
  applicationId: string,
  documentType: PresentationDocumentType,
  templateId: DocumentTemplateId,
  format: DocumentDownloadFormat,
): string {
  const query = new URLSearchParams({ documentType, template: templateId, format });
  return `/applications/${encodeURIComponent(applicationId)}/documents/export?${query.toString()}`;
}