import Link from "next/link";

import { cvBodySections, documentNameForCv, documentTitleForCv, documentContactForCv, type DocumentPresentationModel, type DocumentPresentationSection, type DocumentTemplateDefinition } from "@/lib/document-presentation";
import styles from "../../../page.module.css";
import { DocumentExportControls } from "./document-export-controls";
import TemplateSelector from "./template-selector";

function normalizedHeading(heading: string): string {
  return heading.toLocaleLowerCase("sv-SE").replace(/[åä]/gu, "a").replace(/ö/gu, "o").trim();
}

function order(section: DocumentPresentationSection): number {
  const heading = normalizedHeading(section.heading);
  const ranks: Record<string, number> = {
    profil: 1, summary: 1, "professional summary": 1, experience: 2, erfarenhet: 2, "work experience": 2,
    utbildning: 3, education: 3, kompetenser: 4, skills: 4, yrkeskompetenser: 4, "professional skills": 4, "personliga kompetenser": 4, "interpersonal skills": 4, certifieringar: 5,
    certifications: 5, projekt: 6, projects: 6, sprak: 7, languages: 7, kontakt: 8, contact: 8,
  };
  return ranks[heading] ?? 9;
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
  const ordered = cvBodySections(presentation.sections).sort((a, b) => order(a) - order(b));
  const name = documentNameForCv(presentation.sections);
  const title = documentTitleForCv(presentation.sections);
  const contact = documentContactForCv(presentation.sections);

  return (
    <main className={styles.classicCvPage}>
      <div className={styles.classicCvToolbar}>
        <Link href={`/applications/${encodeURIComponent(applicationId)}/documents/cv`}>← Tillbaka till ansökan</Link>
        <TemplateSelector selectedTemplate={template} />
        <DocumentExportControls applicationId={applicationId} documentType="cv" templateId={template.id} />
      </div>
      <article className={styles.classicCv}>
        <header className={styles.classicCvHeader}>
          {name || title ? <h1>{name || title}</h1> : null}
          {name && title ? <p className={styles.classicCvHeadline}>{title}</p> : null}
          {contact ? <p className={styles.classicCvContact}>{contact}</p> : null}
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
