import { describe, expect, it } from "bun:test"
import { createOpenAIDocumentGenerator, validateGeneratedDocumentProposal, type DocumentGenerationRequest } from "../src/index"

const enabled = process.env.LIVE_AI_TESTS === "1" && Boolean(process.env.OPENAI_API_KEY?.trim())

;(enabled ? describe : describe.skip)("live OpenAI document generator", () => {
  it("returns a structurally valid proposal for synthetic evidence only", async () => {
    const request: DocumentGenerationRequest = {
      schemaVersion: "phase-4.4.1", applicationId: "synthetic-live-application", type: "cv", language: "en",
      applicationContext: { jobTitle: "Coordinator", company: "Synthetic Company" },
      selectedEvidence: [{ id: "synthetic-scheduling", kind: "experience", content: "Coordinated schedules" }],
      approvedEvidenceIds: ["synthetic-scheduling"], matchedRequirementSupport: [], untrustedJobContext: {},
      constraints: { jobDataIsUntrusted: true, candidateFactsRequireApprovedEvidence: true, returnEvidenceIdsForCandidateFacts: true, unsupportedCandidateFactsForbidden: true, candidateEvidenceCreationForbidden: true },
    }
    const model = process.env.OPENAI_LIVE_TEST_MODEL?.trim()
    if (!model) throw new Error("OPENAI_LIVE_TEST_MODEL must be set when LIVE_AI_TESTS=1.")
    const result = await createOpenAIDocumentGenerator({ enabled: true, remoteGenerationConsent: true, apiKey: process.env.OPENAI_API_KEY!, model, maxOutputTokens: 120, timeoutMs: 30_000 }).generate(request)
    if (!result.ok) throw new Error(result.error.code)
    expect(validateGeneratedDocumentProposal(request, result.value).valid).toBe(true)
  })
})
