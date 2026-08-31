import { describe, expect, it } from "bun:test"
import {
  analyzeSkillGaps,
  createDefaultCandidateProfile,
  generateLearningPlan,
  matchProfile,
  normalizeJob,
  rankJobs,
  scoreMatch,
  type MatchDimension,
  type MatchEvidence,
  type MatchingResult,
  type RankingInput,
  type SkillGapResult,
} from "../src/index"

const dimensions: MatchDimension[] = [
  "targetRole",
  "technicalSkills",
  "yearsOfExperience",
  "location",
  "remotePreference",
  "employmentType",
  "softSkills",
  "languages",
  "certifications",
  "preferredIndustries",
]

function createMatchingResult(
  jobId: string,
  statuses: Partial<Record<MatchDimension, MatchEvidence["status"]>>
): MatchingResult {
  const evidence = dimensions.map((dimension): MatchEvidence => ({
    dimension,
    status: statuses[dimension] ?? "unknown",
    detail: `${dimension} evidence`,
  }))
  const byStatus = (status: MatchEvidence["status"]) => evidence.filter((item) => item.status === status)

  return {
    jobId,
    jobTitle: `Role ${jobId}`,
    candidateHeadline: "Test candidate",
    matched: byStatus("matched"),
    missing: byStatus("missing"),
    conflicting: byStatus("conflicting"),
    unknown: byStatus("unknown"),
    totalMatched: byStatus("matched").length,
    totalMissing: byStatus("missing").length,
    totalConflicting: byStatus("conflicting").length,
    totalUnknown: byStatus("unknown").length,
    matchedDimensions: byStatus("matched").map((item) => item.dimension),
    missingDimensions: byStatus("missing").map((item) => item.dimension),
    conflictingDimensions: byStatus("conflicting").map((item) => item.dimension),
    unknownDimensions: byStatus("unknown").map((item) => item.dimension),
  }
}

function createSkillGapResult(jobId: string): SkillGapResult {
  return {
    jobId,
    jobTitle: `Role ${jobId}`,
    candidateHeadline: "Test candidate",
    gaps: [],
    strengths: [],
    unknowns: [],
    recommendations: [],
    totalGaps: 0,
    criticalGaps: 0,
    highGaps: 0,
    summary: "No gaps",
  }
}

function createRankingInput(
  jobId: string,
  statuses: Partial<Record<MatchDimension, MatchEvidence["status"]>>
): RankingInput {
  const matchingResult = createMatchingResult(jobId, statuses)
  return {
    job: normalizeJob({ id: jobId, source: "test", title: `Role ${jobId}` }),
    matchingResult,
    scoringResult: scoreMatch(matchingResult),
    skillGapResult: createSkillGapResult(jobId),
  }
}

describe("confidence policy", () => {
  const allMatched = Object.fromEntries(dimensions.map((dimension) => [dimension, "matched"])) as Record<
    MatchDimension,
    MatchEvidence["status"]
  >

  it("reports a high score with high confidence when all dimensions are known", () => {
    const result = scoreMatch(createMatchingResult("high-evidence", allMatched))

    expect(result.score).toBe(100)
    expect(result.confidence).toBe(1)
    expect(result.confidenceLabel).toBe("high")
    expect(result.summary).toContain("Evidence coverage: 100% (high)")
  })

  it("reports a high score with low confidence when only limited evidence is known", () => {
    const result = scoreMatch(createMatchingResult("low-evidence", { targetRole: "matched" }))

    expect(result.score).toBe(100)
    expect(result.confidence).toBeCloseTo(0.16, 10)
    expect(result.confidenceLabel).toBe("low")
  })

  it("reports a medium score with high confidence when all dimensions are evaluated", () => {
    const result = scoreMatch(createMatchingResult("medium-score", { ...allMatched, technicalSkills: "missing" }))

    expect(result.score).toBe(76)
    expect(result.confidence).toBe(1)
    expect(result.confidenceLabel).toBe("high")
  })

  it("keeps mostly or entirely unknown information out of both score penalties and confidence", () => {
    const result = scoreMatch(createMatchingResult("unknown", {}))

    expect(result.score).toBe(0)
    expect(result.confidence).toBe(0)
    expect(result.confidenceLabel).toBe("low")
    expect(result.missing).toEqual([])
    expect(result.breakdown.unknownDimensions).toBe(dimensions.length)
  })

  it("calculates confidence deterministically", () => {
    const matching = createMatchingResult("repeatable", { targetRole: "matched", location: "conflicting" })

    expect(scoreMatch(matching)).toEqual(scoreMatch(matching))
  })

  it("does not convert unknown job information into missing matching evidence or skill gaps", () => {
    const candidate = createDefaultCandidateProfile()
    const job = normalizeJob({
      id: "unknown-job-data",
      source: "test",
      title: "Platform Engineer",
      skills: [],
      description: null,
    })
    const matching = matchProfile(candidate, job)
    const gaps = analyzeSkillGaps(candidate, job, matching)

    expect(matching.unknownDimensions).toContain("technicalSkills")
    expect(matching.missingDimensions).not.toContain("technicalSkills")
    expect(gaps.gaps.filter((gap) => gap.type === "missing_skill")).toEqual([])
  })

  it("uses confidence as the first tie-breaker for equal match scores", () => {
    const candidate = createDefaultCandidateProfile()
    const lowConfidence = createRankingInput("low-confidence", { targetRole: "matched" })
    const highConfidence = createRankingInput("high-confidence", allMatched)

    const ranked = rankJobs([lowConfidence, highConfidence], candidate)

    expect(ranked.map((job) => job.job.id)).toEqual(["high-confidence", "low-confidence"])
    expect(ranked[0].explanation).toContain("Evidence coverage 100% (high)")
  })

  it("continues to rank different match scores by score before confidence", () => {
    const candidate = createDefaultCandidateProfile()
    const highScoreLowConfidence = createRankingInput("high-score", { targetRole: "matched" })
    const lowerScoreHighConfidence = createRankingInput("lower-score", { ...allMatched, technicalSkills: "missing" })

    const ranked = rankJobs([lowerScoreHighConfidence, highScoreLowConfidence], candidate)

    expect(ranked.map((job) => job.job.id)).toEqual(["high-score", "lower-score"])
  })

  it("does not use confidence in learning-plan prioritization", () => {
    const candidate = createDefaultCandidateProfile()
    const input = createRankingInput("learning-plan", allMatched)
    input.skillGapResult = {
      ...input.skillGapResult,
      gaps: [
        {
          type: "missing_skill",
          title: "Missing: Inventory planning",
          description: "Candidate lacks inventory planning",
          jobRequirement: "Required: Inventory planning",
          severity: "medium",
          evidence: "Job explicitly lists inventory planning",
        },
      ],
      totalGaps: 1,
    }
    const ranked = rankJobs([input], candidate)
    const lowerConfidenceRanked = ranked.map((job) => ({
      ...job,
      scoringBreakdown: { ...job.scoringBreakdown, confidence: 0, confidenceLabel: "low" as const },
    }))

    expect(generateLearningPlan(ranked, candidate)).toEqual(generateLearningPlan(lowerConfidenceRanked, candidate))
  })
})
