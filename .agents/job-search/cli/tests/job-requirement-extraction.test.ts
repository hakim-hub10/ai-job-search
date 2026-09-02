import { describe, expect, it } from "bun:test"
import {
  analyzeJobs,
  createDefaultCandidateProfile,
  extractTechnicalRequirements,
  normalizeCandidateProfile,
  normalizeJob,
} from "../src/index"

describe("H8.2 technical requirement extraction", () => {
  it("extracts recognized terms only from explicit requirement context", () => {
    const result = extractTechnicalRequirements(normalizeJob({
      id: "requirements",
      source: "test",
      title: "IT Support",
      description: "We use Docker internally. Experience with Azure, Intune and PowerShell is required.",
    }))
    expect(result.extractedSkills).toEqual(["Azure", "Intune", "PowerShell"])
    expect(result.job.skills).not.toContain("Docker")
  })

  it("preserves source skills, input immutability, and deterministic ordering", () => {
    const job = normalizeJob({
      id: "preserve",
      source: "test",
      title: "Support",
      skills: ["Windows"],
      description: "Knowledge of ServiceNow and Microsoft 365 is required.",
    })
    const before = structuredClone(job)
    const first = extractTechnicalRequirements(job)
    const second = extractTechnicalRequirements(job)
    expect(first).toEqual(second)
    expect(first.job.skills).toEqual(["Windows", "Microsoft 365", "ServiceNow"])
    expect(job).toEqual(before)
  })

  it("does not split a longer alias into a second requirement or duplicate a source alias", () => {
    const result = extractTechnicalRequirements(normalizeJob({
      id: "aliases",
      source: "test",
      title: "Support",
      skills: ["O365"],
      description: "Experience with Azure AD and Office 365 is required.",
    }))
    expect(result.extractedSkills).toEqual(["Microsoft Entra ID"])
    expect(result.job.skills).toEqual(["O365", "Microsoft Entra ID"])
  })

  it("feeds confirmed technical requirements into gaps and the learning plan", () => {
    const base = createDefaultCandidateProfile()
    const candidate = normalizeCandidateProfile({
      ...base,
      skills: { technical: ["Windows", "Microsoft 365"], soft: ["Communication"] },
    })
    const job = normalizeJob({
      id: "analysis",
      source: "test",
      title: "IT Support Specialist",
      description: "You must have experience with Windows, Microsoft 365 and Intune. We value ownership.",
    })
    const result = analyzeJobs(candidate, [job])
    expect(result.rankedJobs[0]?.job.skills).toEqual(["Intune", "Microsoft 365", "Windows"])
    expect(result.rankedJobs[0]?.skillGapResult.gaps).toContainEqual(expect.objectContaining({
      type: "missing_skill",
      requirement: expect.objectContaining({ identity: expect.objectContaining({ key: "skill:intune" }) }),
    }))
    expect(result.learningPlan.prioritizedGaps.map((gap) => gap.skill)).toEqual(["Intune"])
  })
})
