import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";

import { classifyCvSection, cvBodySections, documentContactForCv, documentNameForCv, documentTitleForCv, type DocumentPresentationSection } from "./document-presentation";
import { sanitizedDocumentExportModel, type DocumentExportModel } from "./document-export";

export interface ExportedPdfDocument {
  bytes: Uint8Array;
  filename: string;
  mediaType: "application/pdf";
}

export type DocumentPdfExportErrorCode = "PDF_EXPORT_FAILED" | "UNSUPPORTED_PDF_TEMPLATE" | "INVALID_EXPORT_MODEL";
export interface DocumentPdfExportError { code: DocumentPdfExportErrorCode; message: string }
export type DocumentPdfExportResult =
  | { ok: true; value: ExportedPdfDocument }
  | { ok: false; error: DocumentPdfExportError };

const FONT_PATHS = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
] as const;
const FONT_PATH = FONT_PATHS.find((path) => existsSync(path));
const A4_HEIGHT = 841.89;
const MARGIN = 48;
/**
 * DejaVu Sans/Liberation Sans substitute a single "fi" ligature glyph for
 * that letter pair by default. The glyph renders correctly, but pdfkit's
 * generated ToUnicode mapping for it drops the "i" on extraction - so
 * "Profil", "certifiering", "first" and "proficiency" all come out missing a
 * letter in the PDF's text layer even though the page looks fine. ATS
 * parsers read that text layer, not the rendered page, so this silently
 * broke keyword matching for any word containing "fi". Disabling ligature
 * substitution keeps every character a separate glyph with its own mapping.
 */
// @types/pdfkit only declares feature tags for enabling (e.g. "liga"); fontkit's
// text shaper (which pdfkit delegates to for TrueType fonts) also accepts the
// standard "-tag" form to disable a feature, so this is a type-definition gap,
// not a runtime one.
const NO_LIGATURES: { features: PDFKit.Mixins.OpenTypeFeatures[] } = { features: ["-liga", "-dlig", "-clig"] as unknown as PDFKit.Mixins.OpenTypeFeatures[] };

function failure(code: DocumentPdfExportErrorCode, message: string): DocumentPdfExportResult {
  return { ok: false, error: { code, message } };
}

function sectionItems(document: PDFKit.PDFDocument, section: DocumentPresentationSection, options: { headingSize: number; bodySize: number; headingColor: string; bulletColor: string; letter?: boolean }): void {
  if (section.heading) document.fillColor(options.headingColor).fontSize(options.headingSize).font("body").text(section.heading, { paragraphGap: 5, ...NO_LIGATURES });
  document.fillColor("#20252b").fontSize(options.bodySize).font("body");
  for (const item of section.items) {
    const textWidth = document.page.width - document.x - MARGIN;
    document.fillColor("#20252b").text(`${options.letter ? "" : "• "}${item}`, { width: Math.max(textWidth, 80), paragraphGap: 5, ...NO_LIGATURES });
  }
  document.moveDown(0.45);
}

function drawHeader(document: PDFKit.PDFDocument, model: DocumentExportModel, color: string): void {
  if (model.documentType === "coverLetter") { document.x = MARGIN; document.y = MARGIN; return; }
  const label = model.documentType === "cv" ? "CURRICULUM VITAE" : "PERSONLIGT BREV";
  document.fillColor(color).font("body").fontSize(9).text(label, MARGIN, MARGIN, { characterSpacing: 1.2, ...NO_LIGATURES });
  document.y = MARGIN + 25;
}

function drawModernCv(document: PDFKit.PDFDocument, model: DocumentExportModel): void {
  const sidebarWidth = 180;
  const paint = () => { document.rect(0, 0, sidebarWidth, A4_HEIGHT).fill("#24313b"); };
  paint();
  function column(sections: DocumentPresentationSection[], sidebar: boolean) {
    const x = sidebar ? 24 : sidebarWidth + 28;
    const width = sidebar ? sidebarWidth - 48 : document.page.width - x - MARGIN;
    let page = 0; let y = MARGIN;
    const movePage = () => {
      page++;
      if (page >= document.bufferedPageRange().count) { document.addPage(); paint(); }
      document.switchToPage(page); y = MARGIN;
    };
    function block(text: string, size: number, color: string, heading = false) {
      document.switchToPage(page); document.font("body").fontSize(size);
      if (heading && y > A4_HEIGHT - MARGIN - 50) movePage();
      const words = text.split(/\s+/u); let chunk = "";
      for (const word of words) {
        const next = chunk ? `${chunk} ${word}` : word;
        if (chunk && document.heightOfString(next, { width, ...NO_LIGATURES }) > A4_HEIGHT - MARGIN - y) {
          document.fillColor(color).text(chunk, x, y, { width, ...NO_LIGATURES }); movePage(); chunk = word;
        } else chunk = next;
      }
      if (chunk) {
        const height = document.heightOfString(chunk, { width, ...NO_LIGATURES });
        if (y + height > A4_HEIGHT - MARGIN) movePage();
        document.fillColor(color).text(chunk, x, y, { width, ...NO_LIGATURES }); y += height + (heading ? 7 : 6);
      }
    }
    if (sidebar) block("CURRICULUM VITAE", 9, "#f7f8f9", true);
    else {
      const name = documentNameForCv(model.presentation.sections);
      const contact = documentContactForCv(model.presentation.sections);
      const title = documentTitleForCv(model.presentation.sections);
      if (name) block(name, 20, "#24313b", true);
      if (contact) block(contact, 10, "#65717d");
      if (title) block(title, 12, "#53616d", true);
      y += 8;
    }
    for (const section of sections) {
      if (section.heading) block(section.heading, sidebar ? 10 : 12, sidebar ? "#e0c58d" : "#24313b", true);
      for (const item of section.items) block(item, sidebar ? 9 : 10, sidebar ? "#f7f8f9" : "#20252b");
      y += 8;
    }
  }
  const body = cvBodySections(model.presentation.sections);
  column(body.filter(section => classifyCvSection(section) === "main"), false);
  column(body.filter(section => classifyCvSection(section) === "sidebar"), true);
}

function drawSingleColumn(document: PDFKit.PDFDocument, model: DocumentExportModel, variant: "classic" | "minimal"): void {
  drawHeader(document, model, variant === "classic" ? "#30353a" : "#53616d");
  if (model.documentType === "cv") {
    const name = documentNameForCv(model.presentation.sections);
    const contact = documentContactForCv(model.presentation.sections);
    const title = documentTitleForCv(model.presentation.sections);
    if (name) document.fillColor("#20252b").fontSize(20).text(name, NO_LIGATURES);
    if (contact) document.fillColor("#65717d").fontSize(10).text(contact, NO_LIGATURES);
    if (title) document.fillColor("#20252b").fontSize(12).text(title, NO_LIGATURES);
    document.moveDown(0.5);
  }
  for (const section of model.documentType === "cv" ? cvBodySections(model.presentation.sections) : model.presentation.sections) sectionItems(document, section, {
    headingSize: variant === "classic" ? 13 : 11,
    bodySize: variant === "classic" ? 10 : 10.5,
    headingColor: variant === "classic" ? "#30353a" : "#66717d",
    letter: model.documentType === "coverLetter",
    bulletColor: model.documentType === "coverLetter" ? "#9c7c41" : "#53616d",
  });
}

function drawModernLetter(document: PDFKit.PDFDocument, model: DocumentExportModel): void {
  document.rect(MARGIN, MARGIN, 7, A4_HEIGHT - (MARGIN * 2)).fill("#c8a96b");
  document.x = MARGIN + 28;
  drawHeader(document, model, "#24313b");
  for (const section of model.presentation.sections) sectionItems(document, section, { letter: true, headingSize: 12, bodySize: 10.5, headingColor: "#24313b", bulletColor: "#c8a96b" });
}

function renderPdf(model: DocumentExportModel): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margin: MARGIN, autoFirstPage: true, bufferPages: true, info: {} });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    document.on("error", reject);
    document.registerFont("body", FONT_PATH!);
    if (model.templateId === "modern" && model.documentType === "cv") drawModernCv(document, model);
    else if (model.templateId === "modern") drawModernLetter(document, model);
    else drawSingleColumn(document, model, model.templateId);
    document.end();
  });
}

function validateModel(model: DocumentExportModel): DocumentPdfExportResult | null {
  if (!model || !model.applicationId || !Number.isInteger(model.documentVersion) || model.documentVersion < 1 || !model.presentation) return failure("INVALID_EXPORT_MODEL", "Document export model is invalid.");
  if (!["modern", "classic", "minimal"].includes(model.templateId)) return failure("UNSUPPORTED_PDF_TEMPLATE", "PDF template is not supported.");
  if (model.format.format !== "pdf" || model.format.mediaType !== "application/pdf") return failure("INVALID_EXPORT_MODEL", "Document export model is not a PDF model.");
  if (!FONT_PATH) return failure("PDF_EXPORT_FAILED", "No supported system font is available for PDF export.");
  return null;
}

export async function exportDocumentToPdf(model: DocumentExportModel): Promise<DocumentPdfExportResult> {
  const invalid = validateModel(model);
  if (invalid) return invalid;
  const safeModel = sanitizedDocumentExportModel(model);
  if (!safeModel) return failure("INVALID_EXPORT_MODEL", "Document export model is invalid.");
  try {
    const bytes = await renderPdf(safeModel);
    if (bytes.length < 100 || String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") return failure("PDF_EXPORT_FAILED", "PDF export did not produce a valid PDF.");
    return { ok: true, value: { bytes, filename: model.suggestedFilename, mediaType: "application/pdf" } };
  } catch {
    return failure("PDF_EXPORT_FAILED", "PDF export could not be completed.");
  }
}