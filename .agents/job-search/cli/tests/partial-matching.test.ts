import { describe, expect, it } from "bun:test"
import {
  analyzeSkillGaps,
  createDefaultCandidateProfile,
  describeScoreBreakdown,
  generateLearningPlan,
  matchProfile,
  normalizeJob,
  rankJobs,
  scoreMatch,
  type CandidateProfile,
  type RankingInput,
} from "../src/index"

const requirements = ["Python", "Docker", "Kubernetes", "Terraform"]
const coverageCases: Array<[number, "matched" | "missing", number, number, number]> = [
  [0, "missing", 0, -1, 4],
  [1, "missing", 0.25, -0.25, 3],
  [2, "missing", 0.5, 0.5, 2],
  [3, "missing", 0.75, 1.25, 1],
  [4, "matched", 1, 2, 0],
]

function candidateWithKnownRequirements(count: number): CandidateProfile {
  return {
    ...createDefaultCandidateProfile(),
    targetRoles: ["General Coordinator"],
    skills: {
      technical: requirements.slice(0, count),
      soft: [],
    },
  }
}

function jobWithRequirements(skills: string[] = requirements) {
  return normalizeJob({
    id: `requirements-${skills.length}`,
    source: "test",
    title: "General Coordinator",
    location: "Jönköping, Sweden",
    remote: "hybrid",
    employmentType: "full-time",
    seniority: "mid",
    category: "technology",
    skills,
    description: null,
  })
}

function analyzeCoverage(count: number) {
  const candidate = candidateWithKnownRequirements(count)
  const job = jobWithRequirements()
  const matching = matchProfile(candidate, job)
  const scoring = scoreMatch(matching)
  const gaps = analyzeSkillGaps(candidate, job, matching)
  const technical = matching.matched.concat(matching.missing).find((evidence) => evidence.dimension === "technicalSkills")
  const scoreDimension = scoring.breakdown.dimensions.find((dimension) => dimension.dimension === "technicalSkills")

  return { candidate, job, matching, scoring, gaps, technical, scoreDimension }
}

describe("partial technical requirement coverage", () => {
  it("scores a strong bilingual support profile positively while retaining one genuine gap", () => {
    const candidate = {
      ...createDefaultCandidateProfile(),
      targetRoles: ["IT-supporttekniker", "IT Coordinator"],
      locationPreferences: [],
      skills: { technical: ["AD", "Office 365", "Windows", "DNS"], soft: ["Kommunikation", "Problemlösning"] },
      workExperience: [{ title: "IT Support Technician", company: "Example", location: "Stockholm" }],
      languages: [{ name: "Svenska", level: "Flytande" }, { name: "Engelska", level: "Flytande" }],
    }
    const job = normalizeJob({
      id: "strong-support-aliases",
      source: "test",
      title: "Service Desk Technician",
      company: "Corp",
      location: "Stockholm",
      remote: "onsite",
      employmentType: "full-time",
      skills: ["Active Directory", "M365", "Windows", "Intune"],
      description: "Erfarenhet inom IT support krävs. Kommunikation och problemlösning är viktiga. Svenska och engelska krävs.",
    })
    const matching = matchProfile(candidate, job)
    const score = scoreMatch(matching)
    const gaps = analyzeSkillGaps(candidate, job, matching)
    expect(matching.matchedDimensions).toEqual(expect.arrayContaining(["targetRole", "location", "languages", "softSkills", "yearsOfExperience"]))
    expect(score.score).toBeGreaterThan(0)
    expect(gaps.gaps.filter((gap) => gap.type === "missing_skill").map((gap) => gap.jobRequirement)).toEqual(["Required: Intune"])
  })

  it.each(coverageCases)("represents %d of 4 known requirements deterministically", (count, status, ratio, points, missingCount) => {
    const result = analyzeCoverage(count)

    expect(result.technical?.status).toBe(status)
    expect(result.technical?.requirementCoverage?.coverageRatio).toBe(ratio)
    expect(result.technical?.requirementCoverage?.matchedRequirements).toHaveLength(count)
    expect(result.technical?.requirementCoverage?.missingRequirements).toHaveLength(missingCount)
    expect(result.scoreDimension?.pointsAchieved).toBe(points)
    expect(result.gaps.gaps.filter((gap) => gap.type === "missing_skill")).toHaveLength(missingCount)
  })

  it("keeps a partially satisfied known requirement dimension out of fully matched dimensions", () => {
    const { matching, technical } = analyzeCoverage(3)

    expect(matching.matchedDimensions).not.toContain("technicalSkills")
    expect(matching.missingDimensions).toContain("technicalSkills")
    expect(technical?.requirementCoverage?.missingRequirements).toEqual(["Terraform"])
  })

  it("keeps absent requirement data unknown and creates no technical skill gaps", () => {
    const candidate = candidateWithKnownRequirements(0)
    const job = jobWithRequirements([])
    const matching = matchProfile(candidate, job)
    const gaps = analyzeSkillGaps(candidate, job, matching)

    expect(matching.unknownDimensions).toContain("technicalSkills")
    expect(gaps.gaps.filter((gap) => gap.type === "missing_skill")).toEqual([])
  })

  it("keeps known partial coverage separate from unrelated unknown dimensions and confidence", () => {
    const { matching, scoring, technical } = analyzeCoverage(3)

    expect(matching.unknownDimensions).toContain("softSkills")
    expect(technical?.requirementCoverage?.coverageRatio).toBe(0.75)
    expect(scoring.confidence).toBe(0.8)
    expect(scoring.confidenceLabel).toBe("high")
    expect(scoring.breakdown.dimensions.find((dimension) => dimension.dimension === "technicalSkills")?.requirementCoverage?.coverageRatio).toBe(0.75)
    expect(describeScoreBreakdown(scoring)).toContain("Requirements: 3/4 satisfied; 1 missing")
  })

  it("ranks by the proportional match score while preserving deterministic learning plans", () => {
    const partial = analyzeCoverage(3)
    const complete = analyzeCoverage(4)
    const inputs: RankingInput[] = [partial, complete].map(({ job, matching, scoring, gaps }) => ({
      job,
      matchingResult: matching,
      scoringResult: scoring,
      skillGapResult: gaps,
    }))
    const ranked = rankJobs(inputs, partial.candidate)
    const firstPlan = generateLearningPlan(ranked, partial.candidate)
    const secondPlan = generateLearningPlan(ranked, partial.candidate)

    expect(ranked.map((item) => item.score)).toEqual([...ranked.map((item) => item.score)].sort((a, b) => b - a))
    expect(ranked[0].matchingResult.matchedDimensions).toContain("technicalSkills")
    expect(firstPlan).toEqual(secondPlan)
    expect(firstPlan.prioritizedGaps.map((gap) => gap.skill)).toContain("Terraform")
  })
})
