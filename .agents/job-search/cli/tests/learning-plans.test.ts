import { describe, expect, it } from "bun:test"
import {
  analyzeSkillGaps,
  createDefaultCandidateProfile,
  generateLearningPlan,
  matchProfile,
  normalizeCandidateProfile,
  normalizeJob,
  rankJobs,
  scoreMatch,
  type RankedJob,
  type SkillGap,
  type SkillGapResult,
  type SkillUnknown,
} from "../src/index"

const candidate = createDefaultCandidateProfile()

function gap(overrides: Partial<SkillGap> = {}): SkillGap {
  return {
    type: "missing_skill",
    title: "Display-only title",
    description: "Known gap from an upstream result",
    jobRequirement: "Required: Planning",
    severity: "medium",
    evidence: "Upstream evidence",
    ...overrides,
  }
}

function rankedJob(
  id: string,
  rank: number,
  score: number,
  gaps: SkillGap[],
  unknowns: SkillUnknown[] = [],
): RankedJob {
  const job = normalizeJob({ id, source: "test", title: `Role ${id}`, company: `Company ${id}` })
  const matching = matchProfile(candidate, job)
  const scoring = scoreMatch(matching)
  const skillGapResult: SkillGapResult = {
    jobId: id,
    jobTitle: job.title,
    candidateHeadline: candidate.headline,
    gaps,
    strengths: [],
    unknowns,
    recommendations: [],
    totalGaps: gaps.length,
    criticalGaps: gaps.filter((item) => item.severity === "critical").length,
    highGaps: gaps.filter((item) => item.severity === "high").length,
    summary: "",
  }
  return { rank, job, score, matchingResult: matching, scoringBreakdown: scoring, skillGapResult, explanation: "" }
}

describe("learning-plan engine", () => {
  it("prioritizes severity before otherwise comparable gaps", () => {
    const plan = generateLearningPlan([
      rankedJob("one", 1, 80, [gap({ jobRequirement: "Preferred: Mentoring", severity: "critical" })]),
      rankedJob("two", 1, 80, [gap({ jobRequirement: "Required: Documentation", severity: "high" })]),
    ], candidate)

    expect(plan.prioritizedGaps.map((item) => item.skill)).toEqual(["Mentoring", "Documentation"])
  })

  it("uses explicit required versus useful importance when upstream data provides it", () => {
    const plan = generateLearningPlan([
      rankedJob("one", 1, 80, [
        gap({ jobRequirement: "Preferred: Stakeholder management" }),
        gap({ jobRequirement: "Required: Compliance reporting" }),
      ]),
    ], candidate)

    expect(plan.prioritizedGaps.map((item) => item.skill)).toEqual(["Compliance reporting", "Stakeholder management"])
    expect(plan.prioritizedGaps[0].importance).toBe("required")
    expect(plan.prioritizedGaps[1].importance).toBe("useful")
  })

  it("raises the priority of a gap occurring across multiple target jobs", () => {
    const plan = generateLearningPlan([
      rankedJob("one", 1, 80, [gap({ jobRequirement: "Required: Supply planning" })]),
      rankedJob("two", 2, 80, [gap({ jobRequirement: "Required: Supply planning" })]),
      rankedJob("three", 3, 80, [gap({ jobRequirement: "Required: Patient intake" })]),
    ], candidate)

    expect(plan.prioritizedGaps[0].skill).toBe("Supply planning")
    expect(plan.prioritizedGaps[0].frequencyScore).toBe(67)
    expect(plan.prioritizedGaps[0].relatedJobs).toHaveLength(2)
  })

  it("uses ranked-job context while preserving multiple target-job relationships", () => {
    const plan = generateLearningPlan([
      rankedJob("health", 1, 90, [gap({ jobRequirement: "Required: Clinical coordination", severity: "high" })]),
      rankedJob("logistics", 2, 70, [gap({ jobRequirement: "Required: Inventory control", severity: "high" })]),
    ], candidate)

    expect(plan.prioritizedGaps.map((item) => item.skill)).toEqual(["Clinical coordination", "Inventory control"])
    expect(plan.prioritizedGaps[0].impactScore).toBeGreaterThan(plan.prioritizedGaps[1].impactScore)
  })

  it("excludes skills already confirmed in the candidate profile", () => {
    const profile = normalizeCandidateProfile({ skills: { technical: ["Spreadsheet analysis"], soft: ["Communication"] } })
    const plan = generateLearningPlan([
      rankedJob("one", 1, 80, [gap({ jobRequirement: "Required: Spreadsheet analysis" })]),
    ], profile)

    expect(plan.totalGaps).toBe(0)
  })

  it("does not turn unknown data into a learning gap", () => {
    const plan = generateLearningPlan([
      rankedJob("one", 1, 80, [], [{ dimension: "technicalSkills", reason: "Job does not list skills" }]),
    ], candidate)

    expect(plan.prioritizedGaps).toEqual([])
    expect(plan.summary).toContain("No confirmed")
  })

  it("is deterministic and has no generated timestamp", () => {
    const jobs = [
      rankedJob("one", 1, 80, [gap({ jobRequirement: "Required: Records management" })]),
      rankedJob("two", 2, 70, [gap({ jobRequirement: "Required: Records management" })]),
    ]
    const first = generateLearningPlan(jobs, candidate)
    const second = generateLearningPlan(jobs, candidate)

    expect(first).toEqual(second)
    expect("createdAt" in first).toBe(false)
  })

  it("uses canonical requirement ordering as a stable tie-breaker", () => {
    const plan = generateLearningPlan([
      rankedJob("one", 1, 80, [
        gap({ jobRequirement: "Required: Zebra coordination" }),
        gap({ jobRequirement: "Required: Archive management" }),
      ]),
    ], candidate)

    expect(plan.prioritizedGaps.map((item) => item.skill)).toEqual(["Archive management", "Zebra coordination"])
  })

  it("handles empty ranked jobs and empty gap lists", () => {
    expect(generateLearningPlan([], candidate).prioritizedGaps).toEqual([])
    expect(generateLearningPlan([rankedJob("one", 1, 80, [])], candidate).totalGaps).toBe(0)
  })

  it("remains compatible with the existing ranking pipeline without mutating it", () => {
    const job = normalizeJob({
      id: "pipeline-job",
      source: "test",
      title: "Operations coordinator",
      skills: ["Scheduling"],
      description: "Scheduling experience required.",
    })
    const matching = matchProfile(candidate, job)
    const input = { job, matchingResult: matching, scoringResult: scoreMatch(matching), skillGapResult: analyzeSkillGaps(candidate, job, matching) }
    const ranked = rankJobs([input], candidate)
    const before = JSON.stringify(ranked)

    const plan = generateLearningPlan(ranked, candidate)

    expect(plan.targetJobCount).toBe(1)
    expect(JSON.stringify(ranked)).toBe(before)
  })
})
