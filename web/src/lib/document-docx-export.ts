import {
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

import { classifyCvSection, documentTitleForCv, type DocumentPresentationSection } from "./document-presentation";
import { sanitizedDocumentExportModel, type DocumentExportModel } from "./document-export";

export interface ExportedDocxDocument {
  bytes: Uint8Array;
  filename: string;
  mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

export type DocumentDocxExportErrorCode = "DOCX_EXPORT_FAILED" | "UNSUPPORTED_DOCX_TEMPLATE" | "INVALID_EXPORT_MODEL";
export interface DocumentDocxExportError { code: DocumentDocxExportErrorCode; message: string }
export type DocumentDocxExportResult =
  | { ok: true; value: ExportedDocxDocument }
  | { ok: false; error: DocumentDocxExportError };

const DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const;
const A4_WIDTH = 11906;
const A4_HEIGHT = 16838;
const PAGE_MARGIN = 1134;
const MODERN_ACCENT = "C8A96B";
const MODERN_DARK = "24313B";
const CLASSIC_DARK = "30353A";
const MINIMAL_DARK = "53616D";

function failure(code: DocumentDocxExportErrorCode, message: string): DocumentDocxExportResult {
  return { ok: false, error: { code, message } };
}

function text(value: string, options: { bold?: boolean; color?: string; size?: number } = {}): TextRun {
  return new TextRun({ text: value, font: "Arial", ...options });
}

function label(model: DocumentExportModel): string {
  return model.documentType === "cv" ? "CURRICULUM VITAE" : "PERSONLIGT BREV";
}

function heading(section: DocumentPresentationSection, style = "SectionHeading"): Paragraph {
  return new Paragraph({
    style,
    keepNext: true,
    children: [text(section.heading || "Övrigt")],
  });
}

function sectionParagraphs(sections: readonly DocumentPresentationSection[], style = "SectionHeading"): Paragraph[] {
  return sections.flatMap((section) => [
    heading(section, style),
    ...section.items.map((item) => new Paragraph({ style: "Body", bullet: { level: 0 }, children: [text(item)] })),
  ]);
}

function titleParagraph(model: DocumentExportModel, color: string, includeCvTitle: boolean): Paragraph[] {
  const title = includeCvTitle ? documentTitleForCv(model.presentation.sections) : undefined;
  return [
    new Paragraph({ style: "DocumentLabel", children: [text(label(model), { bold: true, color })] }),
    ...(title ? [new Paragraph({ style: "DocumentTitle", children: [text(title, { bold: true, color })] })] : []),
  ];
}

function modernCv(model: DocumentExportModel): Table {
  const sidebar = model.presentation.sections.filter((section) => classifyCvSection(section) === "sidebar");
  const main = model.presentation.sections.filter((section) => classifyCvSection(section) === "main");
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [3050, 6588],
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    },
    rows: [new TableRow({
      children: [
        new TableCell({
          width: { size: 3050, type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: MODERN_DARK },
          margins: { top: 220, bottom: 220, left: 220, right: 180 },
          children: [
            new Paragraph({ style: "SidebarLabel", children: [text("CURRICULUM VITAE", { bold: true, color: "F7F8F9" })] }),
            ...sidebar.flatMap((section) => [
              heading(section, "SidebarHeading"),
              ...section.items.map((item) => new Paragraph({
                style: "SidebarBody",
                children: [text("• ", { color: "F7F8F9" }), text(item, { color: "F7F8F9" })],
              })),
            ]),
          ],
        }),
        new TableCell({
          width: { size: 6588, type: WidthType.DXA },
          margins: { top: 220, bottom: 220, left: 340, right: 120 },
          children: [...titleParagraph(model, MODERN_DARK, true), ...sectionParagraphs(main, "ModernHeading")],
        }),
      ],
    })],
  });
}

function modernLetter(model: DocumentExportModel): Paragraph[] {
  return [
    ...titleParagraph(model, MODERN_DARK, false),
    ...model.presentation.sections.flatMap((section) => [
      heading(section, "ModernHeading"),
      ...section.items.map((item) => new Paragraph({
        style: "Body",
        border: { left: { style: BorderStyle.SINGLE, size: 16, color: MODERN_ACCENT, space: 12 } },
        children: [text(item)],
      })),
    ]),
  ];
}

function singleColumn(model: DocumentExportModel, variant: "classic" | "minimal"): Paragraph[] {
  const color = variant === "classic" ? CLASSIC_DARK : MINIMAL_DARK;
  const headingStyle = variant === "classic" ? "ClassicHeading" : "MinimalHeading";
  const sections = model.templateId === "classic" && model.documentType === "cv"
    ? [...model.presentation.sections]
    : model.presentation.sections;
  return [
    ...titleParagraph(model, color, model.documentType === "cv"),
    ...sectionParagraphs(sections, headingStyle),
  ];
}

function documentFor(model: DocumentExportModel): Document {
  const children = model.templateId === "modern"
    ? model.documentType === "cv" ? [modernCv(model)] : modernLetter(model)
    : singleColumn(model, model.templateId);
  return new Document({
    styles: {
      default: { document: { run: { font: "Arial", size: 21, color: "20252B" } } },
      paragraphStyles: [
        { id: "DocumentLabel", name: "Document Label", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Arial", size: 18, characterSpacing: 18 }, paragraph: { spacing: { after: 120 } } },
        { id: "DocumentTitle", name: "Document Title", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Arial", size: 34 }, paragraph: { spacing: { after: 180 }, keepNext: true } },
        { id: "SectionHeading", name: "Section Heading", basedOn: "Normal", next: "Body", quickFormat: true, run: { font: "Arial", size: 24, bold: true, color: CLASSIC_DARK }, paragraph: { spacing: { before: 220, after: 70 }, keepNext: true, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "B9C0C6", space: 6 } } } },
        { id: "ModernHeading", name: "Modern Heading", basedOn: "SectionHeading", next: "Body", quickFormat: true, run: { font: "Arial", size: 24, bold: true, color: MODERN_DARK }, paragraph: { spacing: { before: 220, after: 70 }, keepNext: true } },
        { id: "ClassicHeading", name: "Classic Heading", basedOn: "SectionHeading", next: "Body", quickFormat: true, run: { font: "Arial", size: 26, bold: true, color: CLASSIC_DARK }, paragraph: { spacing: { before: 240, after: 70 }, keepNext: true, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "9CA4AA", space: 6 } } } },
        { id: "MinimalHeading", name: "Minimal Heading", basedOn: "SectionHeading", next: "Body", quickFormat: true, run: { font: "Arial", size: 21, bold: true, color: MINIMAL_DARK }, paragraph: { spacing: { before: 300, after: 80 }, keepNext: true } },
        { id: "SidebarLabel", name: "Sidebar Label", basedOn: "Normal", next: "SidebarHeading", quickFormat: true, run: { font: "Arial", size: 16, color: "F7F8F9" }, paragraph: { spacing: { after: 260 } } },
        { id: "SidebarHeading", name: "Sidebar Heading", basedOn: "Normal", next: "Body", quickFormat: true, run: { font: "Arial", size: 18, bold: true, color: MODERN_ACCENT }, paragraph: { spacing: { before: 180, after: 50 }, keepNext: true } },
        { id: "SidebarBody", name: "Sidebar Body", basedOn: "Normal", next: "SidebarBody", quickFormat: true, run: { font: "Arial", size: 18, color: "F7F8F9" }, paragraph: { spacing: { after: 50, line: 240 } } },
        { id: "Body", name: "Body", basedOn: "Normal", next: "Body", quickFormat: true, run: { font: "Arial", size: 21, color: "20252B" }, paragraph: { spacing: { after: 70, line: 276 } } },
      ],
    },
    sections: [{
      properties: { page: { size: { width: A4_WIDTH, height: A4_HEIGHT }, margin: { top: PAGE_MARGIN, right: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN } } },
      children,
    }],
  });
}

function validateModel(model: DocumentExportModel): DocumentDocxExportResult | null {
  if (!model || !model.applicationId || !Number.isInteger(model.documentVersion) || model.documentVersion < 1 || !model.presentation) return failure("INVALID_EXPORT_MODEL", "Document export model is invalid.");
  if (!(["modern", "classic", "minimal"] as const).includes(model.templateId)) return failure("UNSUPPORTED_DOCX_TEMPLATE", "DOCX template is not supported.");
  if (model.format.format !== "docx" || model.format.mediaType !== DOCX_MEDIA_TYPE || !model.suggestedFilename.endsWith(".docx")) return failure("INVALID_EXPORT_MODEL", "Document export model is not a DOCX model.");
  return null;
}

export async function exportDocumentToDocx(model: DocumentExportModel): Promise<DocumentDocxExportResult> {
  const invalid = validateModel(model);
  if (invalid) return invalid;
  const safeModel = sanitizedDocumentExportModel(model);
  if (!safeModel) return failure("INVALID_EXPORT_MODEL", "Document export model is invalid.");
  try {
    const bytes = new Uint8Array(await Packer.toBuffer(documentFor(safeModel)));
    if (bytes.length < 100 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return failure("DOCX_EXPORT_FAILED", "DOCX export did not produce a valid package.");
    return { ok: true, value: { bytes, filename: model.suggestedFilename, mediaType: DOCX_MEDIA_TYPE } };
  } catch {
    return failure("DOCX_EXPORT_FAILED", "DOCX export could not be completed.");
  }
}