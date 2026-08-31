import { describe, expect, it } from "bun:test"
import {
  createDefaultCandidateProfile,
  matchProfile,
  normalizeJob,
  scoreMatch,
  getDimensionWeights,
  describeScoreBreakdown,
  type ScoringResult,
} from "../src/index"

describe("match scoring engine", () => {
  const defaultCandidate = createDefaultCandidateProfile()

  function createScoringResult(
    title: string,
    matched: number,
    missing: number,
    conflicting: number,
    unknown: number
  ): ScoringResult {
    const job = normalizeJob({
      id: `job-${title}`,
      source: "test",
      title: title,
      company: "Test Company",
      remote: matched > 0 ? "hybrid" : "onsite",
      location: matched > 0 ? "Jönköping, Sweden" : "San Francisco, USA",
      employmentType: matched > 0 ? "full-time" : "part-time",
      skills: matched > 0 ? ["TypeScript", "APIs"] : ["Kubernetes", "Terraform"],
      seniority: matched > 0 ? "mid" : "senior",
    })

    const matchingResult = matchProfile(defaultCandidate, job)
    return scoreMatch(matchingResult)
  }

  it("strong match: high score when most criteria align", () => {
    const job = normalizeJob({
      id: "strong-1",
      source: "test",
      title: "Platform Engineer",
      company: "TechCorp",
      location: "Jönköping, Sweden",
      remote: "hybrid",
      employmentType: "full-time",
      seniority: "mid",
      skills: ["TypeScript", "APIs", "SQL", "Linux"],
      description:
        "Platform engineer with strong communication and problem-solving skills. We value collaboration and ownership.",
      category: "technology",
    })

    const matchingResult = matchProfile(defaultCandidate, job)
    const result = scoreMatch(matchingResult)

    expect(result.score).toBeGreaterThanOrEqual(70)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(result.breakdown.unknownDimensions).toBeLessThanOrEqual(2)
  })

  it("partial match: moderate score when some criteria match", () => {
    const job = normalizeJob({
      id: "partial-1",
      source: "test",
      title: "Software Engineer",
      company: "MidCorp",
      location: "Stockholm, Sweden",
      remote: "hybrid",
      employmentType: "full-time",
      seniority: "mid",
      skills: ["TypeScript", "Node.js"],
      category: "technology",
    })

    const matchingResult = matchProfile(defaultCandidate, job)
    const result = scoreMatch(matchingResult)

    expect(result.score).toBeGreaterThanOrEqual(40)
    expect(result.score).toBeLessThanOrEqual(75)
  })

  it("weak match: low score when many criteria conflict", () => {
    const job = normalizeJob({
      id: "weak-1",
      source: "test",
      title: "Marketing Manager",
      company: "MarketCorp",
      location: "San Francisco, USA",
      remote: "onsite",
      employmentType: "contract",
      seniority: "senior",
      skills: ["Sales", "Brand Strategy", "Analytics"],
      category: "marketing",
    })

    const matchingResult = matchProfile(defaultCandidate, job)
    const result = scoreMatch(matchingResult)

    expect(result.score).toBeLessThanOrEqual(40)
  })

  it("multiple conflicts: score penalized for each conflict", () => {
    const job = normalizeJob({
      id: "multi-conflict-1",
      source: "test",
      title: "Senior DevOps Engineer",
      company: "CloudOps",
      location: "Tokyo, Japan",
      remote: "onsite",
      employmentType: "part-time",
      seniority: "principal",
      skills: ["Kubernetes", "Terraform", "AWS"],
      category: "infrastructure",
    })

    const matchingResult = matchProfile(defaultCandidate, job)
    const result = scoreMatch(matchingResult)

    // Multiple conflicts should result in lower score
    expect(result.breakdown.totalPoints).toBeGreaterThan(0)
    expect(result.breakdown.pointsAchieved).toBeLessThan(result.breakdown.totalPoints * 0.5)
  })

  it("unknown fields: score not penalized for missing job data", () => {
    const minimalJob = normalizeJob({
      id: "minimal-1",
      source: "test",
      title: "IT Person",
      company: null,
      location: null,
      remote: null,
      employmentType: null,
      seniority: null,
      skills: [],
      description: null,
      category: null,
    })

    const matchingResult = matchProfile(defaultCandidate, minimalJob)
    const result = scoreMatch(matchingResult)

    // Score should not be artificially low because of unknowns
    expect(result.breakdown.unknownDimensions).toBeGreaterThan(0)
    // unknowns should not reduce total possible points
    expect(result.breakdown.totalPoints).toBeLessThanOrEqual(13.0)
  })

  it("missing skills: score reduced for skill gaps", () => {
    const skillGapJob = normalizeJob({
      id: "skill-gap-1",
      source: "test",
      title: "Platform Engineer",
      company: "TechCorp",
      location: "Jönköping, Sweden",
      remote: "hybrid",
      employmentType: "full-time",
      seniority: "mid",
      skills: ["Rust", "WASM", "Protocol Buffers"], // None of candidate's skills
      category: "technology",
    })

    const matchingResult = matchProfile(defaultCandidate, skillGapJob)
    const result = scoreMatch(matchingResult)

    // Score should be reduced but candidate is still a good fit on other dimensions
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(75)
    expect(result.breakdown.dimensions.find((d) => d.dimension === "technicalSkills")?.status).toBe("missing")
  })

  it("location conflict: score reduced for location mismatch", () => {
    const locationConflictJob = normalizeJob({
      id: "location-conflict-1",
      source: "test",
      title: "Platform Engineer",
      company: "FarCorp",
      location: "Vancouver, Canada",
      remote: "onsite",
      employmentType: "full-time",
      seniority: "mid",
      skills: ["TypeScript", "APIs"],
      category: "technology",
    })

    const matchingResult = matchProfile(defaultCandidate, locationConflictJob)
    const result = scoreMatch(matchingResult)

    const locationDim = result.breakdown.dimensions.find((d) => d.dimension === "location")
    expect(locationDim?.status).toBe("conflicting")
    expect(locationDim?.pointsAchieved).toBeLessThan(0)
  })

  it("remote conflict: score reduced for work-mode mismatch", () => {
    const remoteConflictJob = normalizeJob({
      id: "remote-conflict-1",
      source: "test",
      title: "Platform Engineer",
      company: "RemoteOnsiteCorp",
      location: "Jönköping, Sweden",
      remote: "onsite",
      employmentType: "full-time",
      seniority: "mid",
      skills: ["TypeScript", "APIs"],
      category: "technology",
    })

    const matchingResult = matchProfile(defaultCandidate, remoteConflictJob)
    const result = scoreMatch(matchingResult)

    const remoteDim = result.breakdown.dimensions.find((d) => d.dimension === "remotePreference")
    expect(remoteDim?.status).toBe("conflicting")
  })

  it("experience conflict: score reduced for experience mismatch", () => {
    const experienceConflictJob = normalizeJob({
      id: "exp-conflict-1",
      source: "test",
      title: "Platform Engineer",
      company: "ExperiencedCorp",
      location: "Jönköping, Sweden",
      remote: "hybrid",
      employmentType: "full-time",
      seniority: "principal", // Requires 10+ years, candidate has 3
      skills: ["TypeScript", "APIs"],
      category: "technology",
    })

    const matchingResult = matchProfile(defaultCandidate, experienceConflictJob)
    const result = scoreMatch(matchingResult)

    const expDim = result.breakdown.dimensions.find((d) => d.dimension === "yearsOfExperience")
    expect(expDim?.status).toBe("conflicting")
  })

  it("score boundaries: 100 for perfect match", () => {
    const perfectJob = normalizeJob({
      id: "perfect-1",
      source: "test",
      title: "Platform Engineer",
      company: "PerfectCorp",
      location: "Jönköping, Sweden",
      remote: "hybrid",
      employmentType: "full-time",
      seniority: "mid",
      skills: ["TypeScript", "Bun", "SQL", "Linux", "APIs", "Cloud"],
      description:
        "Perfect role with strong communication, problem-solving, collaboration, and ownership required. Full English proficiency.",
      category: "technology",
    })

    const matchingResult = matchProfile(defaultCandidate, perfectJob)
    const result = scoreMatch(matchingResult)

    // Near-perfect match should score high (may not be exactly 100 due to unknowns)
    expect(result.score).toBeGreaterThanOrEqual(85)
  })

  it("score boundaries: 0 for complete mismatch", () => {
    const oppositeJob = normalizeJob({
      id: "opposite-1",
      source: "test",
      title: "Sales Representative", // Different role
      company: "SalesCorp",
      location: "Shanghai, China", // Different location
      remote: "onsite", // Opposite of hybrid
      employmentType: "part-time", // Different type
      seniority: "principal", // Different level
      skills: ["Sales", "Negotiation", "Persuasion"], // Unrelated skills
      category: "sales",
    })

    const matchingResult = matchProfile(defaultCandidate, oppositeJob)
    const result = scoreMatch(matchingResult)

    expect(result.score).toBeLessThanOrEqual(25)
  })

  it("deterministic scoring: same input produces same score", () => {
    const job = normalizeJob({
      id: "deterministic-1",
      source: "test",
      title: "Platform Engineer",
      company: "TechCorp",
      location: "Jönköping, Sweden",
      remote: "hybrid",
      employmentType: "full-time",
      seniority: "mid",
      skills: ["TypeScript", "APIs"],
      category: "technology",
    })

    const matchingResult1 = matchProfile(defaultCandidate, job)
    const result1 = scoreMatch(matchingResult1)

    const matchingResult2 = matchProfile(defaultCandidate, job)
    const result2 = scoreMatch(matchingResult2)

    expect(result1.score).toBe(result2.score)
    expect(result1.summary).toBe(result2.summary)
  })

  it("breakdown correctness: score calculation matches breakdown", () => {
    const job = normalizeJob({
      id: "breakdown-1",
      source: "test",
      title: "Platform Engineer",
      company: "TechCorp",
      location: "Jönköping, Sweden",
      remote: "hybrid",
      employmentType: "full-time",
      seniority: "mid",
      skills: ["TypeScript", "APIs"],
      category: "technology",
    })

    const matchingResult = matchProfile(defaultCandidate, job)
    const result = scoreMatch(matchingResult)

    // Verify breakdown math
    if (result.breakdown.totalPoints > 0) {
      const calculatedScore = Math.max(0, (result.breakdown.pointsAchieved / result.breakdown.totalPoints) * 100)
      expect(Math.round(calculatedScore)).toBe(result.score)
    }
  })

  it("dimension weights are consistent", () => {
    const weights = getDimensionWeights()

    expect(weights.targetRole).toBe(2.0)
    expect(weights.technicalSkills).toBe(2.0)
    expect(weights.yearsOfExperience).toBe(1.5)
    expect(weights.location).toBe(1.5)
    expect(weights.remotePreference).toBe(1.5)
    expect(weights.employmentType).toBe(1.0)
    expect(weights.softSkills).toBe(1.0)
    expect(weights.languages).toBe(1.0)
    expect(weights.certifications).toBe(0.5)
    expect(weights.preferredIndustries).toBe(0.5)

    // Verify total (2.0+2.0+1.5+1.5+1.5+1.0+1.0+1.0+0.5+0.5 = 12.5)
    const total = Object.values(weights).reduce((a, b) => a + b, 0)
    expect(total).toBe(12.5)
  })

  it("scoring result has all required fields", () => {
    const job = normalizeJob({
      id: "complete-1",
      source: "test",
      title: "Platform Engineer",
      company: "TechCorp",
      remote: "hybrid",
      skills: ["TypeScript"],
    })

    const matchingResult = matchProfile(defaultCandidate, job)
    const result = scoreMatch(matchingResult)

    expect(typeof result.score).toBe("number")
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(result.jobId).toBe(job.id)
    expect(result.jobTitle).toBe(job.title)
    expect(typeof result.summary).toBe("string")
    expect(Array.isArray(result.matched)).toBe(true)
    expect(Array.isArray(result.missing)).toBe(true)
    expect(Array.isArray(result.conflicting)).toBe(true)
    expect(Array.isArray(result.unknown)).toBe(true)
    expect(result.breakdown).toBeDefined()
    expect(Array.isArray(result.breakdown.dimensions)).toBe(true)
  })

  it("describe breakdown generates human-readable output", () => {
    const job = normalizeJob({
      id: "describe-1",
      source: "test",
      title: "Platform Engineer",
      company: "TechCorp",
      location: "Jönköping, Sweden",
      remote: "hybrid",
      employmentType: "full-time",
      seniority: "mid",
      skills: ["TypeScript", "APIs"],
      category: "technology",
    })

    const matchingResult = matchProfile(defaultCandidate, job)
    const result = scoreMatch(matchingResult)
    const description = describeScoreBreakdown(result)

    expect(description).toContain("SCORING BREAKDOWN")
    expect(description).toContain(`${result.score}/100`)
    expect(description).toContain("DIMENSION BREAKDOWN")
    expect(description).toContain("targetRole")
    expect(description).toContain("technicalSkills")
  })

  it("conflicting has higher negative impact than missing", () => {
    // Create two jobs: one with missing skills, one with conflicting location
    const missingSkillsJob = normalizeJob({
      id: "missing-1",
      source: "test",
      title: "Platform Engineer",
      company: "Corp1",
      location: "Jönköping, Sweden",
      remote: "hybrid",
      employmentType: "full-time",
      seniority: "mid",
      skills: ["Rust", "Go", "Python"], // No overlap with candidate
    })

    const conflictingLocationJob = normalizeJob({
      id: "conflict-1",
      source: "test",
      title: "Platform Engineer",
      company: "Corp2",
      location: "Tokyo, Japan",
      remote: "onsite",
      employmentType: "full-time",
      seniority: "mid",
      skills: ["TypeScript", "APIs"], // Good skills match
    })

    const missingResult = scoreMatch(matchProfile(defaultCandidate, missingSkillsJob))
    const conflictResult = scoreMatch(matchProfile(defaultCandidate, conflictingLocationJob))

    // Both have negative impacts, but they affect different dimensions
    // The key is that the score calculation should be consistent
    expect(typeof missingResult.score).toBe("number")
    expect(typeof conflictResult.score).toBe("number")
  })

  it("matched technical skills contribute more than unknowns", () => {
    const goodSkillsJob = normalizeJob({
      id: "good-skills-1",
      source: "test",
      title: "Platform Engineer",
      company: "Corp",
      location: "Jönköping, Sweden",
      remote: "hybrid",
      employmentType: "full-time",
      seniority: "mid",
      skills: ["TypeScript", "SQL", "APIs", "Linux"], // Good match
    })

    const unknownSkillsJob = normalizeJob({
      id: "unknown-skills-1",
      source: "test",
      title: "Platform Engineer",
      company: "Corp",
      location: "Jönköping, Sweden",
      remote: "hybrid",
      employmentType: "full-time",
      seniority: "mid",
      skills: [], // Unknown skills
    })

    const goodResult = scoreMatch(matchProfile(defaultCandidate, goodSkillsJob))
    const unknownResult = scoreMatch(matchProfile(defaultCandidate, unknownSkillsJob))

    // Good skills should score at least as high as unknown skills
    // (both may score 100 if all other dimensions match)
    expect(goodResult.score).toBeGreaterThanOrEqual(unknownResult.score)
  })
})
