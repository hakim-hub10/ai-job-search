import { expect, test } from "bun:test";

import type { ApplicationDocumentGenerator, DocumentGenerationRequest, ProviderGenerationResponse } from "../../../.agents/job-search/cli/src/index";
import { generateDeterministicCv, jobAwareProfile, itSupportJob } from "./professional-writer-experiment.fixture";
import { generateApplicationDocument, createApplication, analyzeJobs } from "../../../.agents/job-search/cli/src/index";
import { documentQualityProfile } from "./professional-documents";

/**
 * These tests prove the EXISTING validateGeneratedDocumentProposal (reached
 * through generateApplicationDocument -> generateDocumentProposal) rejects a
 * hallucinating AI generator, without any live OpenAI call. Only the
 * provider boundary (ApplicationDocumentGenerator) is mocked - a fake
 * "malicious writer" that tries each unsupported-claim shape a real model
 * could theoretically emit. No production validation code is touched or
 * weakened to make any of this pass.
 */
function mockGenerator(respond: (request: DocumentGenerationRequest) => ProviderGenerationResponse): ApplicationDocumentGenerator {
  return { async generate(request) { return respond(request); } };
}

async function runWithGenerator(generator: ApplicationDocumentGenerator) {
  const profile = jobAwareProfile();
  const job = itSupportJob();
  const application = createApplication({ id: "validation-check", rankedJob: analyzeJobs(profile, [job]).rankedJobs[0], createdAt: "2026-09-13T10:00:00.000Z" });
  if (!application.ok) throw new Error("fixture failed");
  return generateApplicationDocument({
    application: application.value,
    candidateDocumentInput: { matchingProfile: documentQualityProfile(profile), identity: { fullName: "Alex Testsson" } },
    tailoringOptions: { type: "cv", language: "sv", maxEvidenceItems: 200 },
    generator,
    generationOptions: { untrustedJobDescription: job.description ?? undefined },
  });
}

test("a fabricated evidence ID (unsupported job requirement smuggled in as a skill) is rejected, not saved", async () => {
  const result = await runWithGenerator(mockGenerator((request) => ({
    ok: true,
    value: {
      applicationId: request.applicationId, type: request.type, language: request.language,
      sections: [{
        id: "s1", kind: "skill",
        claims: [{ id: "c1", kind: "candidateFact", provenance: "verbatim", text: "ServiceNow", evidenceIds: ["fabricated:servicenow-not-in-evidence"] }],
      }],
    },
  })));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.error.code).toBe("UNAPPROVED_EVIDENCE_REFERENCE");
});

test("a claim with no evidence at all (unsupported employer) is rejected", async () => {
  const result = await runWithGenerator(mockGenerator((request) => ({
    ok: true,
    value: {
      applicationId: request.applicationId, type: request.type, language: request.language,
      sections: [{ id: "s1", kind: "experience", claims: [{ id: "c1", kind: "candidateFact", provenance: "verbatim", text: "Senior Engineer at Completely Fictional Corp", evidenceIds: [] }] }],
    },
  })));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.error.code).toBe("MISSING_EVIDENCE_REFERENCE");
});

test("an unsupported certification claimed verbatim against real but unrelated evidence is rejected", async () => {
  const result = await runWithGenerator(mockGenerator((request) => {
    const realEvidenceId = request.selectedEvidence.find((e) => e.kind === "experience")!.id;
    return {
      ok: true,
      value: {
        applicationId: request.applicationId, type: request.type, language: request.language,
        sections: [{ id: "s1", kind: "certification", claims: [{ id: "c1", kind: "candidateFact", provenance: "verbatim", text: "AWS Certified Solutions Architect - Professional", evidenceIds: [realEvidenceId] }] }],
      },
    };
  }));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.error.code).toBe("UNSUPPORTED_CLAIM");
});

test("an unsupported education claim (fabricated degree tied to a real but unrelated evidence ID) is rejected", async () => {
  const result = await runWithGenerator(mockGenerator((request) => {
    const realEvidenceId = request.selectedEvidence.find((e) => e.kind === "skill")!.id;
    return {
      ok: true,
      value: {
        applicationId: request.applicationId, type: request.type, language: request.language,
        sections: [{ id: "s1", kind: "education", claims: [{ id: "c1", kind: "candidateFact", provenance: "verbatim", text: "PhD in Computer Science, Fictional University", evidenceIds: [realEvidenceId] }] }],
      },
    };
  }));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.error.code).toBe("UNSUPPORTED_CLAIM");
});

test("application context (id, type, language) must be preserved exactly - a mismatched proposal is rejected", async () => {
  const result = await runWithGenerator(mockGenerator((request) => ({
    ok: true,
    value: { applicationId: request.applicationId, type: request.type, language: "en", sections: [] },
  })));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.error.code).toBe("WRONG_APPLICATION_CONTEXT");
});

test("duplicate claim IDs are rejected as malformed, even if each claim individually looks valid", async () => {
  const result = await runWithGenerator(mockGenerator((request) => {
    const realEvidenceId = request.selectedEvidence.find((e) => e.kind === "skill")!.id;
    const realText = request.selectedEvidence.find((e) => e.id === realEvidenceId)!.content;
    const claim = { id: "duplicate", kind: "candidateFact" as const, provenance: "verbatim" as const, text: realText, evidenceIds: [realEvidenceId] };
    return { ok: true, value: { applicationId: request.applicationId, type: request.type, language: request.language, sections: [{ id: "s1", kind: "skill", claims: [claim, claim] }] } };
  }));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.error.code).toBe("DUPLICATE_CLAIM_ID");
});

test("valid output referencing only real, approved evidence IDs with matching verbatim text is accepted", async () => {
  const result = await runWithGenerator(mockGenerator((request) => {
    const evidence = request.selectedEvidence.find((e) => e.kind === "skill")!;
    return {
      ok: true,
      value: {
        applicationId: request.applicationId, type: request.type, language: request.language,
        sections: [{ id: "s1", kind: "skill", claims: [{ id: "c1", kind: "candidateFact", provenance: "verbatim", text: evidence.content, evidenceIds: [evidence.id] }] }],
      },
    };
  }));
  expect(result.ok).toBe(true);
});

test("a paraphrased claim over real evidence is accepted but flagged for mandatory human review", async () => {
  const result = await runWithGenerator(mockGenerator((request) => {
    const evidence = request.selectedEvidence.find((e) => e.kind === "experience")!;
    return {
      ok: true,
      value: {
        applicationId: request.applicationId, type: request.type, language: request.language,
        sections: [{ id: "s1", kind: "experience", claims: [{ id: "c1", kind: "candidateFact", provenance: "paraphrased", text: "Professionally rewritten version of the verified role.", evidenceIds: [evidence.id] }] }],
      },
    };
  }));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.document.requiresHumanReview).toBe(true);
});

test("the existing deterministic generator continues to behave as before (unaffected by the mock-generator test harness)", async () => {
  const result = await generateDeterministicCv(itSupportJob(), "sv");
  expect(result.ok).toBe(true);
  // The composed summary and reconstructed experience headers are paraphrased
  // (not verbatim evidence text), so this is correctly flagged for review -
  // same as always; this test only proves the mock-generator tests above
  // didn't leak state into or otherwise affect the real deterministic path.
  if (result.ok) expect(result.value.document.requiresHumanReview).toBe(true);
});
