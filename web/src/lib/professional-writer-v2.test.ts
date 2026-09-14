import { expect, test } from "bun:test";

import type { ApplicationDocumentGenerator, DocumentGenerationRequest, ProviderGenerationResponse } from "../../../.agents/job-search/cli/src/index";
import { generateApplicationDocument, createApplication, analyzeJobs } from "../../../.agents/job-search/cli/src/index";
import { documentQualityProfile, createJobAwareDocumentGenerator } from "./professional-documents";
import { jobAwareProfile, itSupportJob, cloudEngineerJob } from "./job-aware-generation.fixture";

/**
 * Professional Writer V2 tests: prove the pipeline correctly represents,
 * validates, and renders the AI-shaped output the new instructions ask the
 * OpenAI writer to produce (professional:technicalSkills/softSkills split,
 * a single prose-only professional:letter cover-letter section, job-aware
 * evidence prioritization, and the paraphrase/human-review safety net) -
 * entirely through a mocked ApplicationDocumentGenerator, never a live
 * OpenAI call. No production validation or rendering code is weakened to
 * make any of this pass.
 */
function mockGenerator(respond: (request: DocumentGenerationRequest) => ProviderGenerationResponse): ApplicationDocumentGenerator {
  return { async generate(request) { return respond(request); } };
}

async function runWithGenerator(generator: ApplicationDocumentGenerator, type: "cv" | "coverLetter" = "cv", language: "sv" | "en" = "sv", job = itSupportJob()) {
  const profile = jobAwareProfile();
  const application = createApplication({ id: `v2-check-${type}-${language}`, rankedJob: analyzeJobs(profile, [job]).rankedJobs[0], createdAt: "2026-09-13T10:00:00.000Z" });
  if (!application.ok) throw new Error("fixture failed");
  return generateApplicationDocument({
    application: application.value,
    candidateDocumentInput: { matchingProfile: documentQualityProfile(profile), identity: { fullName: "Alex Testsson" } },
    tailoringOptions: { type, language, maxEvidenceItems: 200 },
    generator,
    generationOptions: { untrustedJobDescription: job.description ?? undefined },
  });
}

test("technical and personal skills render as two distinct, correctly labeled sections, never mixed", async () => {
  const result = await runWithGenerator(mockGenerator((request) => {
    const technical = request.selectedEvidence.find((e) => e.kind === "skill" && !e.id.includes("soft-skill"))!;
    const soft = request.selectedEvidence.find((e) => e.kind === "skill" && e.id.includes("soft-skill"))!;
    return {
      ok: true,
      value: {
        applicationId: request.applicationId, type: request.type, language: request.language,
        sections: [
          { id: "professional:technicalSkills", kind: "skill", claims: [{ id: "c1", kind: "candidateFact", provenance: "verbatim", text: technical.content, evidenceIds: [technical.id] }] },
          { id: "professional:softSkills", kind: "skill", claims: [{ id: "c2", kind: "candidateFact", provenance: "verbatim", text: soft.content, evidenceIds: [soft.id] }] },
        ],
      },
    };
  }), "cv", "sv");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const content = result.value.renderedDocument.content;
  expect(content).toContain("## Yrkeskompetenser");
  expect(content).toContain("## Personliga kompetenser");
  const technicalBlock = content.split("## Yrkeskompetenser")[1]!.split("## Personliga kompetenser")[0]!;
  const softBlock = content.split("## Personliga kompetenser")[1]!;
  expect(technicalBlock).not.toContain("## Personliga");
  expect(softBlock).not.toContain("Microsoft 365");
});

test("technical and personal skills use English labels for an English document", async () => {
  const result = await runWithGenerator(mockGenerator((request) => {
    const technical = request.selectedEvidence.find((e) => e.kind === "skill" && !e.id.includes("soft-skill"))!;
    return {
      ok: true,
      value: {
        applicationId: request.applicationId, type: request.type, language: request.language,
        sections: [{ id: "professional:technicalSkills", kind: "skill", claims: [{ id: "c1", kind: "candidateFact", provenance: "verbatim", text: technical.content, evidenceIds: [technical.id] }] }],
      },
    };
  }), "cv", "en");
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.renderedDocument.content).toContain("## Professional skills");
});

test("a cover letter shaped as the writer is instructed to (single professional:letter/context section) renders as plain prose - no headings, no bullet lines", async () => {
  const result = await runWithGenerator(mockGenerator((request) => {
    const experience = request.selectedEvidence.find((e) => e.kind === "experience")!;
    return {
      ok: true,
      value: {
        applicationId: request.applicationId, type: request.type, language: request.language,
        sections: [{
          id: "professional:letter", kind: "context",
          claims: [
            { id: "c1", kind: "neutralContext", provenance: "neutral", text: "Dear Hiring Manager, I am writing to apply for the role.", evidenceIds: [] },
            { id: "c2", kind: "candidateFact", provenance: "paraphrased", text: "I bring hands-on experience relevant to this position.", evidenceIds: [experience.id] },
            { id: "c3", kind: "neutralContext", provenance: "neutral", text: "Kind regards,", evidenceIds: [] },
          ],
        }],
      },
    };
  }), "coverLetter", "en");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const content = result.value.renderedDocument.content;
  expect(content).not.toContain("##");
  expect(content).not.toMatch(/^-\s/mu);
  expect(content).toContain("Dear Hiring Manager, I am writing to apply for the role.");
  expect(content).toContain("I bring hands-on experience relevant to this position.");
});

test("a cover letter that degrades into CV-style visible sections (Motivation/Experience/Skills/Education) is rejected end-to-end, not silently rendered", async () => {
  const cvShapedLetter = await runWithGenerator(mockGenerator((request) => {
    const experience = request.selectedEvidence.find((e) => e.kind === "experience")!;
    const skill = request.selectedEvidence.find((e) => e.kind === "skill")!;
    const education = request.selectedEvidence.find((e) => e.kind === "education")!;
    return {
      ok: true,
      value: {
        applicationId: request.applicationId, type: request.type, language: request.language,
        sections: [
          { id: "motivation", kind: "motivation", claims: [{ id: "m", kind: "neutralContext", provenance: "neutral", text: "Motivated to apply.", evidenceIds: [] }] },
          { id: "experience", kind: "experience", claims: [{ id: "e", kind: "candidateFact", provenance: "verbatim", text: experience.content, evidenceIds: [experience.id] }] },
          { id: "skill", kind: "skill", claims: [{ id: "s", kind: "candidateFact", provenance: "verbatim", text: skill.content, evidenceIds: [skill.id] }] },
          { id: "education", kind: "education", claims: [{ id: "ed", kind: "candidateFact", provenance: "verbatim", text: education.content, evidenceIds: [education.id] }] },
        ],
      },
    };
  }), "coverLetter", "en");
  expect(cvShapedLetter).toMatchObject({ ok: false, error: { error: { code: "INVALID_COVER_LETTER_STRUCTURE" } } });
});

test("a paraphrased claim that stays close to the evidence is accepted and correctly flagged for mandatory human review - the review flag, not automated validation, is what guards against responsibility inflation in free-form paraphrase text", async () => {
  const result = await runWithGenerator(mockGenerator((request) => {
    const evidence = request.selectedEvidence.find((e) => e.kind === "experience")!;
    return {
      ok: true,
      value: {
        applicationId: request.applicationId, type: request.type, language: request.language,
        sections: [{ id: "s1", kind: "experience", claims: [{ id: "c1", kind: "candidateFact", provenance: "paraphrased", text: "Led and managed the entire support organization.", evidenceIds: [evidence.id] }] }],
      },
    };
  }));
  // Structurally valid (real evidence id, declared paraphrased) - validateGeneratedDocumentProposal
  // cannot semantically judge whether prose text inflates a responsibility, so it is accepted here
  // exactly like any other paraphrase. requiresHumanReview=true is the actual safety net; a human
  // reviewer, not automated validation, is expected to catch inflated wording like this example.
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.document.requiresHumanReview).toBe(true);
});

test("responsibility inflation - named transformations: verbatim provenance always rejects the inflated wording; paraphrased provenance accepts it but always requires human review (documented limitation, not automatic rejection)", async () => {
  const cases: Array<{ kind: "skill" | "experience"; inflated: string }> = [
    { kind: "skill", inflated: "Responsible for Azure architecture" }, // evidence: "Azure" ("worked with Azure")
    { kind: "experience", inflated: "Led and managed the entire support team, overseeing all colleague support operations." }, // evidence: the Storelogik Lager role ("supported colleagues")
    { kind: "skill", inflated: "Administered enterprise Linux infrastructure" }, // evidence: "Linux" ("worked with Linux servers")
  ];
  for (const { kind, inflated } of cases) {
    const verbatimRejected = await runWithGenerator(mockGenerator((request) => {
      const evidence = request.selectedEvidence.find((e) => e.kind === kind && (kind !== "skill" || e.content === "Azure" || e.content === "Linux"))!;
      return { ok: true, value: { applicationId: request.applicationId, type: request.type, language: request.language, sections: [{ id: "s", kind, claims: [{ id: "c", kind: "candidateFact", provenance: "verbatim", text: inflated, evidenceIds: [evidence.id] }] }] } };
    }));
    expect(verbatimRejected).toMatchObject({ ok: false, error: { error: { code: "UNSUPPORTED_CLAIM" } } });

    const paraphrasedAccepted = await runWithGenerator(mockGenerator((request) => {
      const evidence = request.selectedEvidence.find((e) => e.kind === kind && (kind !== "skill" || e.content === "Azure" || e.content === "Linux"))!;
      return { ok: true, value: { applicationId: request.applicationId, type: request.type, language: request.language, sections: [{ id: "s", kind, claims: [{ id: "c", kind: "candidateFact", provenance: "paraphrased", text: inflated, evidenceIds: [evidence.id] }] }] } };
    }));
    expect(paraphrasedAccepted.ok).toBe(true);
    if (paraphrasedAccepted.ok) expect(paraphrasedAccepted.value.document.requiresHumanReview).toBe(true);
  }
});

test("adversarial: job-required SAP, French, leadership, 10 years experience, and a certification never become candidate facts when evidence does not support them", async () => {
  const attempts: Array<(request: DocumentGenerationRequest) => ProviderGenerationResponse> = [
    (request) => ({ ok: true, value: { applicationId: request.applicationId, type: request.type, language: request.language, sections: [{ id: "s", kind: "skill", claims: [{ id: "sap", kind: "candidateFact", provenance: "verbatim", text: "SAP", evidenceIds: [] }] }] } }),
    (request) => ({ ok: true, value: { applicationId: request.applicationId, type: request.type, language: request.language, sections: [{ id: "s", kind: "language", claims: [{ id: "fr", kind: "candidateFact", provenance: "verbatim", text: "Franska: Flytande", evidenceIds: [request.selectedEvidence.find((e) => e.kind === "language")!.id] }] }] } }),
    (request) => ({ ok: true, value: { applicationId: request.applicationId, type: request.type, language: request.language, sections: [{ id: "s", kind: "experience", claims: [{ id: "lead", kind: "candidateFact", provenance: "verbatim", text: "Led a team of 10 as department manager", evidenceIds: [request.selectedEvidence.find((e) => e.kind === "experience")!.id] }] }] } }),
    (request) => ({ ok: true, value: { applicationId: request.applicationId, type: request.type, language: request.language, sections: [{ id: "s", kind: "experience", claims: [{ id: "years", kind: "candidateFact", provenance: "verbatim", text: "10 years of professional experience", evidenceIds: [request.selectedEvidence.find((e) => e.kind === "experience")!.id] }] }] } }),
    (request) => ({ ok: true, value: { applicationId: request.applicationId, type: request.type, language: request.language, sections: [{ id: "s", kind: "certification", claims: [{ id: "cert", kind: "candidateFact", provenance: "verbatim", text: "PMP Certified", evidenceIds: [request.selectedEvidence.find((e) => e.kind === "certification")!.id] }] }] } }),
  ];
  for (const respond of attempts) {
    const result = await runWithGenerator(mockGenerator(respond));
    expect(result.ok).toBe(false);
  }
});

test("CV and cover letter draw from the same job-aware-prioritized evidence set for the same profile and job", async () => {
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

test("the job-aware wrapper shifts which experience/skill evidence the writer is shown based on the target job, without changing matching or the approved-evidence trust boundary", async () => {
  const capture = (bucket: { current: string[] }) => mockGenerator((request) => {
    bucket.current = request.selectedEvidence.map((e) => e.id);
    return { ok: true, value: { applicationId: request.applicationId, type: request.type, language: request.language, sections: [] } };
  });
  const itBucket = { current: [] as string[] };
  const cloudBucket = { current: [] as string[] };
  await runWithGenerator(createJobAwareDocumentGenerator(capture(itBucket)), "cv", "sv", itSupportJob());
  await runWithGenerator(createJobAwareDocumentGenerator(capture(cloudBucket)), "cv", "sv", cloudEngineerJob());
  // Same candidate, same evidence catalog - a different target job still changes prioritized order/selection.
  expect(itBucket.current).not.toEqual(cloudBucket.current);
});

test("Swedish and English cover letters are both accepted through the same evidence and validation path", async () => {
  for (const language of ["sv", "en"] as const) {
    const result = await runWithGenerator(mockGenerator((request) => {
      const identity = request.selectedEvidence.filter((e) => e.kind === "identity");
      return {
        ok: true,
        value: {
          applicationId: request.applicationId, type: request.type, language: request.language,
          sections: [{
            id: "professional:letter", kind: "context",
            claims: [
              { id: "open", kind: "neutralContext", provenance: "neutral", text: language === "sv" ? "Hej," : "Dear Hiring Manager,", evidenceIds: [] },
              ...(identity.length ? [{ id: "sig", kind: "candidateFact" as const, provenance: "verbatim" as const, text: identity[0]!.content, evidenceIds: [identity[0]!.id] }] : []),
            ],
          }],
        },
      };
    }), "coverLetter", language);
    expect(result.ok).toBe(true);
  }
});
