import { expect, test } from "bun:test";

import { structureReviewJobs, generateStructureReviewCv } from "./professional-cv-structure.fixture";
import { toDocumentPresentationModel, documentNameForCv, documentTitleForCv, documentContactForCv, cvBodySections } from "./document-presentation";
import { documentExportFormat, type DocumentExportModel } from "./document-export";
import { exportDocumentToPdf } from "./document-pdf-export";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

const CANONICAL_ORDER = ["summary", "experience", "education", "skill", "certification", "project", "language"] as const;

test("canonical CV section order: profile, experience, education, skills, certifications, projects, languages", async () => {
  const { generated } = await generateStructureReviewCv(structureReviewJobs().strong, "en");
  const kinds = generated.document.sections.map((section) => section.kind);
  const present = CANONICAL_ORDER.filter((kind) => kinds.includes(kind));
  expect(present).toEqual(CANONICAL_ORDER.filter((kind) => present.includes(kind)));
  // experience before education, education before skills, skills before
  // certifications, certifications before projects, projects before languages
  for (let i = 0; i < present.length - 1; i++) {
    expect(kinds.indexOf(present[i]!)).toBeLessThan(kinds.indexOf(present[i + 1]!));
  }
});

test("experience and education stay most-recent-first even when relevance ranking would otherwise reorder them", async () => {
  // The partially-relevant job scores the 2019-2022 role above the more
  // recent 2022-2025 role by keyword overlap - presentation order must not
  // follow that relevance ranking for chronological sections.
  const { generated } = await generateStructureReviewCv(structureReviewJobs().partial, "en");
  const experience = generated.document.sections.find((s) => s.kind === "experience")!;
  const headers = experience.claims.filter((c) => c.id.endsWith(":header")).map((c) => c.text);
  expect(headers).toEqual([
    headers.find((text) => text.includes("2022 – 2025"))!,
    headers.find((text) => text.includes("2019 – 2022"))!,
    headers.find((text) => text.includes("2017 – 2019"))!,
  ]);
  const education = generated.document.sections.find((s) => s.kind === "education")!;
  expect(education.claims[0]!.text).toContain("2015 – 2017");
  expect(education.claims[1]!.text).toContain("2012 – 2015");
});

test("headline renders directly below the name in the presentation model, not inside the profile body", async () => {
  const { record, profile } = await generateStructureReviewCv(structureReviewJobs().strong, "en");
  const model = toDocumentPresentationModel(record);
  const name = documentNameForCv(model.sections);
  const title = documentTitleForCv(model.sections);
  expect(name).toBe("Alex Testsson");
  expect(title).toBe(profile.headline);
  const body = cvBodySections(model.sections);
  for (const section of body) expect(section.items).not.toContain(title);
});

test("header contact is present and separate from the profile paragraph", async () => {
  const { record } = await generateStructureReviewCv(structureReviewJobs().strong, "en");
  const model = toDocumentPresentationModel(record);
  const contact = documentContactForCv(model.sections);
  expect(contact).toContain("alex.testsson@example.test");
  const profileSection = cvBodySections(model.sections).find((section) => /^(profil|professional summary|summary)$/iu.test(section.heading));
  expect(profileSection!.items.join(" ")).not.toContain("alex.testsson@example.test");
});

test("certifications render only actual credentials, never the section heading or a URL", async () => {
  const { generated, profile } = await generateStructureReviewCv(structureReviewJobs().strong, "en");
  const section = generated.document.sections.find((s) => s.kind === "certification");
  expect(section).toBeDefined();
  for (const claim of section!.claims) {
    expect(claim.text.toLowerCase()).not.toBe("certifications");
    expect(claim.text.toLowerCase()).not.toBe("certifieringar");
    expect(claim.text).not.toMatch(/^https?:\/\//u);
    expect(profile.certifications).toContain(claim.text);
  }
});

test("projects render in their own section, never folded into skills or certifications", async () => {
  const { generated, profile } = await generateStructureReviewCv(structureReviewJobs().strong, "en");
  const projectSection = generated.document.sections.find((s) => s.kind === "project");
  expect(projectSection).toBeDefined();
  const projectTitles = profile.projects!.map((p) => p.title);
  for (const claim of projectSection!.claims) expect(projectTitles.some((title) => claim.text.includes(title))).toBe(true);
  const skillSection = generated.document.sections.filter((s) => s.kind === "skill");
  const certSection = generated.document.sections.find((s) => s.kind === "certification");
  for (const title of projectTitles) {
    for (const section of skillSection) expect(section.claims.map((c) => c.text).join(" ")).not.toContain(title);
    expect(certSection!.claims.map((c) => c.text).join(" ")).not.toContain(title);
  }
});

test("languages render last among the evidence sections", async () => {
  const { generated } = await generateStructureReviewCv(structureReviewJobs().strong, "en");
  const kinds = generated.document.sections.map((s) => s.kind);
  const languageIndex = kinds.indexOf("language");
  expect(languageIndex).toBeGreaterThan(-1);
  for (const kind of ["summary", "experience", "education", "skill", "certification", "project"] as const) {
    const index = kinds.indexOf(kind);
    if (index > -1) expect(index).toBeLessThan(languageIndex);
  }
});

test("empty sections are omitted entirely, never rendered as an empty heading", async () => {
  const { generated } = await generateStructureReviewCv(structureReviewJobs().strong, "en");
  for (const kind of ["achievement", "motivation", "other"] as const) {
    expect(generated.document.sections.find((s) => s.kind === kind)).toBeUndefined();
  }
  for (const heading of ["## Achievements", "## Motivation", "## Additional Information"]) {
    expect(generated.renderedDocument.content).not.toContain(heading);
  }
});

test("no evidence is duplicated across two different sections", async () => {
  const { generated } = await generateStructureReviewCv(structureReviewJobs().strong, "en");
  const seen = new Map<string, string>();
  for (const section of generated.document.sections) {
    for (const claim of section.claims) {
      for (const evidenceId of claim.evidenceIds) {
        if (seen.has(evidenceId) && seen.get(evidenceId) !== section.kind) {
          throw new Error(`Evidence ${evidenceId} appears in both ${seen.get(evidenceId)} and ${section.kind}`);
        }
        seen.set(evidenceId, section.kind);
      }
    }
  }
});

test("a job-only requirement the candidate does not have is never invented into the CV", async () => {
  const { generated } = await generateStructureReviewCv(structureReviewJobs().partial, "en");
  const text = generated.renderedDocument.content;
  expect(text).not.toContain("Distributed systems");
  expect(text).not.toContain("Certified Scrum Master");
});

test("tailored CV evidence is a subset of the candidate's approved evidence, never invented", async () => {
  const { generated, profile } = await generateStructureReviewCv(structureReviewJobs().strong, "en");
  const approvedText = new Set([
    ...profile.skills.technical, ...profile.skills.soft, ...profile.certifications,
    ...profile.languages.map((l) => l.name), ...(profile.projects ?? []).map((p) => p.title),
    ...profile.workExperience.map((e) => e.title), ...profile.workExperience.map((e) => e.company),
    ...profile.workExperience.map((e) => e.summary),
    ...profile.education.map((e) => e.degree), ...profile.education.map((e) => e.field), ...profile.education.map((e) => e.institution),
    profile.headline, profile.summary,
  ]);
  for (const section of generated.document.sections) {
    // Identity (name/email/phone) is the candidate's own contact data, not
    // profile-evidence content, and summary is composed prose checked for
    // pollution elsewhere - neither is meaningfully checked against this list.
    if (section.kind === "summary" || section.kind === "identity") continue;
    for (const claim of section.claims) {
      // Experience now renders as a header plus separate sentence bullets, so
      // a bullet may be a strict substring of a longer approved value (e.g. a
      // work-experience summary), or vice versa for combined header text.
      const matchesApproved = [...approvedText].some((approved) => approved && (claim.text.includes(approved) || approved.includes(claim.text)));
      expect(matchesApproved).toBe(true);
    }
  }
});

test("Swedish CVs use only Swedish section headings, never a mixed-language heading", async () => {
  const { generated } = await generateStructureReviewCv(structureReviewJobs().strong, "sv");
  const text = generated.renderedDocument.content;
  for (const englishHeading of ["## Professional Summary", "## Experience", "## Education", "## Skills", "## Certifications", "## Projects", "## Languages"]) {
    expect(text).not.toContain(englishHeading);
  }
  for (const swedishHeading of ["## Erfarenhet", "## Utbildning", "## Certifieringar", "## Projekt", "## Språk"]) {
    expect(text).toContain(swedishHeading);
  }
});

test("English CVs use only English section headings, never a mixed-language heading", async () => {
  const { generated } = await generateStructureReviewCv(structureReviewJobs().strong, "en");
  const text = generated.renderedDocument.content;
  for (const swedishHeading of ["## Profil", "## Erfarenhet", "## Utbildning", "## Certifieringar", "## Projekt", "## Språk"]) {
    expect(text).not.toContain(swedishHeading);
  }
  for (const englishHeading of ["## Experience", "## Education", "## Certifications", "## Projects", "## Languages"]) {
    expect(text).toContain(englishHeading);
  }
});

test("the exported PDF stays within a reasonable page range and remains text-extractable", async () => {
  const { record } = await generateStructureReviewCv(structureReviewJobs().strong, "en");
  const model: DocumentExportModel = {
    applicationId: record.applicationId, documentType: "cv", documentVersion: 1, templateId: "modern",
    presentation: toDocumentPresentationModel(record), format: documentExportFormat("pdf")!, suggestedFilename: "structure-review.pdf",
  };
  const result = await exportDocumentToPdf(model);
  if (!result.ok) throw new Error(result.error.code);
  const path = `/tmp/structure-review-${crypto.randomUUID()}.pdf`;
  await Bun.write(path, result.value.bytes);
  try {
    const text = (await execFileAsync("pdftotext", [path, "-"])).stdout;
    const info = (await execFileAsync("pdfinfo", [path])).stdout;
    const pages = Number(/Pages:\s+(\d+)/u.exec(info)?.[1]);
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(pages).toBeLessThanOrEqual(2);
    expect(text).toContain("Alex Testsson");
    expect(text).not.toContain("(cid:");
  } finally {
    await Bun.file(path).delete();
  }
}, 30000);
