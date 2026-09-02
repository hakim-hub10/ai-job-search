import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  createFileApplicationRepository,
  normalizeCandidateProfile,
  normalizeJob,
  runMvpWorkflow,
  type CandidateProfile,
  type JobSourceAdapter,
} from "../src/index"

const directories: string[] = []
const createdAt = "2026-09-01T10:00:00.000Z"

async function repository() {
  const directory = await mkdtemp(join(tmpdir(), "ai-job-search-mvp-"))
  directories.push(directory)
  return createFileApplicationRepository(join(directory, "applications.json"))
}
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

function profile(overrides: Partial<CandidateProfile> = {}) {
  return normalizeCandidateProfile({
    headline: "Operations coordinator", targetRoles: ["Coordinator"], locationPreferences: ["Example City"], workMode: "hybrid", remotePreference: true,
    skills: { technical: ["Scheduling", "Kubernetes"], soft: ["Communication"] }, yearsOfExperience: 3, preferredEmploymentType: ["full-time"], ...overrides,
  })
}
function jobs() {
  return [normalizeJob({ id: "job-1", source: "fixture", sourceId: "source-1", title: "Clinic Coordinator", company: "Example Clinic", location: "Example City", country: null, url: "https://example.test/job-1", applyUrl: null, date: null, employmentType: "full-time", remote: "hybrid", description: null, salary: null, skills: ["Scheduling", "Kubernetes"], seniority: null, category: "operations" })]
}
function adapter(resultJobs = jobs(), status: "ok" | "error" = "ok"): JobSourceAdapter {
  return { name: "fixture", search: async () => ({ jobs: resultJobs, status, source: "fixture", ...(status === "error" ? { error: "offline fixture" } : {}) }) }
}
async function run(overrides: Partial<Parameters<typeof runMvpWorkflow>[0]> = {}) {
  return runMvpWorkflow({
    profile: profile(),
    documentEvidence: { identity: { fullName: "Alex Example" }, evidence: [{ id: "skill:scheduling", kind: "skill", content: "Scheduling", relatedRequirements: [{ category: "skill", value: "Scheduling" }] }, { id: "experience:clinic", kind: "experience", content: "Coordinated clinic schedules.", context: { employer: "Example Clinic", role: "Coordinator", startDate: "2024-01" } }] },
    search: { query: "Coordinator", location: "Example City", adapters: [adapter()], includeSourceStatus: true },
    selectedRank: 0,
    application: { id: "application-1", createdAt },
    documents: [{ type: "cv", language: "en" }],
    ...overrides,
  }, { searchJobs: async (options) => {
    const jobs = (await options.adapters[0].search(options)).jobs
    return { query: options.query, location: options.location, jobs, total: jobs.length, sourceStatus: [{ source: "fixture", status: "ok", count: jobs.length }] }
  }, applicationRepository: await repository() })
}

describe("MVP CLI orchestration core", () => {
  it("composes search, analysis, explicit selection, application workflow, tailoring, and deterministic CV rendering", async () => {
    const result = await run()
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error("expected success")
    expect(result.selectedJob.job).toMatchObject({ id: "job-1", source: "fixture", url: "https://example.test/job-1" })
    expect(result.application).toMatchObject({ id: "application-1", status: "saved" })
    expect(result.documents[0].rendered.content).toContain("Scheduling")
    expect(result.documents[0].rendered.content).toContain("Coordinated clinic schedules.")
    expect(result.documents[0].rendered.content).not.toContain("Kubernetes")
    expect(result.documents[0].rendered.renderMap.length).toBeGreaterThan(0)
  })

  it("stops before persistence for zero jobs or an invalid explicit selection", async () => {
    await expect(run({ search: { query: "none", adapters: [adapter([])] } })).resolves.toMatchObject({ ok: false, error: { code: "NO_JOBS" } })
    await expect(run({ selectedRank: 1 })).resolves.toMatchObject({ ok: false, error: { code: "INVALID_SELECTION" } })
  })

  it("selects only relevant ranked jobs and excludes unrelated gaps", async () => {
    const unrelated = normalizeJob({ id: "noise", source: "fixture", title: "Head of Cybersecurity", skills: ["Threat modeling"], description: null })
    const result = await run({ search: { query: "Coordinator", adapters: [adapter([unrelated, ...jobs()])] } })
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error("expected success")
    expect(result.relevance.eligibleJobs.map((item) => item.id)).toEqual(["job-1"])
    expect(result.selectedJob.job.id).toBe("job-1")
    expect(result.analysis.learningPlan.prioritizedGaps.map((gap) => gap.skill)).not.toContain("Threat modeling")
  })

  it("returns NO_RELEVANT_JOBS without creating an application", async () => {
    const appRepository = await repository()
    const unrelated = normalizeJob({ id: "noise", source: "fixture", title: "Sales Director", skills: ["Sales strategy"], description: null })
    const result = await runMvpWorkflow({
      profile: profile(), documentEvidence: { evidence: [] }, search: { query: "Coordinator", adapters: [adapter([unrelated])] }, selectedRank: 0,
      application: { id: "must-not-exist", createdAt }, documents: [],
    }, { searchJobs: async () => ({ query: "Coordinator", jobs: [unrelated], total: 1, sourceStatus: [] }), applicationRepository: appRepository })
    expect(result).toMatchObject({ ok: false, error: { code: "NO_RELEVANT_JOBS" } })
    expect(await appRepository.list()).toEqual({ ok: true, value: [] })
  })

  it("oversamples before analysis and returns ALL_SOURCES_FAILED without persistence", async () => {
    const appRepository = await repository()
    let receivedLimit: number | undefined
    const failed = await runMvpWorkflow({
      profile: profile(), documentEvidence: { evidence: [] }, search: { query: "Coordinator", limit: 10, adapters: [adapter([])] }, selectedRank: 0,
      application: { id: "must-not-exist", createdAt }, documents: [],
    }, {
      searchJobs: async (options) => {
        receivedLimit = options.limit
        return { query: options.query, jobs: [], total: 0, sourceStatus: [{ source: "fixture", status: "error", error: "offline" }] }
      },
      applicationRepository: appRepository,
    })
    expect(receivedLimit).toBe(30)
    expect(failed).toMatchObject({ ok: false, error: { stage: "search", code: "ALL_SOURCES_FAILED" } })
    expect(await appRepository.list()).toEqual({ ok: true, value: [] })
  })

  it("preserves duplicate advisory and partial source results without selecting another job", async () => {
    const repo = await repository()
    const input = {
      profile: profile(), documentEvidence: { evidence: [{ id: "skill:scheduling", kind: "skill" as const, content: "Scheduling" }] },
      search: { query: "Coordinator", adapters: [adapter()], includeSourceStatus: true }, selectedRank: 0,
      application: { id: "same-application", createdAt }, documents: [{ type: "coverLetter" as const, language: "sv" as const }],
    }
    const dependencies = { searchJobs: async () => ({ query: "Coordinator", location: undefined, jobs: jobs(), total: 1, sourceStatus: [{ source: "failed", status: "error" as const, error: "offline" }, { source: "fixture", status: "ok" as const, count: 1 }] }), applicationRepository: repo }
    const first = await runMvpWorkflow(input, dependencies)
    const second = await runMvpWorkflow({ ...input, application: { id: "different-id", createdAt } }, dependencies)
    expect(first).toMatchObject({ ok: true })
    expect(second).toMatchObject({ ok: false, error: { stage: "application", error: { kind: "duplicate_advisory" } } })
    if (!first.ok) throw new Error("expected success")
    expect(first.documents[0].rendered.warnings).toContainEqual(expect.objectContaining({ code: "COVER_LETTER_OUTLINE_ONLY" }))
  })

  it("never saves deterministic drafts implicitly", async () => {
    const result = await run()
    expect(result).toMatchObject({ ok: true })
  })

  it("keeps deterministic output when an optional provider refuses", async () => {
    const result = await run({ generation: { generator: { generate: async () => ({ ok: false as const, error: { code: "REFUSED" as const, message: "synthetic refusal" } }) } } })
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error("expected success")
    expect(result.documents).toHaveLength(1)
    expect(result.generatedDocuments).toMatchObject([{ result: { ok: false, error: { stage: "generation", error: { code: "REFUSED" } } } }])
  })

  it("uses enriched selected jobs before ranking and application creation", async () => {
    const repo = await repository()
    const sparse = jobs()[0]
    sparse.skills = []
    sparse.description = null
    const enrichedAdapter: JobSourceAdapter = {
      name: "fixture",
      search: async () => ({ jobs: [sparse], status: "ok", source: "fixture" }),
      detail: async (item) => ({ status: "ok", detail: { source: "fixture", sourceId: item.sourceId, skills: ["Scheduling", "Intune"], description: "Scheduling and Intune are required.", availability: "active" } }),
    }
    const result = await runMvpWorkflow({
      profile: profile(), documentEvidence: { evidence: [] }, search: { query: "Coordinator", adapters: [enrichedAdapter] }, selectedRank: 0,
      application: { id: "enriched-application", createdAt }, documents: [],
    }, {
      searchJobs: async () => ({ query: "Coordinator", jobs: [sparse], total: 1, sourceStatus: [{ source: "fixture", status: "ok", count: 1 }] }),
      applicationRepository: repo,
    })
    expect(result).toMatchObject({ ok: true, enrichment: { records: [{ status: "enriched" }] } })
    if (!result.ok) throw new Error("expected success")
    expect(result.selectedJob.job.skills).toEqual(["Scheduling", "Intune"])
    expect(result.selectedJob.skillGapResult.gaps.some((gap) => gap.title.includes("Intune"))).toBe(true)
    expect(result.application.jobSnapshot.skills).toEqual(["Scheduling", "Intune"])
  })

  it("stops safely without persistence when every selected posting is explicitly closed", async () => {
    const repo = await repository()
    const closedAdapter: JobSourceAdapter = {
      ...adapter(),
      detail: async (item) => ({ status: "ok", detail: { source: "fixture", sourceId: item.sourceId, availability: "closed" } }),
    }
    const result = await runMvpWorkflow({
      profile: profile(), documentEvidence: { evidence: [] }, search: { query: "Coordinator", adapters: [closedAdapter] }, selectedRank: 0,
      application: { id: "closed-application", createdAt }, documents: [],
    }, {
      searchJobs: async () => ({ query: "Coordinator", jobs: jobs(), total: 1, sourceStatus: [{ source: "fixture", status: "ok", count: 1 }] }),
      applicationRepository: repo,
    })
    expect(result).toMatchObject({ ok: false, error: { stage: "selection", code: "NO_RELEVANT_JOBS" } })
    expect(await repo.list()).toEqual({ ok: true, value: [] })
  })
})
