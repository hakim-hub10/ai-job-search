import { describe, expect, it } from "bun:test"
import {
  analyzeSkillGaps,
  generateLearningPlan,
  matchProfile,
  normalizeCandidateProfile,
  normalizeJob,
  rankJobs,
  scoreMatch,
  type RankingInput,
} from "../src/index"

describe("Phase 1–2.6 offline integration", () => {
  it("flows normalized jobs through matching, scoring, gaps, ranking, and a deterministic learning plan", () => {
    const candidate = normalizeCandidateProfile({
      headline: "Operations coordinator",
      targetRoles: ["Operations Coordinator", "Supply Chain Analyst"],
      locationPreferences: ["Aarhus, Denmark"],
      workMode: "onsite",
      remotePreference: false,
      preferredEmploymentType: ["full-time"],
      skills: {
        technical: ["Inventory management", "Scheduling", "Safety procedures"],
        soft: ["Communication", "Collaboration"],
      },
      yearsOfExperience: 3,
    })

    const jobs = [
      normalizeJob({
        id: "strong",
        source: "test",
        sourceId: "strong-source-id",
        title: "Operations Coordinator",
        company: "Warehouse One",
        location: "Aarhus, Denmark",
        url: "https://example.test/strong",
        remote: "onsite",
        employmentType: "full-time",
        seniority: "mid",
        skills: ["Inventory management", "Scheduling", "Safety procedures"],
        description: "Communication and collaboration are important.",
      }),
      normalizeJob({
        id: "medium",
        source: "test",
        sourceId: "medium-source-id",
        title: "Supply Chain Analyst",
        company: "Logistics Two",
        location: "Aarhus, Denmark",
        url: "https://example.test/medium",
        remote: "onsite",
        employmentType: "full-time",
        seniority: "mid",
        skills: ["Inventory management", "Forecasting", "Procurement"],
        description: "Communication and collaboration are important.",
      }),
      normalizeJob({
        id: "weak",
        source: "test",
        sourceId: "weak-source-id",
        title: "Marketing Analyst",
        company: "Retail Three",
        location: "Copenhagen, Denmark",
        url: "https://example.test/weak",
        remote: "remote",
        employmentType: "full-time",
        seniority: "senior",
        skills: ["Campaign analysis", "Market research"],
        description: "Leadership and communication are required.",
      }),
      normalizeJob({
        id: "unknown",
        source: "test",
        sourceId: "unknown-source-id",
        title: "Operations Coordinator",
        company: "Administration Four",
        location: null,
        url: "https://example.test/unknown",
        remote: null,
        employmentType: null,
        seniority: null,
        skills: [],
        description: null,
      }),
    ]

    const inputs: RankingInput[] = jobs.map((job) => {
      const matching = matchProfile(candidate, job)
      return {
        job,
        matchingResult: matching,
        scoringResult: scoreMatch(matching),
        skillGapResult: analyzeSkillGaps(candidate, job, matching),
      }
    })

    const ranked = rankJobs(inputs, candidate)
    const repeatedRanked = rankJobs(inputs, candidate)
    const learningPlan = generateLearningPlan(ranked, candidate)
    const repeatedLearningPlan = generateLearningPlan(repeatedRanked, candidate)

    expect(inputs.every((input) => input.scoringResult.score >= 0 && input.scoringResult.score <= 100)).toBe(true)
    expect(inputs.find((input) => input.job.id === "medium")?.matchingResult.missingDimensions).toContain("technicalSkills")
    expect(inputs.find((input) => input.job.id === "medium")?.skillGapResult.gaps.map((gap) => gap.jobRequirement)).toContain("Required: Forecasting")
    expect(inputs.find((input) => input.job.id === "unknown")?.matchingResult.unknownDimensions).toContain("technicalSkills")
    expect(inputs.find((input) => input.job.id === "unknown")?.skillGapResult.gaps).toEqual([])
    expect(ranked.map((item) => item.job.id)).toEqual(repeatedRanked.map((item) => item.job.id))
    expect(ranked.find((item) => item.job.id === "strong")?.job.url).toBe("https://example.test/strong")
    expect(ranked.find((item) => item.job.id === "strong")?.job.sourceId).toBe("strong-source-id")
    expect(learningPlan.prioritizedGaps.map((gap) => gap.skill)).toContain("Forecasting")
    expect(learningPlan).toEqual(repeatedLearningPlan)
  })
})
