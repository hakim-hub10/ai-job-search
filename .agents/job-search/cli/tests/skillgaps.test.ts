import { describe, expect, it } from "bun:test"
import {
  createDefaultCandidateProfile,
  normalizeCandidateProfile,
  normalizeJob,
  matchProfile,
  analyzeSkillGaps,
  type SkillGapResult,
} from "../src/index"

describe("skill-gap analysis engine", () => {
  const defaultCandidate = createDefaultCandidateProfile()

  it("no skill gaps: candidate matches all job requirements", () => {
    const job = normalizeJob({
      id: "perfect-1",
      source: "test",
      title: "Platform Engineer",
      company: "TechCorp",
      location: "Jönköping, Sweden",
      remote: "hybrid",
      employmentType: "full-time",
      seniority: "mid",
      skills: ["TypeScript", "SQL", "APIs"], // All candidate has
      description:
        "We need strong communication and problem-solving skills. Bachelor's degree in Computer Science.",
      category: "technology",
    })

    const matching = matchProfile(defaultCandidate, job)
    const result = analyzeSkillGaps(defaultCandidate, job, matching)

    expect(result.totalGaps).toBe(0)
    expect(result.strengths.length).toBeGreaterThan(0)
    expect(result.summary).toContain("No skill gaps")
  })

  it("one missing technical skill: identifies single skill gap", () => {
    const job = normalizeJob({
      id: "one-gap-1",
      source: "test",
      title: "Platform Engineer",
      company: "TechCorp",
      remote: "hybrid",
      employmentType: "full-time",
      seniority: "mid",
      skills: ["TypeScript", "Kubernetes", "SQL"], // Kubernetes not in candidate
    })

    const matching = matchProfile(defaultCandidate, job)
    const result = analyzeSkillGaps(defaultCandidate, job, matching)

    const kubeGap = result.gaps.find((g) => g.title.includes("Kubernetes"))
    expect(kubeGap).toBeDefined()
    expect(kubeGap?.type).toBe("missing_skill")
    expect(kubeGap?.requirement?.identity).toMatchObject({ key: "skill:kubernetes", original: "Kubernetes" })
    expect(kubeGap?.requirement?.importance).toBe("required")
  })

  it("multiple missing technical skills: identifies all gaps", () => {
    const job = normalizeJob({
      id: "multi-gap-1",
      source: "test",
      title: "DevOps Engineer",
      company: "CloudCorp",
      remote: "hybrid",
      employmentType: "full-time",
      seniority: "mid",
      skills: ["Kubernetes", "Terraform", "AWS", "Docker", "Prometheus"], // None in candidate
    })

    const matching = matchProfile(defaultCandidate, job)
    const result = analyzeSkillGaps(defaultCandidate, job, matching)

    expect(result.totalGaps).toBeGreaterThanOrEqual(4)
    expect(result.gaps.filter((g) => g.type === "missing_skill").length).toBeGreaterThanOrEqual(4)
  })

  it("missing certification: identifies cert gap", () => {
    const job = normalizeJob({
      id: "cert-1",
      source: "test",
      title: "Platform Engineer",
      company: "TechCorp",
      remote: "hybrid",
      skills: ["TypeScript", "SQL"],
      description: "AWS certification required. Bachelor's or Master's degree in CS.",
    })

    const matching = matchProfile(defaultCandidate, job)
    const result = analyzeSkillGaps(defaultCandidate, job, matching)

    const certGap = result.gaps.find((g) => g.type === "missing_certification")
    expect(certGap).toBeDefined()
  })

  it("missing language: identifies language gap", () => {
    const job = normalizeJob({
      id: "lang-1",
      source: "test",
      title: "Swedish Developer",
      company: "SwedishCorp",
      remote: "hybrid",
      skills: ["TypeScript"],
      description: "Swedish language skills required for daily communication.",
    })

    const candidateWithoutSwedish = normalizeCandidateProfile({
      ...defaultCandidate,
      languages: [{ name: "English", level: "Native" }],
    })

    const matching = matchProfile(candidateWithoutSwedish, job)
    const result = analyzeSkillGaps(candidateWithoutSwedish, job, matching)

    const langGap = result.gaps.find((g) => g.type === "missing_language")
    expect(langGap).toBeDefined()
    expect(langGap?.severity).toBe("high")
  })

  it("experience gap: identifies when candidate is too junior", () => {
    const job = normalizeJob({
      id: "exp-1",
      source: "test",
      title: "Senior Platform Engineer",
      company: "ExperiencedCorp",
      remote: "hybrid",
      employmentType: "full-time",
      seniority: "senior", // Requires 5+ years
      skills: ["TypeScript"],
    })

    const juniorCandidate = normalizeCandidateProfile({
      ...defaultCandidate,
      yearsOfExperience: 2, // Too junior
    })

    const matching = matchProfile(juniorCandidate, job)
    const result = analyzeSkillGaps(juniorCandidate, job, matching)

    const expGap = result.gaps.find((g) => g.type === "experience_gap")
    expect(expGap).toBeDefined()
    expect(expGap?.severity).toBe("high")
  })

  it("education requirement gap: identifies when candidate lacks degree", () => {
    const job = normalizeJob({
      id: "edu-1",
      source: "test",
      title: "Engineer",
      company: "TechCorp",
      remote: "hybrid",
      skills: ["TypeScript"],
      description: "Master's degree in Computer Science or related field required.",
    })

    const candidateWithoutMaster = normalizeCandidateProfile({
      ...defaultCandidate,
      education: [
        {
          degree: "Bachelor's degree",
          field: "Business Administration",
          institution: "University",
        },
      ],
    })

    const matching = matchProfile(candidateWithoutMaster, job)
    const result = analyzeSkillGaps(candidateWithoutMaster, job, matching)

    const eduGap = result.gaps.find((g) => g.type === "education_gap")
    expect(eduGap).toBeDefined()
  })

  it("unknown job requirements: handles missing job data gracefully", () => {
    const minimalJob = normalizeJob({
      id: "minimal-1",
      source: "test",
      title: "Engineer",
      company: "Corp",
      remote: null,
      skills: [],
      description: null,
    })

    const matching = matchProfile(defaultCandidate, minimalJob)
    const result = analyzeSkillGaps(defaultCandidate, minimalJob, matching)

    // Without job data, gaps should be empty or minimal
    expect(result.gaps.length).toBeLessThanOrEqual(2)
    expect(result.unknowns.length).toBeGreaterThanOrEqual(1)
  })

  it("mixed strengths and gaps: identifies both", () => {
    const job = normalizeJob({
      id: "mixed-1",
      source: "test",
      title: "Full-Stack Engineer",
      company: "TechCorp",
      remote: "hybrid",
      employmentType: "full-time",
      seniority: "mid",
      skills: ["TypeScript", "React", "PostgreSQL", "Kubernetes"], // TypeScript and SQL match, React and K8s missing
      description: "Strong communication and problem-solving required. English fluency.",
    })

    const matching = matchProfile(defaultCandidate, job)
    const result = analyzeSkillGaps(defaultCandidate, job, matching)

    // Should have both strengths and gaps
    expect(result.strengths.length).toBeGreaterThan(0)
    expect(result.gaps.length).toBeGreaterThan(0)
  })

  it("soft skill gap: identifies soft skill requirements from description", () => {
    const job = normalizeJob({
      id: "soft-1",
      source: "test",
      title: "Lead Engineer",
      company: "TechCorp",
      remote: "hybrid",
      skills: ["TypeScript"],
      description:
        "Must have strong leadership skills, mentoring experience, and ability to drive initiatives independently.",
    })

    const candidateWithoutLeadership = normalizeCandidateProfile({
      ...defaultCandidate,
      skills: {
        technical: ["TypeScript"],
        soft: ["Communication", "Problem solving"], // No leadership
      },
    })

    const matching = matchProfile(candidateWithoutLeadership, job)
    const result = analyzeSkillGaps(candidateWithoutLeadership, job, matching)

    const softGap = result.gaps.find((g) => g.title.includes("leadership"))
    expect(softGap).toBeDefined()
  })

  it("strengths are identified: candidate has required skills", () => {
    const job = normalizeJob({
      id: "strengths-1",
      source: "test",
      title: "Platform Engineer",
      company: "TechCorp",
      remote: "hybrid",
      skills: ["TypeScript", "SQL", "APIs", "Linux"],
      seniority: "mid",
      description:
        "Requires strong communication and problem-solving. English proficiency essential.",
    })

    const matching = matchProfile(defaultCandidate, job)
    const result = analyzeSkillGaps(defaultCandidate, job, matching)

    // Should have strengths for matched skills and experience level
    const typeScriptStrength = result.strengths.find((s) => s.title.includes("TypeScript"))
    expect(typeScriptStrength).toBeDefined()

    const experienceStrength = result.strengths.find((s) => s.title.includes("Experience"))
    expect(experienceStrength).toBeDefined()
  })

  it("empty candidate profile: handles minimal profile", () => {
    const minimalCandidate = normalizeCandidateProfile({
      headline: "Job seeker",
    })

    const job = normalizeJob({
      id: "profile-test-1",
      source: "test",
      title: "Engineer",
      company: "Corp",
      remote: "hybrid",
      skills: ["TypeScript", "Python"],
      seniority: "mid",
    })

    const matching = matchProfile(minimalCandidate, job)
    const result = analyzeSkillGaps(minimalCandidate, job, matching)

    // Should identify gaps for minimal profile
    expect(result.totalGaps).toBeGreaterThan(0)
  })

  it("language match: candidate with required language", () => {
    const job = normalizeJob({
      id: "lang-match-1",
      source: "test",
      title: "Swedish Engineer",
      company: "SwedishCorp",
      remote: "hybrid",
      skills: ["TypeScript"],
      description: "Swedish language required. English proficiency essential.",
    })

    const candidateWithSwedish = normalizeCandidateProfile({
      ...defaultCandidate,
      languages: [
        { name: "English", level: "Native" },
        { name: "Swedish", level: "Working proficiency" },
      ],
    })

    const matching = matchProfile(candidateWithSwedish, job)
    const result = analyzeSkillGaps(candidateWithSwedish, job, matching)

    const swedishStrength = result.strengths.find((s) => s.title.includes("Swedish"))
    expect(swedishStrength).toBeDefined()

    const langGap = result.gaps.find((g) => g.type === "missing_language")
    expect(langGap).toBeUndefined()
  })

  it("certification match: candidate with required certification", () => {
    const job = normalizeJob({
      id: "cert-match-1",
      source: "test",
      title: "AWS Architect",
      company: "CloudCorp",
      remote: "hybrid",
      skills: ["AWS"],
      description: "AWS Solutions Architect certification highly valued.",
    })

    const candidateWithCert = normalizeCandidateProfile({
      ...defaultCandidate,
      certifications: ["AWS Solutions Architect Professional", "Kubernetes"],
    })

    const matching = matchProfile(candidateWithCert, job)
    const result = analyzeSkillGaps(candidateWithCert, job, matching)

    // Certificate strength should be identified - check for either AWS or the full cert name
    const certStrength = result.strengths.find((s) => s.title.includes("AWS") || s.title.includes("Solutions Architect"))
    expect(certStrength).toBeDefined()
  })

  it("result structure: has all required fields", () => {
    const job = normalizeJob({
      id: "struct-1",
      source: "test",
      title: "Engineer",
      company: "Corp",
      remote: "hybrid",
      skills: ["TypeScript"],
    })

    const matching = matchProfile(defaultCandidate, job)
    const result = analyzeSkillGaps(defaultCandidate, job, matching)

    expect(result.jobId).toBe(job.id)
    expect(result.jobTitle).toBe(job.title)
    expect(result.candidateHeadline).toBe(defaultCandidate.headline)
    expect(Array.isArray(result.gaps)).toBe(true)
    expect(Array.isArray(result.strengths)).toBe(true)
    expect(Array.isArray(result.unknowns)).toBe(true)
    expect(Array.isArray(result.recommendations)).toBe(true)
    expect(typeof result.totalGaps).toBe("number")
    expect(typeof result.criticalGaps).toBe("number")
    expect(typeof result.highGaps).toBe("number")
    expect(typeof result.summary).toBe("string")
  })

  it("recommendations are generated: based on identified gaps", () => {
    const job = normalizeJob({
      id: "rec-1",
      source: "test",
      title: "DevOps Engineer",
      company: "CloudCorp",
      remote: "hybrid",
      skills: ["Kubernetes", "Terraform"],
      description: "AWS certification required.",
    })

    const matching = matchProfile(defaultCandidate, job)
    const result = analyzeSkillGaps(defaultCandidate, job, matching)

    // Should generate recommendations for gaps
    expect(result.recommendations.length).toBeGreaterThan(0)

    // Recommendations should reference gaps
    for (const rec of result.recommendations) {
      expect(Array.isArray(rec.targetGaps)).toBe(true)
      expect(typeof rec.title).toBe("string")
      expect(typeof rec.description).toBe("string")
    }
  })

  it("gap severity is appropriate: critical > high > medium > low", () => {
    const job = normalizeJob({
      id: "severity-1",
      source: "test",
      title: "DevOps Engineer",
      company: "CloudCorp",
      remote: "hybrid",
      skills: ["Kubernetes", "TypeScript", "Git"],
    })

    const matching = matchProfile(defaultCandidate, job)
    const result = analyzeSkillGaps(defaultCandidate, job, matching)

    // Kubernetes should be critical or high
    const kubeGap = result.gaps.find((g) => g.title.includes("Kubernetes"))
    expect(kubeGap?.severity).toMatch(/critical|high/)

    // Git should be lower priority than Kubernetes
    const gitGap = result.gaps.find((g) => g.title.includes("Git"))
    if (gitGap) {
      const kubeIndex = ["critical", "high", "medium", "low"].indexOf(kubeGap?.severity || "low")
      const gitIndex = ["critical", "high", "medium", "low"].indexOf(gitGap.severity)
      expect(kubeIndex).toBeLessThanOrEqual(gitIndex)
    }
  })

  it("conflicting vs missing: distinguishes appropriately", () => {
    const job = normalizeJob({
      id: "conflict-1",
      source: "test",
      title: "Engineer",
      company: "Corp",
      remote: "onsite",
      skills: ["Rust"],
    })

    const matching = matchProfile(defaultCandidate, job)
    const result = analyzeSkillGaps(defaultCandidate, job, matching)

    // Rust skill is missing (trainable), not conflicting
    const rustGap = result.gaps.find((g) => g.title.includes("Rust"))
    expect(rustGap?.type).toBe("missing_skill")
  })
})
