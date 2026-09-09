import { describe, expect, it, mock } from "bun:test";
import PDFDocument from "pdfkit";
import type { CandidateImportPdfExtractionErrorCode } from "./candidate-import-pdf";

mock.module("server-only", () => ({}));
const {
  extractCandidateImportPdf: extract,
  MAX_CANDIDATE_IMPORT_BYTES: maxBytes,
  MAX_CANDIDATE_IMPORT_PDF_PAGES: maxPages,
} = await import("./candidate-import-pdf");

const candidate = { id: "candidate-A" };

function pdf(pages: string[]): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ autoFirstPage: false, info: {} });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    document.on("error", reject);
    for (const text of pages) {
      document.addPage();
      if (text) document.fontSize(12).text(text);
    }
    document.end();
  });
}

function upload(bytes: Uint8Array, overrides: Partial<{ filename: string; mimeType: string }> = {}) {
  return { candidateId: candidate.id, filename: "cv.pdf", mimeType: "application/pdf", bytes, ...overrides };
}

describe("candidate import PDF extraction", () => {
  it("extracts deterministic untrusted text from an admitted PDF", async () => {
    const bytes = await pdf(["Ada Lovelace\nPlatform engineer"]);
    const first = await extract(upload(bytes), candidate);
    const second = await extract(upload(bytes), candidate);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ ok: true, value: { text: "Ada Lovelace\nPlatform engineer", pageCount: 1, extractionVersion: 1, trust: "untrusted" } });
  });

  it("extracts all pages through the inclusive page limit", async () => {
    const result = await extract(upload(await pdf(Array.from({ length: maxPages }, (_, index) => `Page ${index + 1}`))), candidate);
    expect(result.ok && result.value).toMatchObject({ pageCount: maxPages, text: expect.stringContaining(`Page ${maxPages}`) });
  });

  async function expectFailure(source: Uint8Array, expected: CandidateImportPdfExtractionErrorCode) {
    const result = await extract(upload(source), candidate);
      expect(result).toEqual({ ok: false, error: { code: expected, message: expect.any(String) } });
      expect(JSON.stringify(result)).not.toContain("broken");
  }

  it("returns a sanitized failure for a malformed admitted PDF", () => expectFailure(new TextEncoder().encode("%PDF-1.7\nbroken"), "PDF_PARSE_FAILED"));
  it("returns a sanitized failure for a non-PDF through admission", () => expectFailure(new Uint8Array([80, 75, 3, 4]), "ADMISSION_FAILED"));
  it("returns a sanitized failure for an empty image-only PDF", async () => expectFailure(await pdf([""]), "NO_EXTRACTABLE_TEXT"));
  it("returns a sanitized failure for a PDF exceeding the page limit", async () => expectFailure(await pdf(Array.from({ length: maxPages + 1 }, () => "Page")), "PAGE_LIMIT_EXCEEDED"));
  it("returns a sanitized failure for input over the admission limit", () => expectFailure(new Uint8Array(maxBytes + 1), "ADMISSION_FAILED"));
});