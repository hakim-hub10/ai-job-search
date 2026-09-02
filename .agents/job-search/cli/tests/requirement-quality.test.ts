import { describe, expect, it } from "bun:test"
import {
  analyzeJobs,
  analyzeSkillGaps,
  createDefaultCandidateProfile,
  explicitRequirementSegments,
  matchProfile,
  normalizeCandidateProfile,
  normalizeJob,
} from "../src/index"

describe("H8.2 deterministic requirement quality", () => {
  const candidate = createDefaultCandidateProfile()

  it("distinguishes explicit requirements from descriptive mentions", () => {
    const description = "You will work with Azure every day. AWS certification is required."
    expect(explicitRequirementSegments(description, ["Azure"])).toEqual([])
    expect(explicitRequirementSegments(description, ["AWS certification"])).toHaveLength(1)
  })

  it("keeps HTML list items isolated so a later marker cannot promote an earlier mention", () => {
    const description = "<ul><li>PowerShell and Python scripting</li><li>Swedish citizenship is required</li></ul>"
    expect(explicitRequirementSegments(description, ["PowerShell"])).toEqual([])
    expect(explicitRequirementSegments(description, ["Python"])).toEqual([])
  })

  it("does not let a later citizenship requirement promote preceding tool names", () => {
    const description = "PowerShell, Python or JavaScript) Due to the sensitivity of our work, we require Swedish citizenship."
    expect(explicitRequirementSegments(description, ["PowerShell"])).toEqual([])
    expect(explicitRequirementSegments(description, ["Python"])).toEqual([])
  })

  it("does not turn a platform mention into a certification gap", () => {
    const job = normalizeJob({
      id: "platform-mention",
      source: "test",
      title: "IT Support Engineer",
      description: "You will administer Azure and support Docker-based developer tooling.",
    })
    const result = analyzeSkillGaps(candidate, job, matchProfile(candidate, job))
    expect(result.gaps.filter((gap) => gap.type === "missing_certification")).toEqual([])
  })

  it("keeps a genuinely required certification as a confirmed gap", () => {
    const withoutAws = normalizeCandidateProfile({ ...candidate, certifications: ["ITIL Foundation"] })
    const job = normalizeJob({
      id: "cert-required",
      source: "test",
      title: "Cloud Support Engineer",
      description: "AWS certification is required for this role.",
    })
    const result = analyzeSkillGaps(withoutAws, job, matchProfile(withoutAws, job))
    expect(result.gaps).toContainEqual(expect.objectContaining({
      type: "missing_certification",
      requirement: expect.objectContaining({ importance: "required" }),
    }))
  })

  it("treats Bachelor's or Master's as one minimum education threshold", () => {
    const bachelor = normalizeCandidateProfile({
      ...candidate,
      education: [{ degree: "Bachelor's degree", field: "IT", institution: "Example" }],
    })
    const job = normalizeJob({
      id: "degree-alternative",
      source: "test",
      title: "IT Support Specialist",
      description: "A Bachelor's or Master's degree is required.",
    })
    const result = analyzeSkillGaps(bachelor, job, matchProfile(bachelor, job))
    expect(result.gaps.filter((gap) => gap.type === "education_gap")).toEqual([])
  })

  it("keeps unsupported behavioral traits out of the learning plan", () => {
    const withoutTraits = normalizeCandidateProfile({
      ...candidate,
      skills: { technical: candidate.skills.technical, soft: ["Communication"] },
    })
    const job = normalizeJob({
      id: "behavioral",
      source: "test",
      title: "IT Support Specialist",
      description: "You must show ownership, leadership, and collaboration.",
    })
    const result = analyzeJobs(withoutTraits, [job])
    expect(result.learningPlan.prioritizedGaps.map((gap) => gap.skill)).not.toEqual(
      expect.arrayContaining(["ownership", "leadership", "collaboration"]),
    )
  })
})
