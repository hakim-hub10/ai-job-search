import { professionalFixture, generateProfessionalFixture } from "./professional-documents.fixture";
import { expect, test } from "bun:test";
import { analyzeJobs, normalizeJob, createApplication, generateApplicationDocument } from "../../../.agents/job-search/cli/src/index";
import { documentQualityProfile, documentQualityExclusions, professionalDocumentGenerator, resolveDocumentLanguage } from "./professional-documents";
import { toDocumentPresentationModel } from "./document-presentation";
import { documentExportFormat, type DocumentExportModel } from "./document-export";
import { exportDocumentToPdf } from "./document-pdf-export";
import { exportDocumentToDocx } from "./document-docx-export";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
import { presentMatch, auditJobRequirements } from "./match-confidence";

test("professional CV selects bounded evidence, preserves strong experience and excludes pollution and unsupported skills", async () => {
  const { generated, profile } = await generateProfessionalFixture("cv", "en");
  const sections = generated.document.sections;
  expect(sections.find(x => x.kind === "skill")!.claims.length).toBeLessThanOrEqual(12);
  expect(sections.find(x => x.kind === "experience")!.claims).toHaveLength(3);
  expect(sections.find(x => x.kind === "education")!.claims).toHaveLength(2);
  expect(sections.find(x => x.kind === "summary")!.claims.length).toBeLessThanOrEqual(5);
  expect(generated.renderedDocument.content).toContain("Example Logistics");
  for (const text of ["IT-", "Kubernetes", "Responsible for supporting"]) expect(generated.renderedDocument.content).not.toContain(text);
  expect(profile.skills.technical).toContain("IT-");
});
test("a pasted-CV-shaped summary is excluded (with a reason) and never dumped verbatim into the generated CV", async () => {
  const { profile, job } = professionalFixture();
  const pastedSummary = "Operations Analyst med erfarenhet av SQL-rapportering och Excel-prognoser.\nArbetade på Example Logistics 2022-2025.\n\nUtbildning: BSc Economics, Example University.\n\nReferenser: available on request. Kontakt: alex@example.test.";
  const polluted = { ...profile, summary: pastedSummary };

  const exclusions = documentQualityExclusions(polluted);
  expect(exclusions).toContainEqual(expect.objectContaining({ field: "summary", classification: "RAW_IMPORT_BLOCK" }));
  expect(polluted.summary).toBe(pastedSummary); // the stored profile itself is never mutated

  const cleaned = documentQualityProfile(polluted);
  expect(cleaned.summary).toBeUndefined();

  const application = createApplication({ id: "pollution-check", rankedJob: analyzeJobs(cleaned, [job]).rankedJobs[0], createdAt: "2026-09-12T10:00:00Z" });
  if (!application.ok) throw new Error("fixture application failed");
  const generated = await generateApplicationDocument({ application: application.value, candidateDocumentInput: { matchingProfile: cleaned, identity: { fullName: "Alex Example" } }, tailoringOptions: { type: "cv", language: "en", maxEvidenceItems: 200 }, generationOptions: { untrustedJobDescription: job.description ?? undefined }, generator: professionalDocumentGenerator });
  if (!generated.ok) throw new Error(JSON.stringify(generated.error));

  const text = generated.value.renderedDocument.content;
  expect(text).not.toContain("Referenser");
  expect(text).not.toContain("alex@example.test");
  expect(text).not.toContain("Kontakt:");
  const summarySection = generated.value.document.sections.find((section) => section.kind === "summary");
  for (const claim of summarySection?.claims ?? []) expect(claim.text.split("\n").length).toBeLessThanOrEqual(1);
});

for (const language of ["sv", "en"] as const) test(`professional ${language} letter has factual paragraphs, context, name and closing`, async () => {
  const { generated, record } = await generateProfessionalFixture("coverLetter", language);
  const text = generated.renderedDocument.content;
  expect(text).toStartWith(language === "sv" ? "Hej," : "Dear Hiring Manager,");
  expect(text).toContain(language === "sv" ? "Med vänliga hälsningar" : "Kind regards,");
  expect(text).toContain("Alex Example"); expect(text).toContain("Operations Analyst");
  expect(text).toContain("Example Logistics");
  expect(text).not.toMatch(/##|Ansökningskontext|Kubernetes|evidenceIds|Strukturerad disposition/);
  expect(text.split(/\s+/u).length).toBeGreaterThanOrEqual(250);
  expect(text.split(/\s+/u).length).toBeLessThanOrEqual(450);
  const model = toDocumentPresentationModel(record);
  expect(model.sections.flatMap(x => x.items).join(" ")).toContain("Research & Planning");
  expect(model.sections.flatMap(x => x.items).join(" ")).not.toContain("&amp;");
});
test("the letter signs off with a clean name and contact block, not scattered across separate lines", async () => {
  const { profile, job } = professionalFixture();
  const application = createApplication({ id: "signature-check", rankedJob: analyzeJobs(profile, [job]).rankedJobs[0], createdAt: "2026-09-12T10:00:00Z" });
  if (!application.ok) throw new Error("fixture application failed");
  const generated = await generateApplicationDocument({ application: application.value, candidateDocumentInput: { matchingProfile: documentQualityProfile(profile), identity: { fullName: "Alex Example", email: "alex@example.test", phone: "070-1234567" } }, tailoringOptions: { type: "coverLetter", language: "en", maxEvidenceItems: 200 }, generationOptions: { untrustedJobDescription: job.description ?? undefined }, generator: professionalDocumentGenerator });
  if (!generated.ok) throw new Error(JSON.stringify(generated.error));
  const text = generated.value.renderedDocument.content;
  expect(text.trimEnd().split("\n").slice(-2)).toEqual(["Alex Example", "alex@example.test · 070-1234567"]);
});
test("rich evidence is scored while sparse listings do not present a definitive zero", () => {
  const { profile, job } = professionalFixture();
  const rich = analyzeJobs(profile, [job]).rankedJobs[0];
  expect(rich.score).toBeGreaterThan(40);
  expect(presentMatch(rich).insufficient).toBe(false);
  const sparse = normalizeJob({ id: "sparse", source: "linkedin", title: "IT Support Technician" });
  const ranked = analyzeJobs(profile, [sparse]).rankedJobs[0]; const before = structuredClone(ranked);
  expect(presentMatch(ranked)).toMatchObject({ scoreLabel: "Otillräckligt underlag", diagnosis: "DESCRIPTION_MISSING" });
  expect(ranked).toEqual(before);
  expect(auditJobRequirements(sparse).technicalRequirements).toBe(0);
});
test("language defaults follow job text with an explicit override", () => {
  expect(resolveDocumentLanguage(undefined, "Vi söker dig som har erfarenhet och kunskaper")).toBe("sv");
  expect(resolveDocumentLanguage(undefined, "We require experience and skills for the role")).toBe("en");
  expect(resolveDocumentLanguage("sv", "We require experience and skills")).toBe("sv");
});
for (const type of ["cv", "coverLetter"] as const) test(`${type} exports remain readable across all existing designs`, async () => {
  const { record } = await generateProfessionalFixture(type, "en");
  for (const templateId of ["modern", "classic", "minimal"] as const) {
    const model: DocumentExportModel = { applicationId: record.applicationId, documentType: type, documentVersion: 1, templateId, presentation: toDocumentPresentationModel(record), format: documentExportFormat("pdf")!, suggestedFilename: "quality.pdf" };
    const result = await exportDocumentToPdf(model); if (!result.ok) throw new Error(result.error.code);
    const path = `/tmp/document-quality-${crypto.randomUUID()}.pdf`;
    await Bun.write(path, result.value.bytes);
    try {
      const text = (await execFileAsync("pdftotext", [path, "-"])).stdout;
      const info = (await execFileAsync("pdfinfo", [path])).stdout;
      expect(Number(/Pages:\s+(\d+)/u.exec(info)?.[1])).toBeLessThanOrEqual(2);
      expect(text).toContain("Alex Example"); expect(text).not.toContain("Kubernetes");
      if (type === "coverLetter") expect(text).toContain("Dear Hiring Manager,");
    } finally { await Bun.file(path).delete(); }
    const docx = await exportDocumentToDocx({ ...model, format: documentExportFormat("docx")!, suggestedFilename: "quality.docx" });
    expect(docx.ok).toBe(true);
  }
}, 30000);
