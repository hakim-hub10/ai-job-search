import { describe, expect, it } from "bun:test"
import {
  analyzeJobs,
  createDefaultCandidateProfile,
  extractTechnicalRequirements,
  MAX_REQUIREMENT_EVIDENCE_LENGTH,
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
    expect(result.extractedSkills).toEqual(["Active Directory"])
    expect(result.job.skills).toEqual(["Microsoft 365", "Active Directory"])
  })

  it("canonicalizes duplicate source aliases into one requirement", () => {
    const result = extractTechnicalRequirements(normalizeJob({
      id: "canonical-aliases",
      source: "test",
      title: "Support",
      skills: ["active-directory", "AD", "Microsoft Entra ID", "M365", "Office 365"],
    }))
    expect(result.job.skills).toEqual(["Active Directory", "Microsoft 365"])
  })

  it("preserves bounded provenance and required versus preferred importance", () => {
    const result = extractTechnicalRequirements(normalizeJob({
      id: "provenance",
      source: "linkedin",
      title: "Support",
      description: `Azure is mandatory for this role ${"x".repeat(400)}. Jira is preferred.`,
    }))
    expect(result.requirements).toEqual([
      expect.objectContaining({ canonical: "Azure", matchedAlias: "Azure", importance: "required", jobId: "provenance", source: "linkedin" }),
      expect.objectContaining({ canonical: "Jira", matchedAlias: "Jira", importance: "preferred", jobId: "provenance", source: "linkedin" }),
    ])
    expect(result.requirements[0]?.evidence.length).toBeLessThanOrEqual(MAX_REQUIREMENT_EVIDENCE_LENGTH)
    expect(result.requirements[0]?.evidence).toContain("Azure")
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
    expect(result.learningPlan.prioritizedGaps[0]).toMatchObject({
      severity: "medium",
      importance: "required",
      evidence: ["You must have experience with Windows, Microsoft 365 and Intune"],
    })
  })

  it("derives severity from requirement context instead of the product name", () => {
    const candidate = normalizeCandidateProfile({
      ...createDefaultCandidateProfile(),
      skills: { technical: ["Windows"], soft: ["Communication"] },
    })
    const result = analyzeJobs(candidate, [normalizeJob({
      id: "severity",
      source: "test",
      title: "Cloud Support",
      description: "Azure is required. Python is essential and required. Jira is preferred.",
    })])
    const bySkill = new Map(result.learningPlan.prioritizedGaps.map((gap) => [gap.skill, gap]))
    expect(bySkill.get("Azure")).toMatchObject({ severity: "medium", importance: "required" })
    expect(bySkill.get("Python")).toMatchObject({ severity: "high", importance: "required" })
    expect(bySkill.get("Jira")).toMatchObject({ severity: "low", importance: "preferred" })
    expect(result.rankedJobs[0]?.skillGapResult.gaps.find((gap) => gap.requirement?.identity.original === "Jira")).toMatchObject({
      jobRequirement: "Preferred: Jira",
      description: "Candidate profile does not list the preferred skill: Jira",
    })
  })
})
