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
  kind?: "identity";
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
    "links", "lankar", "lankar / links", "yrkeskompetenser", "professional skills", "personliga kompetenser", "interpersonal skills",
  ]);
  return sidebarHeadings.has(normalizedHeading(section.heading)) ? "sidebar" : "main";
}

export function documentTitleForCv(
  sections: DocumentPresentationSection[],
): string | undefined {
  const titleSection = sections.find((section) => {
    const heading = section.heading.toLocaleLowerCase("sv-SE").replace(/[åä]/gu, "a").replace(/ö/gu, "o").trim();
    return heading === "profil" || heading === "summary" || heading === "professional summary" || heading === "headline";
  });
  return titleSection?.items[0];
}

/** The identity header line is "Name | email | phone | ..." (name first, see compareEvidence in the CLI's document-tailoring.ts) - only the name belongs in the large CV heading. */
function identitySegments(sections: DocumentPresentationSection[]): string[] {
  const line = sections.find(section => section.kind === "identity")?.items.join(" | ");
  return line ? line.split(" | ").map(segment => segment.trim()).filter(Boolean) : [];
}
export function documentNameForCv(sections: DocumentPresentationSection[]): string | undefined {
  return identitySegments(sections)[0];
}
/** Email, phone and any other contact segments - rendered smaller/secondary, never mixed into the name heading. */
export function documentContactForCv(sections: DocumentPresentationSection[]): string | undefined {
  const [, ...contact] = identitySegments(sections);
  return contact.length ? contact.join(" · ") : undefined;
}
export function cvBodySections(sections: DocumentPresentationSection[]): DocumentPresentationSection[] {
  const title = documentTitleForCv(sections);
  return sections.filter(section => section.kind !== "identity").map(section => ({ ...section, items: section.items.filter(item => item !== title) })).filter(section => section.items.length);
}

export interface DocumentPresentationModel {
  documentType: PresentationDocumentType;
  language?: "sv" | "en";
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

/**
 * document-rendering.ts (CLI) HTML-escapes &, < and > so the markdown stays
 * safe even if a consumer ever embeds it as HTML. Every consumer that shows
 * this content as plain text - the presentation model here, and the raw
 * document-editor textarea in document-editor.ts - must decode it back, or
 * the reader sees literal "&amp;" where a company name or skill has an
 * ampersand (e.g. "H&M", "Records management & filing").
 */
export function decodeDocumentEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39);/gu, entity => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" }[entity] ?? entity));
}
function parseSections(content: string): DocumentPresentationSection[] {
  const sections: DocumentPresentationSection[] = [];
  let current: DocumentPresentationSection | null = null;

  for (const line of content.split(/\r?\n/u)) {
    const decoded = decodeDocumentEntities(line);
    const heading = /^\\?##\s+([\s\S]+)$/u.exec(decoded.trim());
    if (heading) {
      current = { heading: heading[1], items: [] };
      sections.push(current);
      continue;
    }
    const item = /^[-*]\s+([\s\S]+)$/u.exec(decoded.trim());
    if (item) {
      const escapedHeading = /^\\?##\s+([\s\S]+)$/u.exec(item[1]);
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
    } else if (decoded.trim()) {
      if (/^#\s/u.test(decoded.trim())) {
        current = { kind: "identity", heading: "", items: [decoded.trim().replace(/^#\s+/u, "")] }; sections.push(current);
      } else {
        if (!current) { current = { heading: "", items: [] }; sections.push(current); }
        current.items.push(decoded.trim());
      }
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
    language: record.renderedDocument.language,
    version: record.version,
    createdAt: record.createdAt,
    sections: parseSections(record.renderedDocument.content),
    rawContent: record.renderedDocument.content,
  };
}
