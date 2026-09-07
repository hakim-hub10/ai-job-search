import type { DocumentTemplateId, PresentationDocumentType } from "@/lib/document-presentation";
import { documentDownloadHref } from "@/lib/document-download-url";
import styles from "../../../page.module.css";

export function DocumentExportControls({
  applicationId,
  documentType,
  templateId,
}: {
  applicationId: string;
  documentType: PresentationDocumentType;
  templateId: DocumentTemplateId;
}) {
  return (
    <section className={styles.documentExport} aria-label="Exportera dokument">
      <span>Exportera dokument</span>
      <div>
        <a href={documentDownloadHref(applicationId, documentType, templateId, "pdf")}>Ladda ner PDF</a>
        <a href={documentDownloadHref(applicationId, documentType, templateId, "docx")}>Ladda ner Word</a>
      </div>
    </section>
  );
}