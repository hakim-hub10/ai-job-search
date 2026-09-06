import type { ApplicationDocumentRecord } from "../../../.agents/job-search/cli/src/application-document-repository";

export type DocumentTemplateId = "modern" | "classic" | "minimal";
export type PresentationDocumentType = "cv" | "coverLetter";
export type CvRendererId = "modern" | "classic" | "minimal" | "shared";

export type CoverLetterRendererId = "modern" | "classic" | "minimal";

export function coverLetterRendererForTemplate(
  documentType: PresentationDocumentType,
  templateId: DocumentTemplateId,
): CoverLetterRendererId | "shared" {
  return documentType === "coverLetter" ? templateId : "shared";
}

export function cvRendererForTemplate(
  documentType: PresentationDocumentType,
  templateId: DocumentTemplateId,
): CvRendererId {
  if (documentType !== "cv") return "shared";
  return templateId;
}

export interface DocumentTemplateDefinition {
  id: DocumentTemplateId;
  label: string;
  description: string;
  supportedDocumentTypes: readonly PresentationDocumentType[];
  layout: "editorial" | "traditional" | "compact";
}

export interface DocumentPresentationSection {
  heading: string;
  items: string[];
}

export type CvSectionColumn = "sidebar" | "main";

function normalizedHeading(heading: string): string {
  return heading.toLocaleLowerCase("sv-SE").replace(/[åä]/gu, "a").replace(/ö/gu, "o").trim();
}

export function classifyCvSection(section: DocumentPresentationSection): CvSectionColumn {
  const sidebarHeadings = new Set([
    "kontakt", "contact", "kontakta", "kompetenser", "kompetens", "skills", "skill",
    "certifieringar", "certifiering", "certifications", "certification", "sprak", "languages",
    "links", "lankar", "lankar / links",
  ]);
  return sidebarHeadings.has(normalizedHeading(section.heading)) ? "sidebar" : "main";
}

export function documentTitleForCv(
  sections: DocumentPresentationSection[],
): string | undefined {
  const titleSection = sections.find((section) => {
    const heading = section.heading.toLocaleLowerCase("sv-SE").replace(/[åä]/gu, "a").replace(/ö/gu, "o").trim();
    return heading === "profil" || heading === "summary" || heading === "headline";
  });
  return titleSection?.items[0];
}

export interface DocumentPresentationModel {
  documentType: PresentationDocumentType;
  version: number;
  createdAt: string;
  sections: DocumentPresentationSection[];
  rawContent: string;
}

export type TemplateResolution =
  | { ok: true; selected: false; template: DocumentTemplateDefinition }
  | { ok: true; selected: true; template: DocumentTemplateDefinition }
  | { ok: false; code: "INVALID_TEMPLATE"; fallback: DocumentTemplateDefinition };

const allDocumentTypes: readonly PresentationDocumentType[] = ["cv", "coverLetter"];

export const DOCUMENT_TEMPLATES: readonly DocumentTemplateDefinition[] = [
  {
    id: "modern",
    label: "Modern",
    description: "Tvåkolumnsdesign med tydlig sidopanel.",
    supportedDocumentTypes: allDocumentTypes,
    layout: "editorial",
  },
  {
    id: "classic",
    label: "Klassisk",
    description: "Formell och tidlös layout med tydlig struktur.",
    supportedDocumentTypes: allDocumentTypes,
    layout: "traditional",
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Ren och luftig design med fokus på innehållet.",
    supportedDocumentTypes: allDocumentTypes,
    layout: "compact",
  },
];

const defaultTemplate = DOCUMENT_TEMPLATES[0];

function isDocumentType(value: string): value is PresentationDocumentType {
  return value === "cv" || value === "coverLetter";
}

export function resolveDocumentTemplate(templateId?: string): TemplateResolution {
  if (!templateId) return { ok: true, selected: false, template: defaultTemplate };
  const template = DOCUMENT_TEMPLATES.find((item) => item.id === templateId);
  return template
    ? { ok: true, selected: true, template }
    : { ok: false, code: "INVALID_TEMPLATE", fallback: defaultTemplate };
}

export function templateQueryHref(
  pathname: string,
  currentSearch: string,
  templateId: DocumentTemplateId,
): string {
  const params = new URLSearchParams(currentSearch);
  params.set("template", templateId);
  return `${pathname}?${params.toString()}`;
}

function parseSections(content: string): DocumentPresentationSection[] {
  const sections: DocumentPresentationSection[] = [];
  let current: DocumentPresentationSection | null = null;

  for (const line of content.split(/\r?\n/u)) {
    const heading = /^\\?##\s+(.+)$/u.exec(line.trim());
    if (heading) {
      current = { heading: heading[1], items: [] };
      sections.push(current);
      continue;
    }
    const item = /^[-*]\s+(.+)$/u.exec(line.trim());
    if (item) {
      const escapedHeading = /^\\?##\s+(.+)$/u.exec(item[1]);
      if (escapedHeading) {
        current = { heading: escapedHeading[1], items: [] };
        sections.push(current);
        continue;
      }
      if (!current) {
        current = { heading: "", items: [] };
        sections.push(current);
      }
      current.items.push(item[1]);
    }
  }

  return sections.filter((section) => section.heading || section.items.length > 0);
}

export function toDocumentPresentationModel(
  record: ApplicationDocumentRecord,
): DocumentPresentationModel {
  const documentType = isDocumentType(record.documentType) ? record.documentType : "cv";
  return {
    documentType,
    version: record.version,
    createdAt: record.createdAt,
    sections: parseSections(record.renderedDocument.content),
    rawContent: record.renderedDocument.content,
  };
}
