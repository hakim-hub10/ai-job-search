import { describe, expect, it } from "bun:test"
import {
  createDefaultCandidateProfile,
  normalizeCandidateProfile,
  type CandidateProfile,
} from "../src/profile"

describe("candidate profile foundation", () => {
  it("creates a default profile with the required fields", () => {
    const profile = createDefaultCandidateProfile()

    expect(profile.headline).toBeTruthy()
    expect(profile.targetRoles.length).toBeGreaterThan(0)
    expect(profile.locationPreferences.length).toBeGreaterThan(0)
    expect(profile.skills.technical.length).toBeGreaterThan(0)
    expect(profile.skills.soft.length).toBeGreaterThan(0)
    expect(profile.yearsOfExperience).toBeGreaterThan(0)
  })

  it("normalizes a partial profile into a full profile shape", () => {
    const input = {
      headline: "Platform engineer",
      targetRoles: ["Platform Engineer"],
      locationPreferences: ["Jönköping, Sweden"],
      workMode: "hybrid",
      skills: {
        technical: ["TypeScript", "Bun"],
        soft: ["Communication"],
      },
      yearsOfExperience: 5,
    }

    const profile = normalizeCandidateProfile(input as Partial<CandidateProfile>)

    expect(profile.headline).toBe("Platform engineer")
    expect(profile.workMode).toBe("hybrid")
    expect(profile.skills.technical).toContain("TypeScript")
    expect(profile.skills.soft).toContain("Communication")
    expect(profile.locationPreferences).toEqual(["Jönköping, Sweden"])
  })
})
