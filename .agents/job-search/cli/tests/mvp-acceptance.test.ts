import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  createFileApplicationRepository,
  normalizeCandidateProfile,
  normalizeJob,
  runInterviewCliWorkflow,
  runMvpWorkflow,
  searchJobs,
  type CandidateDocumentEvidenceInput,
  type InterviewAIGenerator,
  type InterviewAIRequest,
  type JobSourceAdapter,
} from "../src/index"

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

describe("Phase 1–5 technical MVP acceptance", () => {
  it("completes the synthetic offline journey with exact dedupe, persistence, truth boundaries, feedback, and optional AI", async () => {
    const directory = await mkdtemp(join(tmpdir(), "career-agent-mvp-acceptance-")); directories.push(directory)
    const repositoryPath = join(directory, "applications.json")
    const repository = createFileApplicationRepository(repositoryPath)
    const strongUrl = "https://jobs.example.test/logistics-coordinator"
    const strong = normalizeJob({
      id: "source-a-strong", source: "source-a", sourceId: "a-101", title: "Logistics Coordinator", company: "Example Logistics", location: "Malmö",
      url: strongUrl, applyUrl: strongUrl, remote: "onsite", employmentType: "full-time", seniority: "mid",
      skills: ["Scheduling", "Forklift", "SAP"], description: "Coordinate schedules and use SAP.",
    })
    const duplicate = normalizeJob({
      id: "source-b-duplicate", source: "source-b", sourceId: "b-909", title: strong.title, company: strong.company, location: strong.location,
      url: strongUrl, applyUrl: strongUrl, remote: "onsite", employmentType: "full-time", seniority: "mid",
      skills: [...strong.skills], description: strong.description,
    })
    const weaker = normalizeJob({
      id: "source-c-weaker", source: "source-c", sourceId: "c-202", title: "Warehouse Assistant", company: "Other Logistics", location: "Lund",
      url: "https://jobs.example.test/warehouse-assistant", applyUrl: null, remote: "onsite", employmentType: "part-time", seniority: "entry",
      skills: ["Inventory auditing"], description: "Audit warehouse inventory.",
    })
    const unknown = normalizeJob({
      id: "source-c-unknown", source: "source-c", sourceId: "c-303", title: "Inventory Clerk", company: "Sparse Logistics", location: null,
      url: "https://jobs.example.test/sparse", applyUrl: null, remote: null, employmentType: null, seniority: null, skills: [], description: null,
    })
    const adapters: JobSourceAdapter[] = [
      { name: "source-a", search: async () => ({ jobs: [strong], status: "ok", source: "source-a" }) },
      { name: "source-b", search: async () => ({ jobs: [duplicate], status: "ok", source: "source-b" }) },
      { name: "source-c", search: async () => ({ jobs: [weaker, unknown], status: "ok", source: "source-c" }) },
      { name: "source-failure", search: async () => ({ jobs: [], status: "error", source: "source-failure", error: "Synthetic offline source failure." }) },
    ]
    const profile = normalizeCandidateProfile({
      headline: "Logistics coordinator", targetRoles: ["Logistics Coordinator"], locationPreferences: ["Malmö"], workMode: "onsite", remotePreference: false,
      preferredEmploymentType: ["full-time"], skills: { technical: ["Scheduling", "Forklift"], soft: ["Communication"] }, yearsOfExperience: 3,
    })
    const evidence: CandidateDocumentEvidenceInput = { evidence: [
      { id: "skill:scheduling", kind: "skill", content: "Scheduling", relatedRequirements: [{ category: "skill", value: "Scheduling" }] },
      { id: "experience:scheduling", kind: "experience", content: "Coordinated warehouse schedules.", relatedRequirements: [{ category: "skill", value: "Scheduling" }] },
    ] }

    const mvp = await runMvpWorkflow({
      profile, documentEvidence: evidence,
      search: { query: "Logistics Coordinator", location: "Malmö", adapters, includeSourceStatus: true },
      selectedRank: 0,
      application: { id: "acceptance-application", createdAt: "2026-09-02T10:00:00.000Z" },
      documents: [{ type: "cv", language: "en" }],
    }, { searchJobs, applicationRepository: repository })
    expect(mvp).toMatchObject({ ok: true, search: { total: 3 }, application: { id: "acceptance-application" } })
    if (!mvp.ok) throw new Error("Expected successful MVP workflow")
    expect(mvp.search.jobs.map((job) => job.id)).toEqual(["source-a-strong", "source-c-weaker", "source-c-unknown"])
    expect(mvp.relevance.eligibleJobs.map((job) => job.id)).toEqual(["source-a-strong"])
    expect(mvp.relevance.excludedJobs.map(({ job, relevance }) => ({ id: job.id, tier: relevance.tier }))).toEqual([
      { id: "source-c-weaker", tier: "irrelevant" },
      { id: "source-c-unknown", tier: "irrelevant" },
    ])
    expect(mvp.search.sourceStatus).toContainEqual({ source: "source-failure", status: "error", count: 0, error: "Synthetic offline source failure." })
    expect(mvp.selectedJob.job).toMatchObject({ id: "source-a-strong", source: "source-a", sourceId: "a-101", url: strongUrl })
    expect(mvp.analysis.rankedJobs.map((item) => item.job.id)).toEqual(["source-a-strong"])
    const technical = [...mvp.selectedJob.matchingResult.matched, ...mvp.selectedJob.matchingResult.missing].find((item) => item.dimension === "technicalSkills")
    expect(technical?.requirementCoverage?.matchedRequirements).toContain("Forklift")
    expect(mvp.selectedJob.skillGapResult.gaps.map((gap) => gap.jobRequirement)).toContain("Required: SAP")
    expect(mvp.analysis.learningPlan.prioritizedGaps.map((gap) => gap.skill)).toContain("SAP")
    expect(mvp.analysis.learningPlan.prioritizedGaps.map((gap) => gap.skill)).not.toContain("Inventory auditing")
    expect(mvp.documents[0].rendered.content).toContain("Coordinated warehouse schedules.")
    expect(mvp.documents[0].rendered.content).not.toContain("Forklift")
    expect(mvp.documents[0].rendered.content).not.toContain("SAP")

    const reloaded = await createFileApplicationRepository(repositoryPath).getById("acceptance-application")
    expect(reloaded).toEqual({ ok: true, value: mvp.application })
    if (!reloaded.ok) throw new Error("Expected persisted application")
    expect(reloaded.value.analysisSnapshot.skillGapResult.gaps.map((gap) => gap.jobRequirement)).toContain("Required: SAP")

    const requests: InterviewAIRequest[] = []
    const generator: InterviewAIGenerator = { generate: async (request) => {
      requests.push(request)
      return { ok: true, value: {
        applicationId: request.applicationId, sessionId: request.sessionId, questionId: request.questionId, language: request.language,
        feedback: [{ id: "truthful-gap", category: "truthBoundary", suggestion: "Acknowledge the SAP gap and discuss only supported adjacent scheduling evidence.", evidenceIds: ["experience:scheduling"], requirementKeys: ["skill:sap"], feedbackCodes: [] }],
        followUpQuestions: [{ id: "gap-follow-up", purpose: "exploreGapTruthfully", prompt: "How would you learn SAP while keeping the direct-experience gap clear?", evidenceIds: ["experience:scheduling"], requirementKeys: ["skill:sap"], feedbackCodes: [] }],
        requiresHumanReview: true,
      } }
    } }
    const rawAnswer = "PRIVATE ACCEPTANCE ANSWER: I have not used SAP directly, and I can discuss adjacent scheduling work."
    const interview = await runInterviewCliWorkflow({
      application: reloaded.value, documentEvidence: evidence, questionId: "requirement:missing:skill:sap",
      answer: { text: rawAnswer, citedEvidenceIds: ["experience:scheduling"] }, generator,
    })
    expect(interview).toMatchObject({ ok: true, mode: "evaluation", question: { category: "gapFocused" }, deterministicFeedback: { semanticSupport: "notDetermined" }, ai: { ok: true, value: { requiresHumanReview: true } } })
    if (!interview.ok || interview.mode !== "evaluation" || !interview.ai?.ok) throw new Error("Expected interview evaluation with AI proposal")
    expect(interview.session.turns.at(-1)).toMatchObject({ status: "submitted", preparation: { warnings: expect.arrayContaining([expect.objectContaining({ code: "MISSING_REQUIREMENT_TRUTH_REMINDER" })]) } })
    expect(interview.session.planQuestionIds).not.toContain("gap-follow-up")
    expect(interview.ai.value.proposal.followUpQuestions[0].id).toBe("gap-follow-up")
    expect(requests).toHaveLength(1)
    expect(requests[0].approvedEvidenceIds).toEqual(["experience:scheduling"])
    expect(JSON.stringify(requests[0])).not.toContain("Forklift")
    expect(JSON.stringify(interview)).not.toContain(rawAnswer)
    expect(JSON.stringify(interview.session)).not.toContain(rawAnswer)
    expect(await readFile(repositoryPath, "utf8")).not.toContain(rawAnswer)
  })
})
