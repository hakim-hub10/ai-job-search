import type { ApplicationDocumentRecord } from "../../../.agents/job-search/cli/src/application-document-repository";

export type DocumentTemplateId = "modern" | "classic" | "minimal";
export type PresentationDocumentType = "cv" | "coverLetter";

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
    description: "Luftig layout med tydlig visuell hierarki.",
    supportedDocumentTypes: allDocumentTypes,
    layout: "editorial",
  },
  {
    id: "classic",
    label: "Klassisk",
    description: "Traditionell layout med markerade avsnitt.",
    supportedDocumentTypes: allDocumentTypes,
    layout: "traditional",
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Kompakt layout med fokus på innehållet.",
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

function parseSections(content: string): DocumentPresentationSection[] {
  const sections: DocumentPresentationSection[] = [];
  let current: DocumentPresentationSection | null = null;

  for (const line of content.split(/\r?\n/u)) {
    const heading = /^##\s+(.+)$/u.exec(line.trim());
    if (heading) {
      current = { heading: heading[1], items: [] };
      sections.push(current);
      continue;
    }
    const item = /^[-*]\s+(.+)$/u.exec(line.trim());
    if (item) {
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
