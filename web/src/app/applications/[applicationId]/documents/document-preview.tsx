import Link from "next/link";

import { coverLetterRendererForTemplate, cvRendererForTemplate, type CoverLetterHeaderInfo, type DocumentPresentationModel, type DocumentTemplateDefinition } from "@/lib/document-presentation";
import TemplateSelector from "./template-selector";
import ModernCvPreview from "./modern-cv-preview";
import ClassicCvPreview from "./classic-cv-preview";
import MinimalCvPreview from "./minimal-cv-preview";
import ModernCoverLetterPreview from "./modern-cover-letter-preview";
import ClassicCoverLetterPreview from "./classic-cover-letter-preview";
import MinimalCoverLetterPreview from "./minimal-cover-letter-preview";

export function DocumentPreview({
  applicationId,
  presentation,
  template,
  editPath,
  coverLetterHeader,
}: {
  applicationId: string;
  presentation: DocumentPresentationModel;
  template: DocumentTemplateDefinition;
  editPath: string;
  coverLetterHeader?: CoverLetterHeaderInfo;
}) {
  const renderer = cvRendererForTemplate(presentation.documentType, template.id);

  if (renderer === "modern") {
    return (
      <ModernCvPreview
        applicationId={applicationId}
        presentation={presentation}
        template={template}
      />
    );
  }

  if (renderer === "classic") {
    return <ClassicCvPreview applicationId={applicationId} presentation={presentation} template={template} />;
  }

  if (renderer === "minimal") {
    return <MinimalCvPreview applicationId={applicationId} presentation={presentation} template={template} />;
  }

  const coverLetterRenderer = coverLetterRendererForTemplate(presentation.documentType, template.id);
  if (coverLetterRenderer === "modern") return <ModernCoverLetterPreview applicationId={applicationId} presentation={presentation} template={template} header={coverLetterHeader} />;
  if (coverLetterRenderer === "classic") return <ClassicCoverLetterPreview applicationId={applicationId} presentation={presentation} template={template} header={coverLetterHeader} />;
  if (coverLetterRenderer === "minimal") return <MinimalCoverLetterPreview applicationId={applicationId} presentation={presentation} template={template} header={coverLetterHeader} />;

  return (
    <main className={`documentPage documentPage-${template.layout}`}>
      <Link href={`/applications/${encodeURIComponent(applicationId)}/documents/${presentation.documentType === "cv" ? "cv" : "cover-letter"}`}>
        ← Tillbaka till ansökan
      </Link>
      <header className="documentHeader">
        <p>DOKUMENT</p>
        <h1>{presentation.documentType === "cv" ? "CV" : "Personligt brev"}</h1>
        <p>Version {presentation.version} · Skapad: {presentation.createdAt}</p>
        <p>Detta är ett internt dokument som ska granskas av användaren.</p>
        <p><Link href={editPath}>Redigera</Link></p>
        <TemplateSelector selectedTemplate={template} />
      </header>
      <article className="documentPreview">
        {presentation.sections.map((section, index) => (
          <section className="documentSection" key={`${section.heading}-${index}`}>
            {section.heading ? <h2>{section.heading}</h2> : null}
            {section.items.map((item) => <p key={item}>{item}</p>)}
          </section>
        ))}
      </article>
    </main>
  );
}
