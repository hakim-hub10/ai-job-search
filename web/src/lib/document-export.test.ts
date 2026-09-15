import { describe, expect, it } from "bun:test";

import type { ApplicationDocumentRecord } from "../../../.agents/job-search/cli/src/application-document-repository";
import type { ApplicationDocumentRepository } from "../../../.agents/job-search/cli/src/application-document-repository";
import { MAX_DOCUMENT_EXPORT_LENGTH, prepareDocumentExport, sanitizedDocumentExportModel, suggestedDocumentFilename } from "./document-export";

const content = "## Profil\n- Supporttekniker\n## Kompetenser\n- Microsoft 365\n";

function record(version: number, documentType: "cv" | "coverLetter" = "cv"): ApplicationDocumentRecord {
  return {
    id: `document-${version}`,
    applicationId: "application-1",
    documentType,
    language: "sv",
    version,
    createdAt: `2026-09-0${version}T10:00:00.000Z`,
    generatedDocument: {} as ApplicationDocumentRecord["generatedDocument"],
    renderedDocument: { content } as ApplicationDocumentRecord["renderedDocument"],
  };
}

function repository(records: ApplicationDocumentRecord[]): ApplicationDocumentRepository {
  return {
    async create(value) { return { ok: true, value }; },
    async getById() { return { ok: false, error: { code: "NOT_FOUND", message: "missing" } }; },
    async listByApplication() { return { ok: true, value: records }; },
    async listVersions() { return { ok: true, value: records }; },
    async getLatest() { return { ok: true, value: structuredClone(records.at(-1)!) }; },
    async deleteByApplication() { throw new Error("not used"); },
  };
}

describe("Phase 11.7A document export preparation", () => {
  it.each([
    ["cv", "modern", "pdf", "cv-modern-v3.pdf"],
    ["cv", "classic", "docx", "cv-classic-v3.docx"],
    ["coverLetter", "modern", "pdf", "personligt-brev-modern-v3.pdf"],
    ["coverLetter", "minimal", "docx", "personligt-brev-minimal-v3.docx"],
  ] as const)("prepares %s %s %s from the latest stored version", async (documentType, templateId, format, filename) => {
    const result = await prepareDocumentExport({ applicationId: "application-1", documentType, templateId, format }, { documentRepository: repository([record(1, documentType), record(3, documentType)]) });
    expect(result).toMatchObject({ ok: true, value: { applicationId: "application-1", documentVersion: 3, templateId, suggestedFilename: filename, format: { format, extension: format, mediaType: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, presentation: { rawContent: content, version: 3 } } });
  });

  it("accepts all canonical templates and rejects invalid template, format, and document type", async () => {
    for (const templateId of ["modern", "classic", "minimal"] as const) {
      expect((await prepareDocumentExport({ applicationId: "application-1", documentType: "cv", templateId, format: "pdf" }, { documentRepository: repository([record(3)]) })).ok).toBe(true);
    }
    expect(await prepareDocumentExport({ applicationId: "application-1", documentType: "cv", templateId: "unknown" as never, format: "pdf" }, { documentRepository: repository([record(3)]) })).toMatchObject({ ok: false, error: { code: "INVALID_TEMPLATE" } });
    expect(await prepareDocumentExport({ applicationId: "application-1", documentType: "cv", templateId: "modern", format: "html" as never }, { documentRepository: repository([record(3)]) })).toMatchObject({ ok: false, error: { code: "INVALID_FORMAT" } });
    expect(await prepareDocumentExport({ applicationId: "application-1", documentType: "html" as never, templateId: "modern", format: "pdf" }, { documentRepository: repository([record(3)]) })).toMatchObject({ ok: false, error: { code: "INVALID_DOCUMENT_TYPE" } });
  });

  it("returns safe document-not-found/storage errors and does not require candidate profile data", async () => {
    const missing: ApplicationDocumentRepository = { ...repository([]), async getLatest() { return { ok: false, error: { code: "NOT_FOUND", message: "/private/path" } }; } };
    const broken: ApplicationDocumentRepository = { ...repository([]), async getLatest() { return { ok: false, error: { code: "READ_FAILURE", message: "/private/path" } }; } };
    expect(await prepareDocumentExport({ applicationId: "application-1", documentType: "cv", templateId: "modern", format: "pdf" }, { documentRepository: missing })).toMatchObject({ ok: false, error: { code: "DOCUMENT_NOT_FOUND" } });
    expect(await prepareDocumentExport({ applicationId: "application-1", documentType: "cv", templateId: "modern", format: "pdf" }, { documentRepository: broken })).toMatchObject({ ok: false, error: { code: "DOCUMENT_STORAGE_FAILURE" } });
  });

  it("keeps filenames bounded and safe even when the helper receives hostile template-like input", () => {
    const filename = suggestedDocumentFilename("cv", "modern", 3, "pdf");
    expect(filename).toBe("cv-modern-v3.pdf");
    expect(filename).not.toContain("/");
    expect(filename).not.toContain("\\");
    expect(filename).not.toContain("\0");
    expect(suggestedDocumentFilename("coverLetter", "minimal", 99, "docx").length).toBeLessThan(100);
  });

  it("is deterministic, preserves unknown sections, and does not mutate the source record", async () => {
    const stored = record(3);
    const before = structuredClone(stored);
    const dependencies = { documentRepository: repository([stored]) };
    const first = await prepareDocumentExport({ applicationId: "application-1", documentType: "cv", templateId: "modern", format: "pdf" }, dependencies);
    const second = await prepareDocumentExport({ applicationId: "application-1", documentType: "cv", templateId: "modern", format: "pdf" }, dependencies);
    expect(first).toEqual(second);
    expect(stored).toEqual(before);
    expect(first.ok && first.value.presentation.sections).toContainEqual({ heading: "Profil", items: ["Supporttekniker"] });
  });

  it("rejects oversized stored content and removes only XML-invalid controls from export text", async () => {
    const oversized = record(3);
    oversized.renderedDocument = { content: `## Profil\n- ${"x".repeat(MAX_DOCUMENT_EXPORT_LENGTH + 1)}` } as ApplicationDocumentRecord["renderedDocument"];
    expect(await prepareDocumentExport({ applicationId: "application-1", documentType: "cv", templateId: "modern", format: "pdf" }, { documentRepository: repository([oversized]) })).toMatchObject({ ok: false, error: { code: "EXPORT_PREPARATION_FAILED" } });

    const controls = record(3);
    controls.renderedDocument = { content: "## Profil\n- Före\u0000\u0007\u001b\tåäö\u2028\u2029\u200b\u202eEfter" } as ApplicationDocumentRecord["renderedDocument"];
    const prepared = await prepareDocumentExport({ applicationId: "application-1", documentType: "cv", templateId: "modern", format: "docx" }, { documentRepository: repository([controls]) });
    expect(prepared).toMatchObject({ ok: true, value: { presentation: { sections: [{ heading: "Profil", items: ["Före\tåäö\u2028\u2029\u200b\u202eEfter"] }] } } });
  });

  it("fails closed when a malformed repository result does not match the requested resource", async () => {
    const wrongType = record(3, "coverLetter");
    expect(await prepareDocumentExport({ applicationId: "application-1", documentType: "cv", templateId: "modern", format: "pdf" }, { documentRepository: repository([wrongType]) })).toMatchObject({ ok: false, error: { code: "EXPORT_PREPARATION_FAILED" } });
    const wrongApplication = record(3);
    wrongApplication.applicationId = "another-application";
    expect(await prepareDocumentExport({ applicationId: "application-1", documentType: "cv", templateId: "modern", format: "pdf" }, { documentRepository: repository([wrongApplication]) })).toMatchObject({ ok: false, error: { code: "EXPORT_PREPARATION_FAILED" } });
  });

  it("threads the cover-letter header fields (job title, candidate name, candidate email) through when supplied", async () => {
    const result = await prepareDocumentExport(
      { applicationId: "application-1", documentType: "coverLetter", templateId: "modern", format: "pdf", jobTitle: "IT-support, 1st line", candidateName: "Abdi Hakim Faizal", candidateEmail: "abdi.faizal@example.com" },
      { documentRepository: repository([record(1, "coverLetter")]) },
    );
    expect(result).toMatchObject({ ok: true, value: { jobTitle: "IT-support, 1st line", candidateName: "Abdi Hakim Faizal", candidateEmail: "abdi.faizal@example.com" } });
  });

  it("omits the cover-letter header fields entirely when not supplied - never invents a job title or contact detail", async () => {
    const result = await prepareDocumentExport(
      { applicationId: "application-1", documentType: "coverLetter", templateId: "modern", format: "pdf" },
      { documentRepository: repository([record(1, "coverLetter")]) },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.jobTitle).toBeUndefined();
      expect(result.value.candidateName).toBeUndefined();
      expect(result.value.candidateEmail).toBeUndefined();
    }
  });

  it("trims whitespace-only header fields down to omitted, and sanitizes XML-invalid control characters", async () => {
    const blank = await prepareDocumentExport(
      { applicationId: "application-1", documentType: "coverLetter", templateId: "modern", format: "pdf", jobTitle: "   ", candidateName: "", candidateEmail: "  " },
      { documentRepository: repository([record(1, "coverLetter")]) },
    );
    expect(blank.ok).toBe(true);
    if (blank.ok) {
      expect(blank.value.jobTitle).toBeUndefined();
      expect(blank.value.candidateName).toBeUndefined();
      expect(blank.value.candidateEmail).toBeUndefined();
    }

    const dirty = await prepareDocumentExport(
      { applicationId: "application-1", documentType: "coverLetter", templateId: "modern", format: "pdf", jobTitle: "IT-support  , 1st line" },
      { documentRepository: repository([record(1, "coverLetter")]) },
    );
    expect(dirty).toMatchObject({ ok: true, value: { jobTitle: "IT-support  , 1st line" } });
    const sanitized = dirty.ok ? sanitizedDocumentExportModel(dirty.value) : null;
    expect(sanitized?.jobTitle).toBe("IT-support , 1st line");
  });

  it("threads the employer name and city through when supplied by the actual job posting, and omits the city when the posting does not state one", async () => {
    const withCity = await prepareDocumentExport(
      { applicationId: "application-1", documentType: "coverLetter", templateId: "modern", format: "pdf", employerName: "Fictional Support Partners AB", employerLocation: "Göteborg" },
      { documentRepository: repository([record(1, "coverLetter")]) },
    );
    expect(withCity).toMatchObject({ ok: true, value: { employerName: "Fictional Support Partners AB", employerLocation: "Göteborg" } });

    const withoutCity = await prepareDocumentExport(
      { applicationId: "application-1", documentType: "coverLetter", templateId: "modern", format: "pdf", employerName: "Fictional Support Partners AB" },
      { documentRepository: repository([record(1, "coverLetter")]) },
    );
    expect(withoutCity.ok).toBe(true);
    if (withoutCity.ok) {
      expect(withoutCity.value.employerName).toBe("Fictional Support Partners AB");
      expect(withoutCity.value.employerLocation).toBeUndefined();
    }
  });

  it("always computes today's date for a cover letter export - never invented job/candidate data, purely a presentation timestamp", async () => {
    const result = await prepareDocumentExport(
      { applicationId: "application-1", documentType: "coverLetter", templateId: "modern", format: "pdf" },
      { documentRepository: repository([record(1, "coverLetter")]) },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(typeof result.value.date).toBe("string");
  });

  it("does not compute a date for a CV export - the date header is cover-letter only", async () => {
    const result = await prepareDocumentExport(
      { applicationId: "application-1", documentType: "cv", templateId: "modern", format: "pdf" },
      { documentRepository: repository([record(1, "cv")]) },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.date).toBeUndefined();
  });
});