import Link from "next/link";

import { documentTitleForCv, type DocumentPresentationModel, type DocumentPresentationSection, type DocumentTemplateDefinition } from "@/lib/document-presentation";
import styles from "../../../page.module.css";
import { DocumentExportControls } from "./document-export-controls";
import TemplateSelector from "./template-selector";

function normalizedHeading(heading: string): string {
  return heading.toLocaleLowerCase("sv-SE").replace(/[åä]/gu, "a").replace(/ö/gu, "o").trim();
}

function order(section: DocumentPresentationSection): number {
  const heading = normalizedHeading(section.heading);
  const ranks: Record<string, number> = {
    profil: 1, summary: 1, experience: 2, erfarenhet: 2, "work experience": 2,
    utbildning: 3, education: 3, kompetenser: 4, skills: 4, certifieringar: 5,
    certifications: 5, sprak: 6, languages: 6, kontakt: 7, contact: 7,
  };
  return ranks[heading] ?? 8;
}

export default function ClassicCvPreview({
  applicationId,
  presentation,
  template,
}: {
  applicationId: string;
  presentation: DocumentPresentationModel;
  template: DocumentTemplateDefinition;
}) {
  const ordered = [...presentation.sections].sort((a, b) => order(a) - order(b));
  const title = documentTitleForCv(ordered);

  return (
    <main className={styles.classicCvPage}>
      <div className={styles.classicCvToolbar}>
        <Link href={`/applications/${encodeURIComponent(applicationId)}/documents/cv`}>← Tillbaka till ansökan</Link>
        <TemplateSelector selectedTemplate={template} />
        <DocumentExportControls applicationId={applicationId} documentType="cv" templateId={template.id} />
      </div>
      <article className={styles.classicCv}>
        <header className={styles.classicCvHeader}>
          <p className={styles.classicCvLabel}>CURRICULUM VITAE</p>
          {title ? <h1>{title}</h1> : null}
          <p>Version {presentation.version} · Skapad {presentation.createdAt}</p>
        </header>
        {ordered.map((section) => (
          <section className={styles.classicCvSection} key={section.heading}>
            <h2>{section.heading || "Övrigt"}</h2>
            <div>
              {section.items.map((item) => <p key={item}>{item}</p>)}
            </div>
          </section>
        ))}
      </article>
    </main>
  );
}
