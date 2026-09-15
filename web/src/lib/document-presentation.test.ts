import { describe, expect, it } from "bun:test";

import type { ApplicationDocumentRecord } from "../../../.agents/job-search/cli/src/application-document-repository";
import { classifyContactField, classifyCvSection, coverLetterApplicationLabel, coverLetterDate, coverLetterRendererForTemplate, cvBodySections, cvRendererForTemplate, documentTitleForCv, DOCUMENT_TEMPLATES, resolveDocumentTemplate, templateQueryHref, toDocumentPresentationModel } from "./document-presentation";

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
    for (const heading of ["Kompetenser", "Skills", "Languages", "Kontakt", "Links"]) {
      expect(classifyCvSection({ heading, items: ["verified text"] })).toBe("sidebar");
    }
    // Certifications render as full credential entries in the main column,
    // alongside experience/education/projects - not as sidebar chips.
    for (const heading of ["Profil", "Summary", "Erfarenhet", "Work Experience", "Utbildning", "Certifieringar", "Certifications", "Projects", "New Section"]) {
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

  it("promotes a genuine short headline alongside a separate profile paragraph to the sidebar title (the deterministic generator's shape)", () => {
    const sections = [{ heading: "Profil", items: ["IT-supporttekniker", "IT-supporttekniker med erfarenhet av användarstöd och felsökning i tekniska miljöer."] }];
    expect(documentTitleForCv(sections)).toBe("IT-supporttekniker");
  });

  it("does not promote a single full profile paragraph (the AI writer's shape) to the sidebar title - it belongs in the main content, not duplicated", () => {
    const sections = [{ heading: "Profil", items: ["IT-supporttekniker med erfarenhet av användarstöd, felsökning och incidenthantering i Microsoft 365- och Azure-miljöer. Har gett fjärrsupport via Teams och ärendehanteringssystem."] }];
    expect(documentTitleForCv(sections)).toBeUndefined();
    // The main content keeps the full paragraph untouched, since no title was extracted to filter out.
    expect(cvBodySections(sections)).toEqual(sections);
  });

  it("still promotes a lone short headline with no separate paragraph at all (e.g. sparse evidence)", () => {
    const sections = [{ heading: "Profil", items: ["Cloud Engineer / IT-support"] }];
    expect(documentTitleForCv(sections)).toBe("Cloud Engineer / IT-support");
  });

  it("promotes a multi-role pipe-separated professional title, not mistaking it for a paragraph", () => {
    const sections = [{ heading: "Profil", items: ["IT-support | IT Coordinator | Cloud | Cybersäkerhet"] }];
    expect(documentTitleForCv(sections)).toBe("IT-support | IT Coordinator | Cloud | Cybersäkerhet");
  });
});

describe("CV sidebar contact field classification", () => {
  it("classifies email, phone, LinkedIn, GitHub, and location/address segments distinctly", () => {
    expect(classifyContactField("abdi.faizal@example.com")).toBe("email");
    expect(classifyContactField("070-000 00 00")).toBe("phone");
    expect(classifyContactField("+46 70 000 00 00")).toBe("phone");
    expect(classifyContactField("linkedin.com/in/abdi-faizal")).toBe("linkedin");
    expect(classifyContactField("github.com/abdi-faizal")).toBe("github");
    expect(classifyContactField("Göteborg, Sverige")).toBe("location");
  });
});

describe("cover-letter header application label", () => {
  it("uses the Swedish label by default and for an explicit Swedish document, English only for an explicit English document", () => {
    expect(coverLetterApplicationLabel(undefined)).toBe("Ansökan");
    expect(coverLetterApplicationLabel("sv")).toBe("Ansökan");
    expect(coverLetterApplicationLabel("en")).toBe("Application");
  });
});

describe("cover-letter header date", () => {
  it("formats a fixed date in Swedish by default and in English for an explicit English document - never a candidate/job fact, purely a presentation timestamp", () => {
    const fixed = new Date("2026-09-13T10:00:00.000Z");
    expect(coverLetterDate(undefined, fixed)).toBe("13 september 2026");
    expect(coverLetterDate("sv", fixed)).toBe("13 september 2026");
    expect(coverLetterDate("en", fixed)).toBe("September 13, 2026");
  });
});
