import Link from "next/link";

import { documentTitleForCv, type DocumentPresentationModel, type DocumentTemplateDefinition } from "@/lib/document-presentation";
import styles from "../../../page.module.css";
import { DocumentExportControls } from "./document-export-controls";
import TemplateSelector from "./template-selector";

export default function MinimalCvPreview({
  applicationId,
  presentation,
  template,
}: {
  applicationId: string;
  presentation: DocumentPresentationModel;
  template: DocumentTemplateDefinition;
}) {
  const title = documentTitleForCv(presentation.sections);

  return (
    <main className={styles.minimalCvPage}>
      <div className={styles.minimalCvToolbar}>
        <Link href={`/applications/${encodeURIComponent(applicationId)}/documents/cv`}>← Tillbaka till ansökan</Link>
        <TemplateSelector selectedTemplate={template} />
        <DocumentExportControls applicationId={applicationId} documentType="cv" templateId={template.id} />
      </div>
      <article className={styles.minimalCv}>
        <header className={styles.minimalCvHeader}>
          {title ? <h1>{title}</h1> : null}
          <p>Version {presentation.version} · {presentation.createdAt}</p>
        </header>
        <div className={styles.minimalCvBody}>
          {presentation.sections.map((section) => (
            <section className={styles.minimalCvSection} key={section.heading}>
              <h2>{section.heading || "Övrigt"}</h2>
              {section.items.map((item) => <p key={item}>{item}</p>)}
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
