import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";

import { classifyCvSection, coverLetterApplicationLabel, cvBodySections, documentContactForCv, documentNameForCv, documentTitleForCv, type DocumentPresentationSection } from "./document-presentation";
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

/**
 * Positions the cursor at the top margin without drawing any visible label
 * (candidate-facing documents must not show internal metadata like
 * "CURRICULUM VITAE"). Positioning through an empty .text() call - rather
 * than assigning document.x/y directly - matters: pdfkit's .text() also
 * establishes internal line-wrapping state that later width-dependent .text()
 * calls in this same column rely on; a bare property assignment left that
 * state stale and corrupted subsequent glyph placement.
 */
function drawHeader(document: PDFKit.PDFDocument): void {
  document.font("body").fontSize(9).text("", MARGIN, MARGIN, NO_LIGATURES);
}

const SKILL_HEADINGS = new Set(["kompetenser", "skills", "yrkeskompetenser", "professional skills", "personliga kompetenser", "interpersonal skills"]);
function normalizedModernHeading(heading: string): string {
  return heading.toLocaleLowerCase("sv-SE").replace(/[åä]/gu, "a").replace(/ö/gu, "o").trim();
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
    function chips(items: string[]) {
      document.switchToPage(page); document.font("body").fontSize(9);
      const rowHeight = 18; const gap = 6; const padX = 9;
      let rowX = x;
      for (const item of items) {
        const chipWidth = Math.min(document.widthOfString(item, NO_LIGATURES) + padX * 2, width);
        if (rowX + chipWidth > x + width && rowX > x) { rowX = x; y += rowHeight + gap; }
        if (y + rowHeight > A4_HEIGHT - MARGIN) { movePage(); rowX = x; }
        document.switchToPage(page);
        document.roundedRect(rowX, y, chipWidth, rowHeight, 9).lineWidth(1).fillAndStroke("#2f4048", "#546067");
        document.fillColor("#f1f5f4").text(item, rowX + padX, y + 5, { width: chipWidth - padX * 2, height: rowHeight - 4, ellipsis: true, lineBreak: false, ...NO_LIGATURES });
        rowX += chipWidth + gap;
      }
      y += rowHeight + 8;
    }
    if (sidebar) {
      const contact = documentContactForCv(model.presentation.sections);
      if (contact) block(contact, 9.5, "#c4d0d0");
      y += 8;
    } else {
      const name = documentNameForCv(model.presentation.sections);
      const title = documentTitleForCv(model.presentation.sections);
      if (name) block(name, 20, "#1b2528", true);
      if (title) block(title, 12, "#3f8a6c", true);
      if (name || title) y += 10;
    }
    for (const section of sections) {
      if (section.heading) block(section.heading, sidebar ? 10 : 12, sidebar ? "#e0c58d" : "#24313b", true);
      if (sidebar && SKILL_HEADINGS.has(normalizedModernHeading(section.heading))) chips(section.items);
      else { for (const item of section.items) block(item, sidebar ? 9 : 10, sidebar ? "#f7f8f9" : "#20252b"); y += 8; }
    }
  }
  const body = cvBodySections(model.presentation.sections);
  column(body.filter(section => classifyCvSection(section) === "main"), false);
  column(body.filter(section => classifyCvSection(section) === "sidebar"), true);
}

/** Cover-letter header only: candidate name/email, date, and the actual target job title/employer/city (all verified, omitted when unavailable). */
function drawCoverLetterHeader(document: PDFKit.PDFDocument, model: DocumentExportModel, nameColor: string, metaColor: string): void {
  if (!model.candidateName && !model.candidateEmail && !model.date && !model.jobTitle && !model.employerName) return;
  if (model.candidateName) document.fillColor(nameColor).fontSize(14).font("body").text(model.candidateName, NO_LIGATURES);
  if (model.candidateEmail) document.fillColor(metaColor).fontSize(10).text(model.candidateEmail, NO_LIGATURES);
  if (model.date) document.fillColor(metaColor).fontSize(10).text(model.date, NO_LIGATURES);
  if (model.jobTitle) document.fillColor(metaColor).fontSize(10).text(`${coverLetterApplicationLabel(model.presentation.language)}: ${model.jobTitle}`, NO_LIGATURES);
  if (model.employerName) document.fillColor(metaColor).fontSize(10).text(`${model.employerName}${model.employerLocation ? `, ${model.employerLocation}` : ""}`, NO_LIGATURES);
  document.moveDown(0.8);
}

function drawSingleColumn(document: PDFKit.PDFDocument, model: DocumentExportModel, variant: "classic" | "minimal"): void {
  drawHeader(document);
  if (model.documentType === "cv") {
    const name = documentNameForCv(model.presentation.sections);
    const contact = documentContactForCv(model.presentation.sections);
    const title = documentTitleForCv(model.presentation.sections);
    if (name) document.fillColor("#20252b").fontSize(20).text(name, NO_LIGATURES);
    if (title) document.fillColor("#20252b").fontSize(12).text(title, NO_LIGATURES);
    if (contact) document.fillColor("#65717d").fontSize(10).text(contact, NO_LIGATURES);
    document.moveDown(0.5);
  } else {
    drawCoverLetterHeader(document, model, "#20252b", "#65717d");
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
  drawHeader(document);
  drawCoverLetterHeader(document, model, "#24313b", "#65717d");
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