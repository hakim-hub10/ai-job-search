import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ApplicationDocumentRecord, ApplicationDocumentRepository } from "../../../.agents/job-search/cli/src/application-document-repository";
import { DocumentExportControls } from "../app/applications/[applicationId]/documents/document-export-controls";
import { documentDownloadHref } from "./document-download-url";
import { downloadDocument } from "./document-download";

const applicationId = "application-1";
const content = "## Profil\n- Supporttekniker åäö\n## Kompetenser\n- Microsoft 365";

function record(documentType: "cv" | "coverLetter"): ApplicationDocumentRecord {
  return {
    id: `document-${documentType}`,
    applicationId,
    documentType,
    language: "sv",
    version: 3,
    createdAt: "2026-09-07T10:00:00.000Z",
    generatedDocument: {} as ApplicationDocumentRecord["generatedDocument"],
    renderedDocument: { content } as ApplicationDocumentRecord["renderedDocument"],
  };
}

function repository(stored: ApplicationDocumentRecord, missing = false): ApplicationDocumentRepository {
  return {
    async create() { throw new Error("not used"); },
    async getById() { throw new Error("not used"); },
    async listByApplication() { return { ok: true, value: [] }; },
    async listVersions() { return { ok: true, value: [] }; },
    async getLatest() {
      return missing
        ? { ok: false, error: { code: "NOT_FOUND", message: "/private/document" } }
        : { ok: true, value: structuredClone(stored) };
    },
  };
}

describe("secure document download boundary", () => {
  it.each([
    ["cv", "modern", "pdf", "application/pdf"], ["cv", "classic", "pdf", "application/pdf"], ["cv", "minimal", "pdf", "application/pdf"],
    ["cv", "modern", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], ["cv", "classic", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], ["cv", "minimal", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["coverLetter", "modern", "pdf", "application/pdf"], ["coverLetter", "classic", "pdf", "application/pdf"], ["coverLetter", "minimal", "pdf", "application/pdf"],
    ["coverLetter", "modern", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], ["coverLetter", "classic", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], ["coverLetter", "minimal", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ] as const)("downloads the latest %s %s %s server-side", async (documentType, templateId, format, mediaType) => {
    const stored = record(documentType);
    const before = structuredClone(stored);
    const response = await downloadDocument({ applicationId, documentType, templateId, format }, { documentRepository: repository(stored) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(mediaType);
    expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="${documentType === "cv" ? "cv" : "personligt-brev"}-${templateId}-v3.${format}"`);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(100);
    expect(stored).toEqual(before);
  });

  it("rejects malformed request options without touching the repository or leaking details", async () => {
    const stored = record("cv");
    for (const request of [
      { applicationId, documentType: "cv", templateId: "../../etc/passwd", format: "pdf" },
      { applicationId, documentType: "cv", templateId: "<script>", format: "pdf" },
      { applicationId, documentType: "cv", templateId: "modern", format: "exe" },
      { applicationId, documentType: "../../secret", templateId: "modern", format: "pdf" },
      { applicationId: "cv\0pdf", documentType: "cv", templateId: "modern", format: "pdf" },
    ]) {
      const response = await downloadDocument(request, { documentRepository: repository(stored) });
      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Exportbegäran är ogiltig.");
    }
  });

  it("maps missing documents and exporter failures to safe responses", async () => {
    const missing = await downloadDocument({ applicationId, documentType: "cv", templateId: "modern", format: "pdf" }, { documentRepository: repository(record("cv"), true) });
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("Dokumentet hittades inte.");
    const failed = await downloadDocument({ applicationId, documentType: "cv", templateId: "modern", format: "pdf" }, {
      documentRepository: repository(record("cv")),
      async exportPdf() { return { ok: false, error: { code: "PDF_EXPORT_FAILED", message: "/private/path" } }; },
    });
    expect(failed.status).toBe(500);
    expect(await failed.text()).toBe("Exporten kunde inte genomföras.");
  });

  it("builds download URLs from identifiers and selected templates only", () => {
    const href = documentDownloadHref("application-1", "cv", "classic", "docx");
    expect(href).toBe("/applications/application-1/documents/export?documentType=cv&template=classic&format=docx");
    expect(href).not.toContain(content);
    expect(href).not.toContain("filename");
    expect(href).not.toContain("application/vnd");
  });

  it("renders Swedish CV and cover-letter controls for the resolved template", () => {
    const cv = renderToStaticMarkup(createElement(DocumentExportControls, { applicationId: "application-1", documentType: "cv", templateId: "minimal" }));
    const coverLetter = renderToStaticMarkup(createElement(DocumentExportControls, { applicationId: "application-1", documentType: "coverLetter", templateId: "classic" }));
    expect(cv).toContain("Exportera dokument");
    expect(cv).toContain("Ladda ner PDF");
    expect(cv).toContain("Ladda ner Word");
    expect(cv).toContain("documentType=cv&amp;template=minimal&amp;format=pdf");
    expect(coverLetter).toContain("documentType=coverLetter&amp;template=classic&amp;format=docx");
    expect(cv).not.toContain(content);
  });
});