import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  discoverAnalysis,
  discoverApplication,
  discoverApplicationList,
  discoverInterviewQuestions,
  formatAnalysisDiscovery,
  formatApplication,
  formatApplicationList,
  formatInterviewQuestions,
} from "../src/cli-discovery"
import {
  analyzeJobs,
  createApplication,
  createFileApplicationRepository,
  normalizeCandidateProfile,
  normalizeJob,
  type ApplicationRecord,
  type CandidateDocumentEvidenceInput,
} from "../src/index"

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

const profile = normalizeCandidateProfile({
  headline: "PRIVATE PROFILE Coordinator",
  targetRoles: ["Logistics Coordinator"],
  locationPreferences: ["Malmö"],
  workMode: "onsite",
  remotePreference: false,
  preferredEmploymentType: ["full-time"],
  skills: { technical: ["Scheduling"], soft: ["Communication"] },
  yearsOfExperience: 3,
})

const jobs = [
  normalizeJob({ id: "strong", source: "fixture-a", sourceId: "a", title: "Logistics Coordinator", company: "Example Logistics", location: "Malmö", url: "https://example.test/strong", applyUrl: null, remote: "onsite", employmentType: "full-time", seniority: "mid", skills: ["Scheduling", "SAP"], description: "Use SAP for logistics scheduling." }),
  normalizeJob({ id: "weaker", source: "fixture-b", sourceId: "b", title: "Warehouse Assistant", company: "Other Logistics", location: "Lund", url: "https://example.test/weaker", applyUrl: null, remote: "onsite", employmentType: "part-time", seniority: "entry", skills: ["Inventory"], description: "Maintain inventory." }),
]

function application(id: string, createdAt: string, overrides: Partial<ApplicationRecord> = {}): ApplicationRecord {
  const created = createApplication({ id, rankedJob: analyzeJobs(profile, jobs).rankedJobs[0], createdAt })
  if (!created.ok) throw new Error(created.error.message)
  return { ...created.value, notes: [{ text: "PRIVATE NOTE", createdAt }], ...overrides }
}

const evidence: CandidateDocumentEvidenceInput = { evidence: [{
  id: "experience",
  kind: "experience",
  content: "PRIVATE EVIDENCE coordinated schedules.",
  relatedRequirements: [{ category: "skill", value: "Scheduling" }],
}] }

describe("H2 CLI discovery presentation and orchestration", () => {
  it("shows every ranked job with one-based ranks, zero-based selection indexes, and the existing aggregate learning plan deterministically", async () => {
    let searchCalls = 0
    let analysisCalls = 0
    const result = await discoverAnalysis({ profile, search: { query: "logistics", adapters: [{ name: "must-not-run", search: async () => { throw new Error("network-like adapter activated") } }] } }, {
      searchJobs: async () => { searchCalls += 1; return { jobs, total: jobs.length, sourceStatus: [] } },
      analyzeJobs: (candidate, found) => { analysisCalls += 1; return analyzeJobs(candidate, found) },
    })
    const output = formatAnalysisDiscovery(result)
    expect(searchCalls).toBe(1)
    expect(analysisCalls).toBe(1)
    expect(output).toContain("Rank 1 | Select 0")
    expect(output).toContain("Rank 2 | Select 1")
    expect(output).toContain("Confidence:")
    expect(output).toContain("Source: fixture-a")
    expect(output).toContain("Gaps:")
    expect(output).toContain("Reason:")
    expect(output).toContain("Learning plan")
    for (const gap of result.analysis.learningPlan.prioritizedGaps) {
      expect(output).toContain(`Priority ${gap.priority} | ${gap.skill} | Severity: ${gap.severity} | Importance: ${gap.importance}`)
      expect(output).toContain(`Reason: ${gap.reason}`)
    }
    expect(formatAnalysisDiscovery(result)).toBe(output)
    expect(output).not.toContain("PRIVATE PROFILE")
    expect(output).not.toContain("OPENAI_API_KEY")
  })

  it("lists applications in repository order, handles an empty repository, and shows only approved metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "h2-applications-")); directories.push(directory)
    const repository = createFileApplicationRepository(join(directory, "applications.json"))
    const empty = await discoverApplicationList(repository)
    expect(empty).toEqual({ ok: true, value: [] })
    if (!empty.ok) throw new Error(empty.error.message)
    expect(formatApplicationList(empty.value)).toBe("No applications found.")

    const older = application("older", "2026-01-01T00:00:00.000Z")
    const newer = application("newer", "2026-02-01T00:00:00.000Z")
    await repository.create(older); await repository.create(newer)
    const listed = await discoverApplicationList(repository)
    if (!listed.ok) throw new Error(listed.error.message)
    expect(listed.value.map((item) => item.id)).toEqual(["newer", "older"])
    const listOutput = formatApplicationList(listed.value)
    expect(listOutput.indexOf("newer")).toBeLessThan(listOutput.indexOf("older"))
    expect(listOutput).not.toContain("PRIVATE NOTE")
    expect(listOutput).not.toContain("PRIVATE PROFILE")

    const found = await discoverApplication(repository, "newer")
    if (!found.ok) throw new Error(found.error.message)
    const shown = formatApplication(found.value)
    expect(shown).toContain("Application ID: newer")
    expect(shown).toContain("Saved rank:")
    expect(shown).toContain("Confidence:")
    expect(shown).toContain("Confirmed gaps:")
    expect(shown).not.toContain("PRIVATE NOTE")
    expect(shown).not.toContain("PRIVATE PROFILE")
    expect(await discoverApplication(repository, "missing")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } })
    expect(formatApplication(found.value)).toBe(shown)
  })

  it("lists every stable interview question in English and Swedish without sessions, private evidence, answers, keys, or providers", () => {
    const record = application("interview", "2026-01-01T00:00:00.000Z")
    const english = discoverInterviewQuestions({ application: record, documentEvidence: evidence, language: "en" })
    const swedish = discoverInterviewQuestions({ application: record, documentEvidence: evidence, language: "sv" })
    if (!english.ok || !swedish.ok) throw new Error("Expected valid interview plans")
    const englishOutput = formatInterviewQuestions(english.value)
    const swedishOutput = formatInterviewQuestions(swedish.value)
    expect(english.value.questions.length).toBeGreaterThan(1)
    for (const question of english.value.questions) expect(englishOutput).toContain(`Question ID: ${question.id}`)
    for (const question of swedish.value.questions) expect(swedishOutput).toContain(`Question ID: ${question.id}`)
    expect(englishOutput).toContain("Language: en")
    expect(swedishOutput).toContain("Language: sv")
    expect(englishOutput).not.toContain("PRIVATE EVIDENCE")
    expect(englishOutput).not.toContain("PRIVATE PROFILE")
    expect(englishOutput).not.toContain("PRIVATE ANSWER")
    expect(englishOutput).not.toContain("OPENAI_API_KEY")
    expect(englishOutput).not.toContain("Evidence ID")
    expect(formatInterviewQuestions(english.value)).toBe(englishOutput)
  })
})
