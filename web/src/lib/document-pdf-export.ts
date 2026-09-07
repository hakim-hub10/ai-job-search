import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";

import { classifyCvSection, type DocumentPresentationSection } from "./document-presentation";
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

function failure(code: DocumentPdfExportErrorCode, message: string): DocumentPdfExportResult {
  return { ok: false, error: { code, message } };
}

function sectionItems(document: PDFKit.PDFDocument, section: DocumentPresentationSection, options: { headingSize: number; bodySize: number; headingColor: string; bulletColor: string }): void {
  if (section.heading) document.fillColor(options.headingColor).fontSize(options.headingSize).font("body").text(section.heading, { paragraphGap: 5 });
  document.fillColor("#20252b").fontSize(options.bodySize).font("body");
  for (const item of section.items) {
    const textWidth = document.page.width - document.x - MARGIN;
    document.fillColor(options.bulletColor).text(`• ${item}`, { width: Math.max(textWidth, 80), paragraphGap: 5 });
  }
  document.moveDown(0.45);
}

function drawHeader(document: PDFKit.PDFDocument, model: DocumentExportModel, color: string): void {
  const label = model.documentType === "cv" ? "CURRICULUM VITAE" : "PERSONLIGT BREV";
  document.fillColor(color).font("body").fontSize(9).text(label, MARGIN, MARGIN, { characterSpacing: 1.2 });
  document.fillColor("#65717d").fontSize(8).text(`Version ${model.documentVersion} · Skapad ${model.presentation.createdAt}`, MARGIN, MARGIN + 18);
  document.y = MARGIN + 45;
}

function drawModernCv(document: PDFKit.PDFDocument, model: DocumentExportModel): void {
  const sidebarWidth = 142;
  const mainX = MARGIN + sidebarWidth + 24;
  document.rect(0, 0, sidebarWidth + 20, A4_HEIGHT).fill("#24313b");
  document.fillColor("#f7f8f9").font("body").fontSize(9).text("CURRICULUM VITAE", MARGIN, MARGIN, { width: sidebarWidth, characterSpacing: 1.1 });
  document.fillColor("#d8dde2").fontSize(8).text(`Version ${model.documentVersion}`, MARGIN, MARGIN + 20, { width: sidebarWidth });
  let sidebarY = MARGIN + 58;
  let mainY = MARGIN;
  for (const section of model.presentation.sections) {
    if (classifyCvSection(section) === "sidebar") {
      document.fillColor("#c8a96b").fontSize(9).font("body").text(section.heading || "Övrigt", MARGIN, sidebarY, { width: sidebarWidth - 18 });
      sidebarY = document.y + 3;
      document.fillColor("#f7f8f9").fontSize(8.5);
      for (const item of section.items) { document.text(item, MARGIN, sidebarY, { width: sidebarWidth - 18, paragraphGap: 4 }); sidebarY = document.y; }
      sidebarY += 8;
    } else {
      document.x = mainX;
      document.y = Math.max(mainY, MARGIN);
      sectionItems(document, section, { headingSize: 12, bodySize: 9.5, headingColor: "#24313b", bulletColor: "#c8a96b" });
      mainY = document.y;
    }
  }
}

function drawSingleColumn(document: PDFKit.PDFDocument, model: DocumentExportModel, variant: "classic" | "minimal"): void {
  drawHeader(document, model, variant === "classic" ? "#30353a" : "#53616d");
  for (const section of model.presentation.sections) sectionItems(document, section, {
    headingSize: variant === "classic" ? 13 : 11,
    bodySize: variant === "classic" ? 10 : 10.5,
    headingColor: variant === "classic" ? "#30353a" : "#66717d",
    bulletColor: model.documentType === "coverLetter" ? "#9c7c41" : "#53616d",
  });
}

function drawModernLetter(document: PDFKit.PDFDocument, model: DocumentExportModel): void {
  document.rect(MARGIN, MARGIN, 7, A4_HEIGHT - (MARGIN * 2)).fill("#c8a96b");
  document.x = MARGIN + 28;
  drawHeader(document, model, "#24313b");
  for (const section of model.presentation.sections) sectionItems(document, section, { headingSize: 12, bodySize: 10.5, headingColor: "#24313b", bulletColor: "#c8a96b" });
}

function renderPdf(model: DocumentExportModel): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margin: MARGIN, autoFirstPage: true, info: {} });
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