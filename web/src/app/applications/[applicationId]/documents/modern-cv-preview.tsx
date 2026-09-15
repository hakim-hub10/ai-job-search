import { classifyContactField, cvBodySections, documentNameForCv, classifyCvSection, documentTitleForCv, documentContactForCv, type ContactFieldKind, type DocumentPresentationModel, type DocumentPresentationSection, type DocumentTemplateDefinition } from "@/lib/document-presentation";
import styles from "../../../page.module.css";
import { DocumentExportControls } from "./document-export-controls";
import TemplateSelector from "./template-selector";
import { ProfileIcon, ExperienceIcon, EducationIcon, CertificationIcon, ProjectIcon, LanguageIcon, SkillIcon, MailIcon, PhoneIcon, LocationIcon, LinkedInIcon, GitHubIcon } from "./cv-icons";
import Link from "next/link";

function sidebarSections(sections: DocumentPresentationSection[]) {
  return sections.filter((section) => classifyCvSection(section) === "sidebar");
}

function mainSections(sections: DocumentPresentationSection[]) {
  return sections.filter((section) => classifyCvSection(section) === "main");
}

function normalizedHeading(heading: string): string {
  return heading.toLocaleLowerCase("sv-SE").replace(/[åä]/gu, "a").replace(/ö/gu, "o").trim();
}

function isChipSection(section: DocumentPresentationSection): boolean {
  return ["kompetenser", "skills", "yrkeskompetenser", "professional skills", "personliga kompetenser", "interpersonal skills", "sprak", "languages"].includes(normalizedHeading(section.heading));
}

function isSkillSection(section: DocumentPresentationSection): boolean {
  return ["kompetenser", "skills", "yrkeskompetenser", "professional skills", "personliga kompetenser", "interpersonal skills"].includes(normalizedHeading(section.heading));
}

const MAIN_ICONS: Record<string, () => React.ReactNode> = {
  profil: () => <ProfileIcon />, summary: () => <ProfileIcon />, "professional summary": () => <ProfileIcon />,
  erfarenhet: () => <ExperienceIcon />, experience: () => <ExperienceIcon />, "work experience": () => <ExperienceIcon />,
  utbildning: () => <EducationIcon />, education: () => <EducationIcon />,
  certifieringar: () => <CertificationIcon />, certifications: () => <CertificationIcon />,
  projekt: () => <ProjectIcon />, projects: () => <ProjectIcon />,
};

function mainSectionIcon(section: DocumentPresentationSection): React.ReactNode {
  return (MAIN_ICONS[normalizedHeading(section.heading)] ?? (() => <ProjectIcon />))();
}

const CONTACT_ICONS: Record<ContactFieldKind, () => React.ReactNode> = {
  email: () => <MailIcon />,
  phone: () => <PhoneIcon />,
  linkedin: () => <LinkedInIcon />,
  github: () => <GitHubIcon />,
  location: () => <LocationIcon />,
};

function contactIcon(text: string): React.ReactNode {
  return CONTACT_ICONS[classifyContactField(text)]();
}

function contactRows(contact: string | undefined): { icon: React.ReactNode; text: string }[] {
  if (!contact) return [];
  return contact.split(" · ").map((text) => ({ icon: contactIcon(text), text }));
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
  const main = mainSections(cvBodySections(presentation.sections));
  const name = documentNameForCv(presentation.sections);
  const title = documentTitleForCv(presentation.sections);
  const contact = contactRows(documentContactForCv(presentation.sections));

  return (
    <main className={styles.modernCvPage}>
      <div className={styles.modernCvToolbar}>
        <Link href={`/applications/${encodeURIComponent(applicationId)}/documents/cv`}>← Tillbaka till ansökan</Link>
        <TemplateSelector selectedTemplate={template} />
        <DocumentExportControls applicationId={applicationId} documentType="cv" templateId={template.id} />
      </div>
      <article className={styles.modernCv}>
        <aside className={styles.modernCvSidebar}>
          {contact.length ? (
            <ul className={styles.modernCvContactList}>
              {contact.map((row) => <li key={row.text}>{row.icon}<span>{row.text}</span></li>)}
            </ul>
          ) : null}
          {sidebar.length === 0 ? <p className={styles.modernCvEmpty}>Inga sidofältsektioner finns i dokumentet.</p> : null}
          {sidebar.map((section) => (
            <section className={styles.modernCvSidebarSection} key={section.heading}>
              <h2>{isSkillSection(section) ? <SkillIcon /> : <LanguageIcon />}{section.heading}</h2>
              <ul className={isChipSection(section) ? styles.modernCvPills : undefined}>
                {section.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
          ))}
        </aside>
        <div className={styles.modernCvMain}>
          {name || title ? (
            <div className={styles.modernCvIdentity}>
              {name || title ? <h1>{name || title}</h1> : null}
              {name && title ? <p className={styles.modernCvHeadline}>{title}</p> : null}
            </div>
          ) : null}
          {main.map((section) => (
            <section className={styles.modernCvSection} key={section.heading}>
              <h2>{mainSectionIcon(section)}{section.heading || "Övrigt"}</h2>
              <div className={styles.modernCvSectionBody}>
                {section.items.filter(item => item !== title).map((item) => <p key={item}>{item}</p>)}
              </div>
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
