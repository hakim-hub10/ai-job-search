import Link from "next/link";

import type { DocumentPresentationModel, DocumentTemplateDefinition } from "@/lib/document-presentation";
import TemplateSelector from "./template-selector";
import ModernCvPreview from "./modern-cv-preview";

export function DocumentPreview({
  applicationId,
  presentation,
  template,
  editPath,
}: {
  applicationId: string;
  presentation: DocumentPresentationModel;
  template: DocumentTemplateDefinition;
  editPath: string;
}) {
  if (presentation.documentType === "cv" && template.id === "modern") {
    return (
      <ModernCvPreview
        applicationId={applicationId}
        presentation={presentation}
        template={template}
      />
    );
  }

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
