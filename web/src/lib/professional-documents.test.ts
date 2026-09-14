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
  // Each employment entry now renders as a header claim plus separate bullet
  // claims for its description, so the count is per-role, not per-claim.
  expect(sections.find(x => x.kind === "experience")!.claims.filter(c => c.id.endsWith(":header"))).toHaveLength(3);
  expect(sections.find(x => x.kind === "education")!.claims).toHaveLength(2);
  expect(sections.find(x => x.kind === "summary")!.claims.length).toBeLessThanOrEqual(5);
  expect(generated.renderedDocument.content).toContain("Example Logistics");
  for (const text of ["IT-", "Kubernetes", "Responsible for supporting"]) expect(generated.renderedDocument.content).not.toContain(text);
  expect(profile.skills.technical).toContain("IT-");
});
test("a profile corrupted by upstream mojibake (UTF-8 misread as Latin-1) renders cleanly in the generated CV", async () => {
  const { profile, job } = professionalFixture();
  const corrupted = {
    ...profile,
    workExperience: [
      { ...profile.workExperience[0]!, location: "GÃ¶teborg", summary: "FelsÃ¶kning och drift av tekniska miljÃ¶er inom AWS." },
      ...profile.workExperience.slice(1),
    ],
  };
  const application = createApplication({ id: "mojibake-check", rankedJob: analyzeJobs(corrupted, [job]).rankedJobs[0], createdAt: "2026-09-12T10:00:00Z" });
  if (!application.ok) throw new Error("fixture application failed");
  const generated = await generateApplicationDocument({
    application: application.value,
    candidateDocumentInput: { matchingProfile: documentQualityProfile(corrupted), identity: { fullName: "Alex Example" } },
    tailoringOptions: { type: "cv", language: "sv", maxEvidenceItems: 200 },
    generationOptions: { untrustedJobDescription: job.description ?? undefined },
    generator: professionalDocumentGenerator,
  });
  if (!generated.ok) throw new Error(JSON.stringify(generated.error));
  const text = generated.value.renderedDocument.content;
  expect(text).toContain("Göteborg");
  expect(text).not.toContain("Ã");
});
test("a composed profile summary (no authored summary available) reads as coherent prose, never labeled field dumps or a language mention", async () => {
  const { profile, job } = professionalFixture();
  const noSummary = { ...profile, summary: undefined };
  const application = createApplication({ id: "composed-summary-check", rankedJob: analyzeJobs(noSummary, [job]).rankedJobs[0], createdAt: "2026-09-12T10:00:00Z" });
  if (!application.ok) throw new Error("fixture application failed");
  const generated = await generateApplicationDocument({ application: application.value, candidateDocumentInput: { matchingProfile: documentQualityProfile(noSummary), identity: { fullName: "Alex Example" } }, tailoringOptions: { type: "cv", language: "sv", maxEvidenceItems: 200 }, generationOptions: { untrustedJobDescription: job.description ?? undefined }, generator: professionalDocumentGenerator });
  if (!generated.ok) throw new Error(JSON.stringify(generated.error));
  const summarySection = generated.value.document.sections.find((section) => section.kind === "summary");
  const summaryText = summarySection?.claims.map((c) => c.text).join(" ") ?? "";
  for (const label of ["Erfarenhet:", "Kompetenser:", "Utbildning:", "Språk:", "Experience:", "Skills:", "Education:", "Languages:"]) expect(summaryText).not.toContain(label);
  for (const language of noSummary.languages) expect(summaryText).not.toContain(language.name);
  const languageSection = generated.value.document.sections.find((section) => section.kind === "language");
  expect(languageSection?.claims.length).toBe(noSummary.languages.length);
  // Languages appear exactly once across the whole document: only in the dedicated Languages section.
  const totalLanguageMentions = generated.value.document.sections.flatMap((section) => section.claims).filter((claim) => noSummary.languages.some((language) => claim.text.includes(language.name))).length;
  expect(totalLanguageMentions).toBe(noSummary.languages.length);
});

test("the composed profile does not open mechanically with the most recent role/employer - it leads with the candidate's professional direction (headline)", async () => {
  const { profile, job } = professionalFixture();
  const noSummary = { ...profile, summary: undefined };
  const mostRecentRole = noSummary.workExperience[0];
  const application = createApplication({ id: "profile-opening-check", rankedJob: analyzeJobs(noSummary, [job]).rankedJobs[0], createdAt: "2026-09-12T10:00:00Z" });
  if (!application.ok) throw new Error("fixture application failed");
  const generated = await generateApplicationDocument({ application: application.value, candidateDocumentInput: { matchingProfile: documentQualityProfile(noSummary), identity: { fullName: "Alex Example" } }, tailoringOptions: { type: "cv", language: "sv", maxEvidenceItems: 200 }, generationOptions: { untrustedJobDescription: job.description ?? undefined }, generator: professionalDocumentGenerator });
  if (!generated.ok) throw new Error(JSON.stringify(generated.error));
  const summarySection = generated.value.document.sections.find((section) => section.kind === "summary");
  const composedClaim = summarySection?.claims.find((c) => c.id === "professional:summary:composed");
  const firstSentence = composedClaim?.text.split(/(?<=\.)\s+/u)[0] ?? "";
  // The old mechanical pattern opened with "{role} hos {employer}, med erfarenhet av..." -
  // the employer name (and the " hos " employer-attachment marker) must not appear in
  // the opening sentence; the role/employer now get their own dedicated sentence instead.
  expect(firstSentence.includes(mostRecentRole.company)).toBe(false);
  expect(firstSentence).not.toContain(" hos ");
  expect(firstSentence).toStartWith(noSummary.headline);
  expect(composedClaim?.text).toContain(`${mostRecentRole.title} hos ${mostRecentRole.company}`);
});
test("a multi-sentence Base CV work-experience description renders as several bullets under one role header, never collapsed to one line", async () => {
  const { profile, job } = professionalFixture();
  const richExperience = { ...profile, workExperience: [{ ...profile.workExperience[0]!, summary: "Arbetade med IT-support, felsökning och drift av tekniska miljöer. Hanterade incidenter och gav användarsupport via Teams. Arbetade även med dokumentation och övervakning." }] };
  const application = createApplication({ id: "experience-bullets-check", rankedJob: analyzeJobs(richExperience, [job]).rankedJobs[0], createdAt: "2026-09-12T10:00:00Z" });
  if (!application.ok) throw new Error("fixture application failed");
  const generated = await generateApplicationDocument({ application: application.value, candidateDocumentInput: { matchingProfile: documentQualityProfile(richExperience), identity: { fullName: "Alex Example" } }, tailoringOptions: { type: "cv", language: "sv", maxEvidenceItems: 200 }, generationOptions: { untrustedJobDescription: job.description ?? undefined }, generator: professionalDocumentGenerator });
  if (!generated.ok) throw new Error(JSON.stringify(generated.error));
  const experienceSection = generated.value.document.sections.find((section) => section.kind === "experience")!;
  expect(experienceSection.claims.filter((c) => c.id.includes(":header")).length).toBe(1);
  const bodyClaims = experienceSection.claims.filter((c) => c.id.includes(":body:"));
  expect(bodyClaims.length).toBe(3);
  expect(bodyClaims[0]!.text).toContain("felsökning");
  expect(bodyClaims[1]!.text).toContain("Teams");
  expect(bodyClaims[2]!.text).toContain("övervakning");
  expect(experienceSection.claims.find((c) => c.id.includes(":header"))!.text).toContain("Example Logistics");
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
