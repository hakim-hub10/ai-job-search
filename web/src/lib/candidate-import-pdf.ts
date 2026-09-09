import "server-only";

import { PDFParse } from "pdf-parse";

import {
  type CandidateImportUpload,
  MAX_CANDIDATE_IMPORT_BYTES,
  validateCandidateImportUpload,
} from "./candidate-import-upload";

export { MAX_CANDIDATE_IMPORT_BYTES };
export const MAX_CANDIDATE_IMPORT_PDF_PAGES = 20;
export const MAX_CANDIDATE_IMPORT_PDF_TEXT_LENGTH = 100_000;

export interface CandidateImportPdfExtraction {
  text: string;
  pageCount: number;
  extractionVersion: 1;
  trust: "untrusted";
}

const messages = {
  ADMISSION_FAILED: "The PDF did not pass upload admission.",
  PDF_PARSE_FAILED: "The PDF text could not be read.",
  PASSWORD_PROTECTED_PDF: "Password-protected PDFs are not supported.",
  PAGE_LIMIT_EXCEEDED: "The PDF exceeds the 20-page extraction limit.",
  TEXT_LIMIT_EXCEEDED: "The PDF exceeds the 100,000-character extraction limit.",
  NO_EXTRACTABLE_TEXT: "The PDF does not contain extractable text.",
} as const;

export type CandidateImportPdfExtractionErrorCode = keyof typeof messages;
export type CandidateImportPdfExtractionResult =
  | { ok: true; value: CandidateImportPdfExtraction }
  | { ok: false; error: { code: CandidateImportPdfExtractionErrorCode; message: string } };

function failure(code: CandidateImportPdfExtractionErrorCode): CandidateImportPdfExtractionResult {
  return { ok: false, error: { code, message: messages[code] } };
}

function normalizeExtractedText(text: string): string {
  return text.replace(/\r\n?/gu, "\n").replace(/\0/gu, "").trim();
}

/**
 * Extracts transient, untrusted text from an admitted PDF. This parser runs in
 * memory only; pdf-parse has no hard, safe cancellation API, so elapsed parser
 * time cannot be guaranteed here. Page and returned-text limits are enforced.
 */
export async function extractCandidateImportPdf(
  upload: CandidateImportUpload,
  candidate: { id: string },
): Promise<CandidateImportPdfExtractionResult> {
  const admission = validateCandidateImportUpload(upload, candidate);
  if (!admission.ok || admission.value.document.format !== "pdf") {
    return failure("ADMISSION_FAILED");
  }

  let parser: PDFParse | undefined;
  try {
    parser = new PDFParse({
      data: upload.bytes.slice(),
      disableFontFace: true,
      isEvalSupported: false,
      stopAtErrors: true,
      useSystemFonts: false,
    });
    const info = await parser.getInfo();
    if (info.total > MAX_CANDIDATE_IMPORT_PDF_PAGES) {
      return failure("PAGE_LIMIT_EXCEEDED");
    }

    const extracted = await parser.getText({
      first: MAX_CANDIDATE_IMPORT_PDF_PAGES,
      parseHyperlinks: false,
      pageJoiner: "",
    });
    const text = normalizeExtractedText(extracted.text);
    if (!text.trim()) {
      return failure("NO_EXTRACTABLE_TEXT");
    }
    if (text.length > MAX_CANDIDATE_IMPORT_PDF_TEXT_LENGTH) {
      return failure("TEXT_LIMIT_EXCEEDED");
    }
    return { ok: true, value: { text, pageCount: extracted.total, extractionVersion: 1, trust: "untrusted" } };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return failure(name === "PasswordException" ? "PASSWORD_PROTECTED_PDF" : "PDF_PARSE_FAILED");
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}