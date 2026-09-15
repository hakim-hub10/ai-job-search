import Link from "next/link";

import { coverLetterApplicationLabel, type CoverLetterHeaderInfo, type DocumentPresentationModel, type DocumentTemplateDefinition } from "@/lib/document-presentation";
import styles from "../../../page.module.css";
import { DocumentExportControls } from "./document-export-controls";
import TemplateSelector from "./template-selector";

export default function ModernCoverLetterPreview({
  applicationId,
  presentation,
  template,
  header,
}: {
  applicationId: string;
  presentation: DocumentPresentationModel;
  template: DocumentTemplateDefinition;
  header?: CoverLetterHeaderInfo;
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
          {header?.candidateName || header?.candidateEmail || header?.date || header?.jobTitle || header?.employerName ? (
            <div className={styles.modernLetterHeader}>
              {header.candidateName ? <p className={styles.modernLetterHeaderName}>{header.candidateName}</p> : null}
              {header.candidateEmail ? <p>{header.candidateEmail}</p> : null}
              {header.date ? <p>{header.date}</p> : null}
              {header.jobTitle ? <p>{coverLetterApplicationLabel(presentation.language)}: {header.jobTitle}</p> : null}
              {header.employerName ? <p>{header.employerName}{header.employerLocation ? `, ${header.employerLocation}` : ""}</p> : null}
            </div>
          ) : null}
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
