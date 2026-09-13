import Link from "next/link";

import type { DocumentPresentationModel, DocumentTemplateDefinition } from "@/lib/document-presentation";
import styles from "../../../page.module.css";
import { DocumentExportControls } from "./document-export-controls";
import TemplateSelector from "./template-selector";

export default function ModernCoverLetterPreview({
  applicationId,
  presentation,
  template,
}: {
  applicationId: string;
  presentation: DocumentPresentationModel;
  template: DocumentTemplateDefinition;
}) {
  return (
    <main className={styles.modernLetterPage}>
      <div className={styles.modernLetterToolbar}>
        <Link href={`/applications/${encodeURIComponent(applicationId)}/documents/cover-letter`}>← Tillbaka till ansökan</Link>
        <TemplateSelector selectedTemplate={template} />
        <DocumentExportControls applicationId={applicationId} documentType="coverLetter" templateId={template.id} />
      </div>
      <article className={styles.modernLetter}>
        <div className={styles.modernLetterRail} aria-hidden="true" />
        <div className={styles.modernLetterContent}>

          {presentation.sections.map((section) => (
            <section className={styles.modernLetterSection} key={section.heading}>
              {section.heading ? <h2>{section.heading}</h2> : null}
              {section.items.map((item) => <p key={item}>{item}</p>)}
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
