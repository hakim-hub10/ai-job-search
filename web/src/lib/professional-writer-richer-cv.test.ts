import { expect, test } from "bun:test";

import type { ApplicationDocumentGenerator, DocumentGenerationRequest, GeneratedDocumentClaim, ProviderGenerationResponse } from "../../../.agents/job-search/cli/src/index";
import { generateApplicationDocument, createApplication, analyzeJobs } from "../../../.agents/job-search/cli/src/index";
import { documentQualityProfile, createJobAwareDocumentGenerator } from "./professional-documents";
import { jobAwareProfile, itSupportJob, cloudEngineerJob } from "./job-aware-generation.fixture";

/**
 * Richer job-tailored CV tests: prove the pipeline correctly represents,
 * validates, and renders the fuller CV shape the updated writer instructions
 * ask for (4-5 sentence profile, 4-6 bullets for the primary role, 2-4 for
 * secondary/transferable roles, job-aware emphasis, no inflation) - entirely
 * through a mocked ApplicationDocumentGenerator, never a live OpenAI call.
 * Actual prose quality from the real model was verified manually and is
 * reported separately; these tests prove the pipeline never blocks or
 * silently degrades a richly-evidenced, correctly-shaped proposal, and that
 * the trust boundary still rejects an inflated or fabricated one.
 */
function mockGenerator(respond: (request: DocumentGenerationRequest) => ProviderGenerationResponse): ApplicationDocumentGenerator {
  return { async generate(request) { return respond(request); } };
}

async function runWithGenerator(generator: ApplicationDocumentGenerator, type: "cv" | "coverLetter" = "cv", language: "sv" | "en" = "sv", job = itSupportJob()) {
  const profile = jobAwareProfile();
  const application = createApplication({ id: `richer-cv-${type}-${language}-${job.id}`, rankedJob: analyzeJobs(profile, [job]).rankedJobs[0], createdAt: "2026-09-13T10:00:00.000Z" });
  if (!application.ok) throw new Error("fixture failed");
  return generateApplicationDocument({
    application: application.value,
    candidateDocumentInput: { matchingProfile: documentQualityProfile(profile), identity: { fullName: "Alex Testsson" } },
    tailoringOptions: { type, language, maxEvidenceItems: 200 },
    generator,
    generationOptions: { untrustedJobDescription: job.description ?? undefined },
  });
}

/** Composed/rewritten sentences (the writer's normal output shape) are paraphrased, not verbatim - verbatim would require exact evidence-text equality. */
function paraphrasedClaim(id: string, evidenceId: string, text: string): GeneratedDocumentClaim {
  return { id, kind: "candidateFact", provenance: "paraphrased", text, evidenceIds: [evidenceId] };
}

test("a 4-5 sentence profile with no language mention is accepted and renders as a single coherent paragraph, never split or truncated", async () => {
  const fiveSentenceProfile = [
    "IT-supporttekniker med inriktning mot användarnära support och drift av tekniska miljöer.",
    "Kan bidra med praktisk felsökningsförmåga och ett strukturerat arbetssätt i supportärenden.",
    "Har arbetat som Cloud Engineer / IT-support hos Nordvik IT Solutions AB med fokus på användarstöd och incidenthantering.",
    "De starkaste tekniska kompetenserna omfattar Microsoft 365 och Active Directory.",
    "Erfarenheten från en operativ logistikroll har även utvecklat förmågan att samarbeta och prioritera under tidspress.",
  ].join(" ");
  const result = await runWithGenerator(mockGenerator((request) => {
    const headline = request.selectedEvidence.find((e) => e.id === "profile:headline")!;
    return {
      ok: true,
      value: {
        applicationId: request.applicationId, type: request.type, language: request.language,
        sections: [{ id: "s", kind: "summary", claims: [paraphrasedClaim("c", headline.id, fiveSentenceProfile)] }],
      },
    };
  }));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const summaryClaims = result.value.document.sections.find((s) => s.kind === "summary")?.claims ?? [];
  expect(summaryClaims).toHaveLength(1);
  expect(summaryClaims[0].text.split(/(?<=\.)\s+/u)).toHaveLength(5);
  for (const language of ["Svenska", "Engelska", "Swedish", "English"]) expect(summaryClaims[0].text).not.toContain(language);
});

test("the primary role can carry 4-6 bullets and a secondary role 2-4 bullets in one experience section, all accepted", async () => {
  const result = await runWithGenerator(mockGenerator((request) => {
    const primary = request.selectedEvidence.find((e) => e.kind === "experience" && e.content.includes("Nordvik"))!;
    const secondary = request.selectedEvidence.find((e) => e.kind === "experience" && e.content.includes("Storelogik"))!;
    const claims: GeneratedDocumentClaim[] = [
      paraphrasedClaim("primary-header", primary.id, "Cloud Engineer / IT-support hos Nordvik IT Solutions AB"),
      paraphrasedClaim("primary-1", primary.id, "Arbetade med IT-support, användarstöd och felsökning."),
      paraphrasedClaim("primary-2", primary.id, "Hanterade tekniska incidenter via Teams och ärendehanteringssystem."),
      paraphrasedClaim("primary-3", primary.id, "Dokumenterade arbetet och hanterade åtkomstkontroll i Active Directory."),
      paraphrasedClaim("primary-4", primary.id, "Arbetade med nätverkskonfiguration och Linux-servrar i molnmiljön."),
      paraphrasedClaim("primary-5", primary.id, "Deltog i automatisering av infrastruktur med Terraform och Kubernetes."),
      paraphrasedClaim("secondary-header", secondary.id, "Lagmedarbetare / Driftledare hos Storelogik Lager AB"),
      paraphrasedClaim("secondary-1", secondary.id, "Koordinerade det dagliga arbetet i en operativ logistikmiljö."),
      paraphrasedClaim("secondary-2", secondary.id, "Stöttade kollegor och hanterade operativa problem."),
    ];
    return { ok: true, value: { applicationId: request.applicationId, type: request.type, language: request.language, sections: [{ id: "s", kind: "experience", claims }] } };
  }));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const claims = result.value.document.sections.find((s) => s.kind === "experience")?.claims ?? [];
  const primaryBullets = claims.filter((c) => c.id.startsWith("primary-") && c.id !== "primary-header");
  const secondaryBullets = claims.filter((c) => c.id.startsWith("secondary-") && c.id !== "secondary-header");
  expect(primaryBullets.length).toBeGreaterThanOrEqual(4);
  expect(primaryBullets.length).toBeLessThanOrEqual(6);
  expect(secondaryBullets.length).toBeGreaterThanOrEqual(2);
  expect(secondaryBullets.length).toBeLessThanOrEqual(4);
});

test("transferable (secondary-role) experience is preserved in the rendered CV, not dropped in favor of the primary role", async () => {
  const result = await runWithGenerator(mockGenerator((request) => {
    const secondary = request.selectedEvidence.find((e) => e.kind === "experience" && e.content.includes("Storelogik"))!;
    return {
      ok: true,
      value: {
        applicationId: request.applicationId, type: request.type, language: request.language,
        sections: [{
          id: "s", kind: "experience",
          claims: [
            paraphrasedClaim("h", secondary.id, "Lagmedarbetare / Driftledare hos Storelogik Lager AB"),
            paraphrasedClaim("b1", secondary.id, "Koordinerade det dagliga arbetet och prioriterade uppgifter."),
            paraphrasedClaim("b2", secondary.id, "Kommunicerade mellan medarbetare och ansvariga funktioner under tidspress."),
          ],
        }],
      },
    };
  }));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.renderedDocument.content).toContain("Storelogik Lager AB");
});

test("job context changes which experience/skill evidence the writer is shown, for CV generation specifically", async () => {
  const capture = (bucket: { current: string[] }) => mockGenerator((request) => {
    bucket.current = request.selectedEvidence.map((e) => e.id);
    return { ok: true, value: { applicationId: request.applicationId, type: request.type, language: request.language, sections: [] } };
  });
  const itBucket = { current: [] as string[] };
  const cloudBucket = { current: [] as string[] };
  await runWithGenerator(createJobAwareDocumentGenerator(capture(itBucket)), "cv", "sv", itSupportJob());
  await runWithGenerator(createJobAwareDocumentGenerator(capture(cloudBucket)), "cv", "sv", cloudEngineerJob());
  expect(itBucket.current).not.toEqual(cloudBucket.current);
});

test("responsibility inflation in a rich multi-bullet role: verbatim provenance rejects the inflated wording, paraphrased accepts it but always requires human review", async () => {
  const inflated = "Ansvarade för hela IT-infrastrukturen och ledde teamet för molndrift.";
  const verbatimAttempt = await runWithGenerator(mockGenerator((request) => {
    const primary = request.selectedEvidence.find((e) => e.kind === "experience" && e.content.includes("Nordvik"))!;
    return { ok: true, value: { applicationId: request.applicationId, type: request.type, language: request.language, sections: [{ id: "s", kind: "experience", claims: [{ id: "c", kind: "candidateFact" as const, provenance: "verbatim" as const, text: inflated, evidenceIds: [primary.id] }] }] } };
  }));
  expect(verbatimAttempt).toMatchObject({ ok: false, error: { error: { code: "UNSUPPORTED_CLAIM" } } });

  const paraphrasedAttempt = await runWithGenerator(mockGenerator((request) => {
    const primary = request.selectedEvidence.find((e) => e.kind === "experience" && e.content.includes("Nordvik"))!;
    return { ok: true, value: { applicationId: request.applicationId, type: request.type, language: request.language, sections: [{ id: "s", kind: "experience", claims: [{ id: "c", kind: "candidateFact", provenance: "paraphrased", text: inflated, evidenceIds: [primary.id] }] }] } };
  }));
  expect(paraphrasedAttempt.ok).toBe(true);
  if (paraphrasedAttempt.ok) expect(paraphrasedAttempt.value.document.requiresHumanReview).toBe(true);
});

test("CV and cover letter stay factually consistent: an employer/technology introduced in one but not present in the shared evidence is rejected in both", async () => {
  const cv = await runWithGenerator(mockGenerator((request) => ({
    ok: true,
    value: {
      applicationId: request.applicationId, type: request.type, language: request.language,
      sections: [{ id: "s", kind: "skill", claims: [{ id: "c", kind: "candidateFact", provenance: "verbatim", text: "SAP", evidenceIds: ["fabricated:sap"] }] }],
    },
  })));
  const letter = await runWithGenerator(mockGenerator((request) => ({
    ok: true,
    value: {
      applicationId: request.applicationId, type: request.type, language: request.language,
      sections: [{ id: "professional:letter", kind: "context", claims: [{ id: "c", kind: "candidateFact", provenance: "verbatim", text: "SAP", evidenceIds: ["fabricated:sap"] }] }],
    },
  })), "coverLetter");
  expect(cv.ok).toBe(false);
  expect(letter.ok).toBe(false);
});

test("both CV and cover letter draw from the identical job-aware-prioritized evidence set for the same profile and job", async () => {
  const capture = (bucket: { current: string[] }) => mockGenerator((request) => {
    bucket.current = request.selectedEvidence.map((e) => e.id).sort();
    const sections = request.type === "coverLetter"
      ? [{ id: "professional:letter", kind: "context" as const, claims: [{ id: "c", kind: "neutralContext" as const, provenance: "neutral" as const, text: "Dear Hiring Manager,", evidenceIds: [] }] }]
      : [];
    return { ok: true, value: { applicationId: request.applicationId, type: request.type, language: request.language, sections } };
  });
  const cvBucket = { current: [] as string[] };
  const letterBucket = { current: [] as string[] };
  const cv = await runWithGenerator(createJobAwareDocumentGenerator(capture(cvBucket)), "cv", "sv", itSupportJob());
  const letter = await runWithGenerator(createJobAwareDocumentGenerator(capture(letterBucket)), "coverLetter", "sv", itSupportJob());
  expect(cv.ok).toBe(true);
  expect(letter.ok).toBe(true);
  expect(cvBucket.current).toEqual(letterBucket.current);
  expect(cvBucket.current.length).toBeGreaterThan(0);
});
