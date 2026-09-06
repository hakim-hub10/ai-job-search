import { describe, expect, it } from "bun:test";

import type { ApplicationDocumentRecord } from "../../../.agents/job-search/cli/src/application-document-repository";
import { DOCUMENT_TEMPLATES, resolveDocumentTemplate, toDocumentPresentationModel } from "./document-presentation";

function record(documentType: "cv" | "coverLetter", content: string): ApplicationDocumentRecord {
  return {
    id: "document-1",
    applicationId: "application-1",
    documentType,
    language: "sv",
    version: 3,
    createdAt: "2026-09-06T10:00:00.000Z",
    generatedDocument: {} as ApplicationDocumentRecord["generatedDocument"],
    renderedDocument: { content } as ApplicationDocumentRecord["renderedDocument"],
  };
}

describe("document presentation architecture", () => {
  it("registers the exact allowlisted template IDs", () => {
    expect(DOCUMENT_TEMPLATES.map((template) => template.id)).toEqual(["modern", "classic", "minimal"]);
  });

  it("defaults to modern and rejects unknown template values safely", () => {
    expect(resolveDocumentTemplate()).toMatchObject({ ok: true, selected: false, template: { id: "modern" } });
    expect(resolveDocumentTemplate("modern")).toMatchObject({ ok: true, selected: true });
    expect(resolveDocumentTemplate("unknown")).toMatchObject({ ok: false, code: "INVALID_TEMPLATE", fallback: { id: "modern" } });
  });

  it("adapts stored CV and cover-letter content without inferring facts", () => {
    const cv = toDocumentPresentationModel(record("cv", "## Profil\n- Supporttekniker\n## Kompetenser\n- Microsoft 365"));
    const letter = toDocumentPresentationModel(record("coverLetter", "## Ansökningskontext\n- Exempel AB\n## Profil\n- Supporttekniker"));

    expect(cv).toMatchObject({ documentType: "cv", version: 3 });
    expect(cv.sections.find((section) => section.heading === "Profil")).toEqual({ heading: "Profil", items: ["Supporttekniker"] });
    expect(letter.documentType).toBe("coverLetter");
    expect(letter.sections.find((section) => section.heading === "Ansökningskontext")).toEqual({ heading: "Ansökningskontext", items: ["Exempel AB"] });
    expect(cv.sections.find((section) => section.heading === "Utbildning")).toBeUndefined();
  });
});
