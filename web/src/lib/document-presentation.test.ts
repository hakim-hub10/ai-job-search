import { describe, expect, it } from "bun:test";

import type { ApplicationDocumentRecord } from "../../../.agents/job-search/cli/src/application-document-repository";
import { classifyCvSection, coverLetterRendererForTemplate, cvRendererForTemplate, documentTitleForCv, DOCUMENT_TEMPLATES, resolveDocumentTemplate, templateQueryHref, toDocumentPresentationModel } from "./document-presentation";

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

  it("selects dedicated CV renderers without applying them to cover letters", () => {
    expect(cvRendererForTemplate("cv", "modern")).toBe("modern");
    expect(cvRendererForTemplate("cv", "classic")).toBe("classic");
    expect(cvRendererForTemplate("cv", "minimal")).toBe("minimal");
    expect(cvRendererForTemplate("coverLetter", "modern")).toBe("shared");
    expect(coverLetterRendererForTemplate("coverLetter", "modern")).toBe("modern");
    expect(coverLetterRendererForTemplate("coverLetter", "classic")).toBe("classic");
    expect(coverLetterRendererForTemplate("coverLetter", "minimal")).toBe("minimal");
    expect(coverLetterRendererForTemplate("cv", "modern")).toBe("shared");
  });

  it("builds only allowlisted template query links without mutating content", () => {
    expect(templateQueryHref("/documents/cv", "?foo=bar", "classic")).toBe("/documents/cv?foo=bar&template=classic");
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

  it("classifies known sidebar sections and keeps unknown sections in the main column", () => {
    for (const heading of ["Kompetenser", "Skills", "Certifieringar", "Languages", "Kontakt", "Links"]) {
      expect(classifyCvSection({ heading, items: ["verified text"] })).toBe("sidebar");
    }
    for (const heading of ["Profil", "Summary", "Erfarenhet", "Work Experience", "Utbildning", "Projects", "New Section"]) {
      expect(classifyCvSection({ heading, items: ["verified text"] })).toBe("main");
    }
    expect(classifyCvSection({ heading: "", items: [] })).toBe("main");
  });

  it("never fabricates an identity heading and preserves an actual document title", () => {
    const missing = [{ heading: "Kompetenser", items: ["Microsoft 365"] }];
    const actual = [{ heading: "Profil", items: ["Supporttekniker"] }];

    expect(documentTitleForCv(missing)).toBeUndefined();
    expect(documentTitleForCv(actual)).toBe("Supporttekniker");
    expect(missing).toEqual([{ heading: "Kompetenser", items: ["Microsoft 365"] }]);
  });
});
