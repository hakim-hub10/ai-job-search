import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  analyzeJobs,
  CandidateProfileInputError,
  loadCandidateProfile,
  normalizeJob,
  parseCandidateProfile,
} from "../src/index"

const directories: string[] = []

function completeProfile(overrides: Record<string, unknown> = {}) {
  return {
    headline: "Service coordinator",
    targetRoles: ["Service Coordinator"],
    locationPreferences: ["Malmö"],
    workMode: "hybrid",
    remotePreference: true,
    preferredIndustries: ["Services"],
    preferredEmploymentType: ["full-time"],
    skills: { technical: ["Scheduling"], soft: ["Communication"] },
    workExperience: [{ title: "Coordinator", company: "Example AB", location: "Malmö", startDate: "2022-01" }],
    education: [{ degree: "Diploma", field: "Administration", institution: "Example College", endYear: 2021 }],
    certifications: ["Safety certificate"],
    languages: [{ name: "Swedish", level: "Professional" }, { name: "English", level: "Professional" }],
    yearsOfExperience: 3,
    careerGoals: ["Coordinate reliable services"],
    ...overrides,
  }
}

async function temporaryProfile(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ai-job-search-profile-"))
  directories.push(directory)
  const path = join(directory, "profile.json")
  await writeFile(path, contents, "utf8")
  return path
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function inputError(action: () => unknown, code: string, path?: string): void {
  try {
    action()
    throw new Error("Expected CandidateProfileInputError")
  } catch (error) {
    expect(error).toBeInstanceOf(CandidateProfileInputError)
    expect(error).toMatchObject({ code, ...(path ? { path } : {}) })
  }
}

describe("safe candidate profile input", () => {
  it("parses a complete valid profile and preserves Swedish and English text", () => {
    const profile = parseCandidateProfile(completeProfile({ headline: "Administratör för vård och service" }))
    expect(profile.headline).toBe("Administratör för vård och service")
    expect(profile.languages.map((language) => language.name)).toEqual(["Swedish", "English"])
  })

  it("parses a minimal valid profile without injecting demo facts", () => {
    const profile = parseCandidateProfile(completeProfile({
      targetRoles: [], locationPreferences: [], preferredIndustries: [], preferredEmploymentType: [],
      skills: { technical: [], soft: [] }, workExperience: [], education: [], certifications: [], languages: [], careerGoals: [], yearsOfExperience: 0,
    }))
    expect(profile).toMatchObject({ headline: "Service coordinator", skills: { technical: [], soft: [] }, certifications: [], languages: [] })
    expect(profile.skills.technical).not.toContain("TypeScript")
    expect(profile.updatedAt).toBeUndefined()
  })

  it("keeps optional facts absent rather than adding values", () => {
    const profile = parseCandidateProfile(completeProfile({
      workExperience: [{ title: "Coordinator", company: "Example AB", location: "Malmö" }],
      education: [{ degree: "Diploma", field: "Administration", institution: "Example College" }],
    }))
    expect(profile.summary).toBeUndefined()
    expect(profile.workExperience[0]).not.toHaveProperty("startDate")
    expect(profile.education[0]).not.toHaveProperty("endYear")
  })

  it.each([
    ["IT", completeProfile({ headline: "Software developer", targetRoles: ["Developer"], skills: { technical: ["TypeScript"], soft: ["Communication"] } })],
    ["healthcare", completeProfile({ headline: "Registered nurse", targetRoles: ["Nurse"], skills: { technical: ["Patient documentation"], soft: ["Empathy"] } })],
    ["logistics", completeProfile({ headline: "Logistics planner", targetRoles: ["Planner"], skills: { technical: ["Inventory planning"], soft: ["Coordination"] } })],
    ["administration", completeProfile({ headline: "Office administrator", targetRoles: ["Administrator"], skills: { technical: ["Records management"], soft: ["Organisation"] } })],
  ])("accepts a domain-neutral %s profile", (_domain, input) => {
    expect(parseCandidateProfile(input).headline).toBeTruthy()
  })

  it("rejects malformed JSON and a missing file with distinct safe errors", async () => {
    const malformed = await temporaryProfile("{ not JSON")
    await expect(loadCandidateProfile(malformed)).rejects.toMatchObject({ code: "MALFORMED_JSON" })
    await expect(loadCandidateProfile(join(tmpdir(), "not-a-profile.json"))).rejects.toMatchObject({ code: "READ_FAILURE" })
  })

  it("rejects invalid roots, nulls, wrong types, and invalid enum values", () => {
    inputError(() => parseCandidateProfile(null), "INVALID_ROOT", "profile")
    inputError(() => parseCandidateProfile(completeProfile({ targetRoles: "Coordinator" })), "INVALID_FIELD", "profile.targetRoles")
    inputError(() => parseCandidateProfile(completeProfile({ workMode: "sometimes" })), "UNSUPPORTED_VALUE", "profile.workMode")
    inputError(() => parseCandidateProfile(completeProfile({ remotePreference: null })), "INVALID_FIELD", "profile.remotePreference")
  })

  it("rejects malformed nested experience, education, certification, and language values", () => {
    inputError(() => parseCandidateProfile(completeProfile({ workExperience: [{ title: "Coordinator", company: 12, location: "Malmö" }] })), "INVALID_FIELD", "profile.workExperience[0].company")
    inputError(() => parseCandidateProfile(completeProfile({ education: [{ degree: "Diploma", field: "Admin", institution: null }] })), "INVALID_FIELD", "profile.education[0].institution")
    inputError(() => parseCandidateProfile(completeProfile({ certifications: ["Valid", 4] })), "INVALID_FIELD", "profile.certifications[1]")
    inputError(() => parseCandidateProfile(completeProfile({ languages: [{ name: "English", level: 3 }] })), "INVALID_FIELD", "profile.languages[0].level")
  })

  it("rejects unknown and commonly misspelled fields", () => {
    inputError(() => parseCandidateProfile({ ...completeProfile(), certifcations: [] }), "UNSUPPORTED_VALUE", "profile.certifcations")
    inputError(() => parseCandidateProfile({ ...completeProfile(), experiance: [] }), "UNSUPPORTED_VALUE", "profile.experiance")
    inputError(() => parseCandidateProfile({ ...completeProfile(), skills: { technical: [], soft: [], langauges: [] } }), "UNSUPPORTED_VALUE", "profile.skills.langauges")
  })

  it("returns a defensive deep copy detached from the caller input", () => {
    const input = completeProfile()
    const profile = parseCandidateProfile(input)
    ;(input.skills as { technical: string[] }).technical[0] = "Mutated"
    ;(input.workExperience as Array<{ company: string }>)[0].company = "Changed"
    expect(profile.skills.technical).toEqual(["Scheduling"])
    expect(profile.workExperience[0].company).toBe("Example AB")
  })

  it("loads a UTF-8 profile, parses the tracked example, and works with analysis", async () => {
    const path = await temporaryProfile(JSON.stringify(completeProfile({ headline: "Svensk koordinator" })))
    expect((await loadCandidateProfile(path)).headline).toBe("Svensk koordinator")
    const example = JSON.parse(await readFile(new URL("../profile.example.json", import.meta.url), "utf8"))
    const profile = parseCandidateProfile(example)
    const job = normalizeJob({ id: "profile-input-job", source: "fixture", title: "Operations Coordinator", company: null, location: "Example City", country: null, url: null, applyUrl: null, date: null, employmentType: "full-time", remote: "hybrid", description: null, salary: null, skills: ["Scheduling"], seniority: null, category: null })
    expect(analyzeJobs(profile, [job]).rankedJobs).toHaveLength(1)
  })

  it("uses no provider, network, or environment input", () => {
    expect(parseCandidateProfile(completeProfile()).headline).toBe("Service coordinator")
  })
})
