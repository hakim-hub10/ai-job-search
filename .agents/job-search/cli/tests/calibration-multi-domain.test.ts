import { describe, expect, it } from "bun:test"
import { normalizeCandidateProfile, type CandidateProfile } from "../src/profile"
import { matchProfile } from "../src/matching"
import { scoreMatch } from "../src/scoring"
import { normalizeJob } from "../src/index"

/**
 * Cross-domain calibration matrix. Verifies the matching/scoring/confidence
 * pipeline is correct, explainable and evidence-aware - not that scores are
 * high. Each domain repeats the same rich / sparse / unrelated pattern so a
 * single domain's fixtures can never hide a systemic bug.
 */
describe("cross-domain calibration: IT support", () => {
  const candidate = normalizeCandidateProfile({
    headline: "IT Support Technician",
    targetRoles: ["IT Support Technician", "IT Support Specialist"],
    locationPreferences: ["Jönköping, Sweden"],
    workMode: "hybrid",
    remotePreference: true,
    preferredEmploymentType: ["full-time"],
    skills: { technical: ["Windows", "Active Directory", "Microsoft 365", "Networking"], soft: ["Communication", "Problem solving"] },
    workExperience: [{ title: "IT Support Technician", company: "Example IT", location: "Jönköping" }],
    certifications: ["CompTIA A+"],
    languages: [{ name: "Swedish", level: "Native" }, { name: "English", level: "Professional" }],
    yearsOfExperience: 2,
  } as never)

  it("strong evidence + strong match => strong result with high confidence", () => {
    const job = normalizeJob({
      id: "it-rich", source: "test", title: "IT Support Technician", company: "Corp", location: "Jönköping, Sweden",
      employmentType: "full-time", remote: "hybrid", seniority: "mid", skills: ["Active Directory", "Microsoft 365", "Networking"],
      description: "Vi söker en IT-supporttekniker. Krav: erfarenhet av Active Directory, Microsoft 365 och nätverk. God kommunikationsförmåga och problemlösningsförmåga krävs. Svenska och engelska krävs.",
    })
    const matching = matchProfile(candidate, job)
    const score = scoreMatch(matching)
    expect(score.score).toBeGreaterThanOrEqual(70)
    expect(score.confidenceLabel).toBe("high")
    expect(matching.conflictingDimensions).toEqual([])
  })

  it("sparse posting => low confidence, not a fabricated low score", () => {
    const job = normalizeJob({ id: "it-sparse", source: "test", title: "IT Support Technician" })
    const matching = matchProfile(candidate, job)
    const score = scoreMatch(matching)
    expect(score.confidenceLabel).toBe("low")
    expect(matching.unknownDimensions.length).toBeGreaterThanOrEqual(6)
    expect(matching.missingDimensions).not.toContain("technicalSkills")
    expect(matching.missingDimensions).not.toContain("languages")
  })

  it("genuinely unrelated posting => low score with real (non-sparse) confidence", () => {
    const job = normalizeJob({
      id: "it-unrelated", source: "test", title: "Registered Nurse", company: "Hospital", location: "Malmö, Sweden",
      employmentType: "full-time", remote: "onsite", seniority: "mid", skills: ["Patient care", "Clinical documentation"],
      description: "We seek a Registered Nurse for our ICU ward. Requires nursing license, patient care experience and clinical documentation skills. English required.",
    })
    const matching = matchProfile(candidate, job)
    const score = scoreMatch(matching)
    expect(score.score).toBeLessThan(40)
    expect(score.confidenceLabel).not.toBe("low")
    expect(matching.missingDimensions).toContain("targetRole")
    expect(matching.missingDimensions).toContain("technicalSkills")
  })

  it("partial evidence => moderate result, not collapsed to 0 or inflated to 100", () => {
    const job = normalizeJob({
      id: "it-partial", source: "test", title: "IT Support Technician", company: "Corp", location: "Stockholm, Sweden",
      employmentType: "full-time", remote: "onsite", seniority: "mid", skills: ["Active Directory", "Microsoft 365", "Networking", "Linux", "Kubernetes"],
      description: "IT-supporttekniker sökes. Erfarenhet av Linux och Kubernetes är meriterande.",
    })
    const matching = matchProfile(candidate, job)
    const score = scoreMatch(matching)
    const technical = matching.missing.find((e) => e.dimension === "technicalSkills")
    expect(technical?.requirementCoverage?.coverageRatio).toBeGreaterThan(0)
    expect(technical?.requirementCoverage?.coverageRatio).toBeLessThan(1)
    expect(score.score).toBeGreaterThan(20)
    expect(score.score).toBeLessThan(90)
  })
})

describe("cross-domain calibration: logistics", () => {
  const candidate = normalizeCandidateProfile({
    headline: "Logistics Coordinator",
    targetRoles: ["Logistics Coordinator", "Warehouse Coordinator"],
    locationPreferences: ["Malmö, Sweden"],
    workMode: "onsite",
    remotePreference: false,
    preferredEmploymentType: ["full-time"],
    skills: { technical: ["Inventory management", "Route planning", "SAP"], soft: ["Communication", "Ownership"] },
    workExperience: [{ title: "Logistics Coordinator", company: "Example Logistics", location: "Malmö" }],
    languages: [{ name: "Swedish", level: "Native" }],
    yearsOfExperience: 3,
  } as never)

  it("strong evidence + strong match => strong result", () => {
    const job = normalizeJob({
      id: "log-rich", source: "test", title: "Logistics Coordinator", company: "Speditör AB", location: "Malmö, Sweden",
      employmentType: "full-time", remote: "onsite", seniority: "mid", skills: ["Inventory management", "SAP"],
      description: "Vi söker en logistikkoordinator med erfarenhet av lagerhantering och SAP. God samarbetsförmåga och eget ansvar krävs.",
    })
    const matching = matchProfile(candidate, job)
    const score = scoreMatch(matching)
    expect(score.score).toBeGreaterThanOrEqual(60)
    expect(score.confidenceLabel).not.toBe("low")
  })

  it("sparse posting stays unknown, never fabricated missing", () => {
    const job = normalizeJob({ id: "log-sparse", source: "test", title: "Logistics Coordinator" })
    const matching = matchProfile(candidate, job)
    expect(matching.missingDimensions).not.toContain("technicalSkills")
    expect(matching.unknownDimensions).toContain("technicalSkills")
  })

  it("unrelated posting (accountant) scores low without inventing a target-role match", () => {
    const job = normalizeJob({
      id: "log-unrelated", source: "test", title: "Accountant", company: "Finance AB", location: "Malmö, Sweden",
      employmentType: "full-time", remote: "onsite", skills: ["Bookkeeping", "Tax filing"],
      description: "We seek an Accountant for bookkeeping and tax filing. Certified accountant required.",
    })
    const matching = matchProfile(candidate, job)
    const score = scoreMatch(matching)
    expect(matching.matchedDimensions).not.toContain("targetRole")
    expect(score.score).toBeLessThan(40)
  })
})

describe("cross-domain calibration: administration", () => {
  const candidate = normalizeCandidateProfile({
    headline: "Office Administrator",
    targetRoles: ["Office Administrator", "Administrative Assistant"],
    locationPreferences: ["Göteborg, Sweden"],
    workMode: "hybrid",
    remotePreference: true,
    preferredEmploymentType: ["full-time"],
    skills: { technical: ["Records management", "Microsoft 365", "Scheduling"], soft: ["Organisation", "Communication"] },
    workExperience: [{ title: "Office Administrator", company: "Example AB", location: "Göteborg" }],
    languages: [{ name: "Swedish", level: "Native" }, { name: "English", level: "Professional" }],
    yearsOfExperience: 4,
  } as never)

  it("strong evidence + strong match => strong result", () => {
    const job = normalizeJob({
      id: "admin-rich", source: "test", title: "Office Administrator", company: "Kontor AB", location: "Göteborg, Sweden",
      employmentType: "full-time", remote: "hybrid", seniority: "mid", skills: ["Records management", "Microsoft 365", "Scheduling"],
      description: "Vi söker en administratör med erfarenhet av ärendehantering, schemaläggning och Microsoft 365. God kommunikationsförmåga krävs. Svenska och engelska krävs.",
    })
    const matching = matchProfile(candidate, job)
    const score = scoreMatch(matching)
    expect(score.score).toBeGreaterThanOrEqual(70)
    expect(score.confidenceLabel).toBe("high")
  })

  it("a candidate title that is merely a substring of the job title is not treated as a match (Assistant vs Assistant Nurse)", () => {
    const assistantCandidate = normalizeCandidateProfile({ ...candidate, targetRoles: ["Assistant"] })
    const job = normalizeJob({ id: "admin-assistant-nurse", source: "test", title: "Assistant Nurse", company: "Hospital", skills: [] })
    const matching = matchProfile(assistantCandidate, job)
    expect(matching.matchedDimensions).not.toContain("targetRole")
    expect(matching.missingDimensions).toContain("targetRole")
  })

  it("legitimate curated concept alias still recognized (IT Support / IT Support Technician)", () => {
    const itCandidate = normalizeCandidateProfile({ ...candidate, targetRoles: ["IT Support"] })
    const job = normalizeJob({ id: "admin-it-alias", source: "test", title: "English IT Support Technician", company: "Corp", skills: [] })
    const matching = matchProfile(itCandidate, job)
    expect(matching.matchedDimensions).toContain("targetRole")
  })

  it("substring skill overlap does not fabricate a match (Java vs JavaScript)", () => {
    const devCandidate = normalizeCandidateProfile({ ...candidate, skills: { technical: ["Java"], soft: [] } })
    const job = normalizeJob({ id: "admin-java-js", source: "test", title: "Frontend Developer", company: "Corp", skills: ["JavaScript"] })
    const matching = matchProfile(devCandidate, job)
    const technical = matching.missing.find((e) => e.dimension === "technicalSkills")
    expect(matching.matchedDimensions).not.toContain("technicalSkills")
    expect(technical?.requirementCoverage?.matchedRequirements).toEqual([])
  })
})

describe("score/confidence/ranking consistency", () => {
  it("displayed score, confidence label and underlying breakdown never contradict each other", () => {
    const candidate = normalizeCandidateProfile({
      headline: "Administrative Assistant", targetRoles: ["Administrative Assistant"], skills: { technical: ["Scheduling"], soft: [] },
    } as never)
    const rich = normalizeJob({
      id: "consistency-rich", source: "test", title: "Administrative Assistant", company: "Corp", employmentType: "full-time",
      remote: "onsite", skills: ["Scheduling"], description: "We need an Administrative Assistant with scheduling experience.",
    })
    const sparse = normalizeJob({ id: "consistency-sparse", source: "test", title: "Administrative Assistant" })

    for (const job of [rich, sparse]) {
      const matching = matchProfile(candidate, job)
      const score = scoreMatch(matching)
      // The confidence label must always be derivable from the same confidence number shown to the user.
      const expectedLabel = score.confidence >= 0.8 ? "high" : score.confidence >= 0.5 ? "medium" : "low"
      expect(score.confidenceLabel).toBe(expectedLabel)
      // A dimension can never be simultaneously counted as both known and unknown.
      const allDims = [...matching.matchedDimensions, ...matching.missingDimensions, ...matching.conflictingDimensions]
      for (const dimension of allDims) expect(matching.unknownDimensions).not.toContain(dimension)
    }
  })
})
