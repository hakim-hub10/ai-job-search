import { describe, expect, it } from "bun:test"
import {
  analyzeJobs,
  createDefaultCandidateProfile,
  normalizeCandidateProfile,
  normalizeJob,
  searchJobs,
  type JobSourceAdapter,
  type NormalizedJob,
} from "../src/index"

function operationsCandidate() {
  return normalizeCandidateProfile({
    headline: "Operations coordinator",
    targetRoles: ["Operations Coordinator", "Supply Chain Analyst"],
    locationPreferences: ["Aarhus, Denmark"],
    workMode: "onsite",
    remotePreference: false,
    preferredEmploymentType: ["full-time"],
    skills: { technical: ["Inventory management", "Scheduling", "Safety procedures"], soft: ["Communication", "Collaboration"] },
    yearsOfExperience: 3,
  })
}

function job(overrides: Partial<NormalizedJob> & Pick<NormalizedJob, "id" | "title">): NormalizedJob {
  return normalizeJob({
    source: "test",
    sourceId: `${overrides.id}-source`,
    company: "Example employer",
    location: "Aarhus, Denmark",
    url: `https://example.test/${overrides.id}`,
    applyUrl: `https://example.test/${overrides.id}/apply`,
    remote: "onsite",
    employmentType: "full-time",
    seniority: "mid",
    category: "operations",
    description: "Communication and collaboration are important.",
    skills: ["Inventory management", "Scheduling", "Safety procedures"],
    ...overrides,
  })
}

describe("production career-analysis orchestrator", () => {
  it("analyzes multi-domain jobs end-to-end while preserving provenance and concrete gaps", () => {
    const candidate = operationsCandidate()
    const strong = job({ id: "strong", title: "Operations Coordinator" })
    const partial = job({
      id: "partial",
      title: "Supply Chain Analyst",
      source: "logistics",
      skills: ["Inventory management", "Scheduling", "Forecasting", "Procurement"],
    })
    const weak = job({
      id: "weak",
      title: "Marketing Analyst",
      source: "retail",
      location: "Copenhagen, Denmark",
      remote: "remote",
      seniority: "senior",
      skills: ["Campaign analysis", "Market research"],
    })
    const unknown = job({
      id: "unknown",
      title: "Operations Coordinator",
      source: "administration",
      location: null,
      remote: null,
      employmentType: null,
      seniority: null,
      description: null,
      skills: [],
    })

    const result = analyzeJobs(candidate, [weak, partial, unknown, strong])
    const partialResult = result.rankedJobs.find((item) => item.job.id === "partial")
    const unknownResult = result.rankedJobs.find((item) => item.job.id === "unknown")
    const strongResult = result.rankedJobs.find((item) => item.job.id === "strong")

    expect(result.inputJobCount).toBe(4)
    expect(result.rankedJobs.map((item) => item.score)).toEqual([...result.rankedJobs.map((item) => item.score)].sort((a, b) => b - a))
    expect(partialResult?.matchingResult.missingDimensions).toContain("technicalSkills")
    expect(partialResult?.matchingResult.missing.find((item) => item.dimension === "technicalSkills")?.requirementCoverage?.coverageRatio).toBe(0.5)
    expect(partialResult?.scoringBreakdown.confidence).toBeGreaterThanOrEqual(0.8)
    expect(partialResult?.skillGapResult.gaps.map((gap) => gap.requirement?.identity.key)).toEqual(expect.arrayContaining(["skill:forecasting", "skill:procurement"]))
    expect(unknownResult?.matchingResult.unknownDimensions).toContain("technicalSkills")
    expect(unknownResult?.skillGapResult.gaps.filter((gap) => gap.type === "missing_skill")).toEqual([])
    expect(strongResult?.job).toMatchObject({ id: "strong", source: "test", sourceId: "strong-source", url: "https://example.test/strong", applyUrl: "https://example.test/strong/apply" })
    expect(result.learningPlan.prioritizedGaps.map((gap) => gap.canonicalKey)).toContain("skill:forecasting")
  })

  it("forwards existing ranking and learning-plan options without changing their semantics", () => {
    const candidate = operationsCandidate()
    const strong = job({ id: "strong", title: "Operations Coordinator" })
    const weak = job({ id: "weak", title: "Marketing Analyst", location: "Copenhagen, Denmark", remote: "remote", seniority: "senior", skills: ["Campaign analysis"] })

    const result = analyzeJobs(candidate, [strong, weak], { ranking: { minScore: 60 }, learningPlan: { maxGaps: 1 } })

    expect(result.rankedJobs.every((item) => item.score >= 60)).toBe(true)
    expect(result.learningPlan.prioritizedGaps.length).toBeLessThanOrEqual(1)
  })

  it("is deterministic, supports zero and one job, and does not mutate inputs", () => {
    const candidate = createDefaultCandidateProfile()
    const oneJob = job({ id: "one", title: "Platform Engineer", skills: ["TypeScript", "SQL"] })
    const candidateBefore = JSON.stringify(candidate)
    const jobsBefore = JSON.stringify([oneJob])

    const first = analyzeJobs(candidate, [oneJob])
    const second = analyzeJobs(candidate, [oneJob])
    const empty = analyzeJobs(candidate, [])

    expect(first).toEqual(second)
    expect(first.rankedJobs).toHaveLength(1)
    expect(empty).toMatchObject({ inputJobCount: 0, rankedJobs: [] })
    expect(empty.learningPlan.prioritizedGaps).toEqual([])
    expect(JSON.stringify(candidate)).toBe(candidateBefore)
    expect(JSON.stringify([oneJob])).toBe(jobsBefore)
  })

  it("composes offline with searchJobs while preserving successful-source provenance", async () => {
    const successful: JobSourceAdapter = {
      name: "fake-success",
      search: async () => ({ jobs: [job({ id: "searched", title: "Operations Coordinator", source: "fake-success" })], status: "ok", source: "fake-success" }),
    }
    const failing: JobSourceAdapter = {
      name: "fake-failure",
      search: async () => ({ jobs: [], status: "error", source: "fake-failure", error: "offline fixture failure" }),
    }

    const search = await searchJobs({ adapters: [successful, failing], includeSourceStatus: true })
    const result = analyzeJobs(operationsCandidate(), search.jobs)

    expect(search.sourceStatus).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "fake-success", status: "ok" }),
      expect.objectContaining({ source: "fake-failure", status: "error" }),
    ]))
    expect(result.rankedJobs).toHaveLength(1)
    expect(result.rankedJobs[0].job).toMatchObject({ id: "searched", source: "fake-success", sourceId: "searched-source" })
  })
})
