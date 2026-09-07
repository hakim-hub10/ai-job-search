import Link from "next/link";

import { classifyCvSection, documentTitleForCv, type DocumentPresentationModel, type DocumentPresentationSection, type DocumentTemplateDefinition } from "@/lib/document-presentation";
import styles from "../../../page.module.css";
import { DocumentExportControls } from "./document-export-controls";
import TemplateSelector from "./template-selector";

function sidebarSections(sections: DocumentPresentationSection[]) {
  return sections.filter((section) => classifyCvSection(section) === "sidebar");
}

function mainSections(sections: DocumentPresentationSection[]) {
  return sections.filter((section) => classifyCvSection(section) === "main");
}

export default function ModernCvPreview({
  applicationId,
  presentation,
  template,
}: {
  applicationId: string;
  presentation: DocumentPresentationModel;
  template: DocumentTemplateDefinition;
}) {
  const sidebar = sidebarSections(presentation.sections);
  const main = mainSections(presentation.sections);
  const title = documentTitleForCv(presentation.sections);

  return (
    <main className={styles.modernCvPage}>
      <div className={styles.modernCvToolbar}>
        <Link href={`/applications/${encodeURIComponent(applicationId)}/documents/cv`}>← Tillbaka till ansökan</Link>
        <TemplateSelector selectedTemplate={template} />
        <DocumentExportControls applicationId={applicationId} documentType="cv" templateId={template.id} />
      </div>
      <article className={styles.modernCv}>
        <aside className={styles.modernCvSidebar}>
          {sidebar.length === 0 ? <p className={styles.modernCvEmpty}>Inga sidofältsektioner finns i dokumentet.</p> : null}
          {sidebar.map((section) => (
            <section className={styles.modernCvSidebarSection} key={section.heading}>
              <h2>{section.heading}</h2>
              <ul>
                {section.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
          ))}
        </aside>
        <div className={styles.modernCvMain}>
          <header className={styles.modernCvHeader}>
            <p className={styles.modernCvKicker}>CURRICULUM VITAE</p>
            {title ? <h1>{title}</h1> : null}
            <p className={styles.modernCvMeta}>Version {presentation.version} · Skapad {presentation.createdAt}</p>
          </header>
          {main.map((section) => (
            <section className={styles.modernCvSection} key={section.heading}>
              <h2>{section.heading || "Övrigt"}</h2>
              <div className={styles.modernCvSectionBody}>
                {section.items.map((item) => <p key={item}>{item}</p>)}
              </div>
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
