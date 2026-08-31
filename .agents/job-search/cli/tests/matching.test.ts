import { describe, expect, it } from "bun:test"
import {
  createDefaultCandidateProfile,
  normalizeCandidateProfile,
  type CandidateProfile,
} from "../src/profile"
import { matchProfile, type MatchingResult } from "../src/matching"
import { normalizeJob, type NormalizedJob } from "../src/index"

describe("job matching engine", () => {
  let defaultCandidate: CandidateProfile
  let strongJob: NormalizedJob
  let partialJob: NormalizedJob
  let missingSkillsJob: NormalizedJob
  let conflictingJob: NormalizedJob
  let minimalJob: NormalizedJob

  function setup() {
    defaultCandidate = createDefaultCandidateProfile()

    strongJob = normalizeJob({
      id: "strong-1",
      source: "test",
      title: "Platform Engineer",
      company: "Tech Corp",
      location: "Jönköping, Sweden",
      country: "Sweden",
      url: "https://example.com/strong",
      applyUrl: "https://example.com/apply/strong",
      employmentType: "full-time",
      remote: "hybrid",
      seniority: "mid",
      category: "technology",
      skills: ["TypeScript", "Bun", "SQL", "APIs"],
      description: `
        We seek a Platform Engineer with strong communication skills and problem solving abilities.
        Ownership and initiative are key. This is a collaborative role within the technology sector.
      `,
    })

    partialJob = normalizeJob({
      id: "partial-1",
      source: "test",
      title: "Software Engineer (Backend)",
      company: "Mid Corp",
      location: "Stockholm, Sweden",
      country: "Sweden",
      url: "https://example.com/partial",
      applyUrl: "https://example.com/apply/partial",
      employmentType: "full-time",
      remote: "hybrid",
      seniority: "mid",
      skills: ["TypeScript", "Node.js"],
      description: "Backend engineer role with collaborative teamwork emphasis.",
    })

    missingSkillsJob = normalizeJob({
      id: "missing-1",
      source: "test",
      title: "DevOps Engineer",
      company: "Ops Corp",
      location: "Stockholm, Sweden",
      country: "Sweden",
      url: "https://example.com/missing",
      applyUrl: "https://example.com/apply/missing",
      employmentType: "full-time",
      remote: "onsite",
      seniority: "senior",
      skills: ["Kubernetes", "Terraform", "AWS", "Golang"],
      description: "Senior DevOps role requiring senior-level expertise.",
    })

    conflictingJob = normalizeJob({
      id: "conflict-1",
      source: "test",
      title: "Platform Engineer",
      company: "Remote Haters Inc",
      location: "San Francisco, USA",
      country: "USA",
      url: "https://example.com/conflict",
      applyUrl: "https://example.com/apply/conflict",
      employmentType: "part-time",
      remote: "onsite",
      seniority: "senior",
      skills: ["TypeScript"],
      description: "Onsite-only role in San Francisco.",
    })

    minimalJob = normalizeJob({
      id: "minimal-1",
      source: "test",
      title: "IT Person",
      company: null,
      location: null,
      country: null,
      url: "https://example.com/minimal",
      applyUrl: null,
      employmentType: null,
      remote: null,
      seniority: null,
      skills: [],
      description: null,
    })
  }

  it("strong match: all criteria aligned", () => {
    setup()
    const result = matchProfile(defaultCandidate, strongJob)

    expect(result.totalMatched).toBeGreaterThanOrEqual(6)
    expect(result.totalMissing).toBe(0)
    expect(result.totalConflicting).toBe(0)
    expect(result.matchedDimensions).toContain("targetRole")
    expect(result.matchedDimensions).toContain("location")
    expect(result.matchedDimensions).toContain("remotePreference")
    expect(result.matchedDimensions).toContain("employmentType")
    expect(result.matchedDimensions).toContain("technicalSkills")
  })

  it("partial match: some criteria met", () => {
    setup()
    const result = matchProfile(defaultCandidate, partialJob)

    expect(result.totalMatched).toBeGreaterThan(0)
    expect(result.totalMissing).toBeGreaterThanOrEqual(0)
    expect(result.totalConflicting).toBeLessThanOrEqual(1)
    expect(result.matchedDimensions).toContain("technicalSkills")
    expect(result.matchedDimensions).toContain("remotePreference")
  })

  it("missing skills: job requires skills candidate doesn't have", () => {
    setup()
    const result = matchProfile(defaultCandidate, missingSkillsJob)

    expect(result.missingDimensions).toContain("technicalSkills")
    const techSkillEvidence = result.missing.find((e) => e.dimension === "technicalSkills")
    expect(techSkillEvidence?.detail).toMatch(/Candidate has only|none/)
  })

  it("conflicting requirements: location and work mode mismatch", () => {
    setup()
    const result = matchProfile(defaultCandidate, conflictingJob)

    expect(result.conflictingDimensions).toContain("location")
    expect(result.conflictingDimensions).toContain("remotePreference")
    expect(result.totalConflicting).toBeGreaterThanOrEqual(2)
  })

  it("unknown fields: handles missing job data gracefully", () => {
    setup()
    const result = matchProfile(defaultCandidate, minimalJob)

    expect(result.unknownDimensions.length).toBeGreaterThan(0)
    expect(result.unknownDimensions).toContain("location")
    expect(result.unknownDimensions).toContain("employmentType")
    expect(result.unknownDimensions).toContain("technicalSkills")
  })

  it("location matching: candidate location preferences", () => {
    setup()
    const candidateWithMultipleLocations = normalizeCandidateProfile({
      ...defaultCandidate,
      locationPreferences: ["Jönköping, Sweden", "Stockholm, Sweden", "Remote"],
    })

    const joenkopingJob = normalizeJob({
      id: "jk-1",
      source: "test",
      title: "Platform Engineer",
      company: "JK Corp",
      location: "Jönköping, Sweden",
      remote: "hybrid",
      employmentType: "full-time",
      skills: ["TypeScript"],
    })

    const result = matchProfile(candidateWithMultipleLocations, joenkopingJob)
    expect(result.matchedDimensions).toContain("location")
  })

  it("remote preference: fully remote job", () => {
    setup()
    const remoteJob = normalizeJob({
      id: "remote-1",
      source: "test",
      title: "Platform Engineer",
      company: "Remote Corp",
      remote: "fully remote",
      location: null,
      employmentType: "full-time",
      skills: ["TypeScript"],
    })

    const candidate = normalizeCandidateProfile({
      ...defaultCandidate,
      remotePreference: true,
    })

    const result = matchProfile(candidate, remoteJob)
    expect(result.matchedDimensions).toContain("remotePreference")
  })

  it("hybrid preference: job is hybrid, candidate accepts hybrid", () => {
    setup()
    const hybridJob = normalizeJob({
      id: "hybrid-1",
      source: "test",
      title: "Platform Engineer",
      company: "Hybrid Corp",
      remote: "hybrid",
      location: "Jönköping, Sweden",
      employmentType: "full-time",
      skills: ["TypeScript"],
    })

    const candidate = normalizeCandidateProfile({
      ...defaultCandidate,
      workMode: "hybrid",
    })

    const result = matchProfile(candidate, hybridJob)
    expect(result.matchedDimensions).toContain("remotePreference")
  })

  it("onsite job: candidate prefers onsite", () => {
    setup()
    const onsiteJob = normalizeJob({
      id: "onsite-1",
      source: "test",
      title: "Platform Engineer",
      company: "Onsite Corp",
      remote: "onsite",
      location: "Jönköping, Sweden",
      employmentType: "full-time",
      skills: ["TypeScript"],
    })

    const candidate = normalizeCandidateProfile({
      ...defaultCandidate,
      workMode: "onsite",
    })

    const result = matchProfile(candidate, onsiteJob)
    expect(result.matchedDimensions).toContain("remotePreference")
  })

  it("employment type matching: full-time job, full-time candidate", () => {
    setup()
    const fullTimeJob = normalizeJob({
      id: "ft-1",
      source: "test",
      title: "Platform Engineer",
      company: "Corp",
      remote: "hybrid",
      employmentType: "full-time",
      skills: ["TypeScript"],
    })

    const candidate = normalizeCandidateProfile({
      ...defaultCandidate,
      preferredEmploymentType: ["full-time"],
    })

    const result = matchProfile(candidate, fullTimeJob)
    expect(result.matchedDimensions).toContain("employmentType")
  })

  it("experience level: mid-level candidate vs mid-level job", () => {
    setup()
    const midJob = normalizeJob({
      id: "mid-1",
      source: "test",
      title: "Platform Engineer",
      company: "Corp",
      seniority: "mid",
      remote: "hybrid",
      employmentType: "full-time",
      skills: ["TypeScript"],
    })

    const candidate = normalizeCandidateProfile({
      ...defaultCandidate,
      yearsOfExperience: 3,
    })

    const result = matchProfile(candidate, midJob)
    expect(result.matchedDimensions).toContain("yearsOfExperience")
  })

  it("experience level: junior candidate vs senior job (conflict)", () => {
    setup()
    const seniorJob = normalizeJob({
      id: "senior-1",
      source: "test",
      title: "Platform Engineer",
      company: "Corp",
      seniority: "senior",
      remote: "hybrid",
      employmentType: "full-time",
      skills: ["TypeScript"],
    })

    const candidate = normalizeCandidateProfile({
      ...defaultCandidate,
      yearsOfExperience: 1,
    })

    const result = matchProfile(candidate, seniorJob)
    expect(result.conflictingDimensions).toContain("yearsOfExperience")
  })

  it("certifications: candidate has relevant certification", () => {
    setup()
    const certJob = normalizeJob({
      id: "cert-1",
      source: "test",
      title: "Platform Engineer",
      company: "Corp",
      remote: "hybrid",
      employmentType: "full-time",
      skills: ["TypeScript"],
      description: "We require AWS Certification or similar cloud credential.",
    })

    const candidate = normalizeCandidateProfile({
      ...defaultCandidate,
      certifications: ["AWS Certification"],
    })

    const result = matchProfile(candidate, certJob)
    expect(result.matchedDimensions).toContain("certifications")
  })

  it("languages: English required, candidate speaks English", () => {
    setup()
    const englishJob = normalizeJob({
      id: "en-1",
      source: "test",
      title: "Platform Engineer",
      company: "Corp",
      remote: "hybrid",
      employmentType: "full-time",
      skills: ["TypeScript"],
      description: "English language skills required for daily communication.",
    })

    const candidate = normalizeCandidateProfile({
      ...defaultCandidate,
      languages: [{ name: "English", level: "Native" }],
    })

    const result = matchProfile(candidate, englishJob)
    expect(result.matchedDimensions).toContain("languages")
  })

  it("languages: Swedish required, candidate doesn't speak Swedish (conflict)", () => {
    setup()
    const swedishJob = normalizeJob({
      id: "sv-1",
      source: "test",
      title: "Platform Engineer",
      company: "Corp",
      remote: "hybrid",
      employmentType: "full-time",
      skills: ["TypeScript"],
      description: "Svenska språkkunskaper är obligatoriska.",
    })

    const candidate = normalizeCandidateProfile({
      ...defaultCandidate,
      languages: [{ name: "English", level: "Native" }],
    })

    const result = matchProfile(candidate, swedishJob)
    expect(result.conflictingDimensions).toContain("languages")
  })

  it("empty candidate profile: normalizeCandidateProfile fills in defaults", () => {
    // Create a truly minimal profile by passing empty values
    // Note: normalizeCandidateProfile intentionally replaces empty arrays with defaults
    const minimalCandidate = normalizeCandidateProfile({
      headline: "Job seeker",
    })

    // The profile should now have default values, which should provide a good match
    const result = matchProfile(minimalCandidate, strongJob)
    expect(result.totalMatched).toBeGreaterThan(0)
    expect(result.jobId).toBe(strongJob.id)
  })

  it("result structure: all fields are populated", () => {
    setup()
    const result = matchProfile(defaultCandidate, strongJob)

    expect(result.jobId).toBe(strongJob.id)
    expect(result.jobTitle).toBe(strongJob.title)
    expect(result.candidateHeadline).toBe(defaultCandidate.headline)
    expect(Array.isArray(result.matched)).toBe(true)
    expect(Array.isArray(result.missing)).toBe(true)
    expect(Array.isArray(result.conflicting)).toBe(true)
    expect(Array.isArray(result.unknown)).toBe(true)
    expect(typeof result.totalMatched).toBe("number")
    expect(typeof result.totalMissing).toBe("number")
    expect(typeof result.totalConflicting).toBe("number")
    expect(typeof result.totalUnknown).toBe("number")
    expect(Array.isArray(result.matchedDimensions)).toBe(true)
    expect(Array.isArray(result.missingDimensions)).toBe(true)
    expect(Array.isArray(result.conflictingDimensions)).toBe(true)
    expect(Array.isArray(result.unknownDimensions)).toBe(true)

    // Verify consistency
    expect(result.matched.length).toBe(result.totalMatched)
    expect(result.missing.length).toBe(result.totalMissing)
    expect(result.conflicting.length).toBe(result.totalConflicting)
    expect(result.unknown.length).toBe(result.totalUnknown)
    expect(result.matchedDimensions.length).toBe(result.totalMatched)
    expect(result.missingDimensions.length).toBe(result.totalMissing)
    expect(result.conflictingDimensions.length).toBe(result.totalConflicting)
    expect(result.unknownDimensions.length).toBe(result.totalUnknown)
  })

  it("soft skills: candidate communication skills match job requirement", () => {
    setup()
    const result = matchProfile(defaultCandidate, strongJob)

    const softSkillsEvidence = result.matched.find((e) => e.dimension === "softSkills")
    expect(softSkillsEvidence).toBeDefined()
    expect(softSkillsEvidence?.status).toBe("matched")
  })

  it("does not invent data: unknown fields remain unknown", () => {
    setup()
    const jobWithoutDescription = normalizeJob({
      id: "no-desc",
      source: "test",
      title: "IT Role",
      company: "Corp",
      remote: null,
      location: null,
      description: null,
      skills: [],
    })

    const result = matchProfile(defaultCandidate, jobWithoutDescription)

    // Should have several unknowns, not fabricated matches
    expect(result.totalUnknown).toBeGreaterThan(2)
    expect(result.totalMissing).toBeLessThanOrEqual(3)
  })
})
