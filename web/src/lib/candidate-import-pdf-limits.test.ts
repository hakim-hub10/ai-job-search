import { describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));
let parserText = "x".repeat(100_001);
mock.module("pdf-parse", () => ({
  PDFParse: class {
    async getInfo() { return { total: 1 }; }
    async getText() { return { total: 1, text: parserText }; }
    async destroy() {}
  },
}));

const { extractCandidateImportPdf: extract } = await import("./candidate-import-pdf");
const candidate = { id: "candidate-A" };
const upload = { candidateId: candidate.id, filename: "cv.pdf", mimeType: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.7\nsynthetic") };

describe("candidate import PDF extraction limits", () => {
  it("rejects parser output over the explicit text limit without returning it", async () => {
    parserText = "x".repeat(100_001);
    await expect(extract(upload, candidate)).resolves.toEqual({
      ok: false,
      error: { code: "TEXT_LIMIT_EXCEEDED", message: "The PDF exceeds the 100,000-character extraction limit." },
    });
  });

  it("normalizes parser line endings and NUL artifacts without interpreting text", async () => {
    parserText = "Role\r\nCompany\rLocation\0";
    await expect(extract(upload, candidate)).resolves.toEqual({
      ok: true,
      value: { text: "Role\nCompany\nLocation", pageCount: 1, extractionVersion: 1, trust: "untrusted" },
    });
  });
});