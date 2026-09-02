import { describe, expect, it } from "bun:test"
import {
  createSearchRetrievalPlan,
  normalizeJob,
  retrieveSearchAwareJobs,
  searchJobs,
  type JobSourceAdapter,
  type NormalizedJob,
  type UnifiedSearchOptions,
} from "../src/index"

function job(id: string, title: string, source = "fixture", overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return normalizeJob({ id, source, sourceId: id, title, company: `Example ${id}`, location: "Anywhere", url: `https://example.test/${id}`, description: null, ...overrides })
}

function adapter(name: string, jobs: NormalizedJob[], calls: UnifiedSearchOptions[] = []): JobSourceAdapter {
  return {
    name,
    search: async (options) => {
      calls.push({ ...options })
      return { jobs: jobs.slice(0, options.limit), status: "ok", source: name }
    },
  }
}

describe("H7.1 retrieval plan", () => {
  it("uses bounded deterministic oversampling", () => {
    expect(createSearchRetrievalPlan(5)).toEqual({ visibleLimit: 5, retrievalLimit: 15, oversamplingApplied: true })
    expect(createSearchRetrievalPlan(10)).toEqual({ visibleLimit: 10, retrievalLimit: 30, oversamplingApplied: true })
    expect(createSearchRetrievalPlan(20)).toEqual({ visibleLimit: 20, retrievalLimit: 50, oversamplingApplied: true })
    expect(createSearchRetrievalPlan(50)).toEqual({ visibleLimit: 50, retrievalLimit: 50, oversamplingApplied: false })
    expect(createSearchRetrievalPlan(100)).toEqual({ visibleLimit: 100, retrievalLimit: 100, oversamplingApplied: false })
    expect(createSearchRetrievalPlan()).toEqual({ oversamplingApplied: false })
  })

  it("rejects invalid direct API limits", () => {
    for (const limit of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => createSearchRetrievalPlan(limit)).toThrow(RangeError)
  })
})

describe("H7.1 search-aware candidate pool", () => {
  it("finds a relevant single-source job after ten irrelevant results without mutating input", async () => {
    const calls: UnifiedSearchOptions[] = []
    const jobs = Array.from({ length: 10 }, (_, index) => job(`noise-${index}`, `Product Manager ${index}`, "freehire"))
    jobs.push(job("support", "IT Support Technician", "freehire"), job("desk", "Service Desk Technician", "freehire"))
    const source = adapter("freehire", jobs, calls)
    const search = { query: "IT Support", location: "Sweden", limit: 10, adapters: [source] }
    const before = { query: search.query, location: search.location, limit: search.limit, adapters: [...search.adapters] }
    const result = await retrieveSearchAwareJobs({ search, targetRoles: ["IT Support"] })
    expect(result).toMatchObject({ ok: true, value: { plan: { visibleLimit: 10, retrievalLimit: 30, oversamplingApplied: true } } })
    if (!result.ok) throw new Error(result.error.message)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ query: "IT Support", location: "Sweden", limit: 30, includeSourceStatus: true })
    expect(result.value.search.jobs).toHaveLength(12)
    expect(result.value.eligibleJobs.map((item) => item.id)).toEqual(["support", "desk"])
    expect(result.value.relevance.results.slice(0, 10).every((item) => item.tier === "irrelevant")).toBe(true)
    expect(search).toEqual(before)
  })

  it("keeps direct raw search limit semantics unchanged", async () => {
    const calls: UnifiedSearchOptions[] = []
    const source = adapter("fixture", Array.from({ length: 8 }, (_, index) => job(`job-${index}`, "IT Support Technician", "fixture")), calls)
    const raw = await searchJobs({ query: "IT Support", limit: 2, adapters: [source], includeSourceStatus: true })
    const aware = await retrieveSearchAwareJobs({ search: { query: "IT Support", limit: 2, adapters: [source] } })
    expect(raw.jobs).toHaveLength(2)
    expect(calls[0].limit).toBe(2)
    expect(calls[1].limit).toBe(6)
    expect(aware).toMatchObject({ ok: true, value: { plan: { visibleLimit: 2, retrievalLimit: 6 }, eligibleJobs: [{ id: "job-0" }, { id: "job-1" }] } })
  })

  it("caps eligible jobs and uses deterministic round-robin adapter and source order", async () => {
    const callsA: UnifiedSearchOptions[] = []
    const callsB: UnifiedSearchOptions[] = []
    const a = adapter("source-a", [job("a1", "Nurse", "source-a"), job("a2", "Nurse", "source-a"), job("a3", "Nurse", "source-a")], callsA)
    const b = adapter("source-b", [job("b1", "Nurse", "source-b"), job("b2", "Nurse", "source-b")], callsB)
    const first = await retrieveSearchAwareJobs({ search: { query: "Nurse", limit: 3, adapters: [a, b] } })
    const second = await retrieveSearchAwareJobs({ search: { query: "Nurse", limit: 3, adapters: [a, b] } })
    if (!first.ok || !second.ok) throw new Error("expected retrieval success")
    expect(callsA[0].limit).toBe(9)
    expect(callsB[0].limit).toBe(9)
    expect(first.value.eligibleJobs.map((item) => item.id)).toEqual(["a1", "b1", "a2"])
    expect(second.value.eligibleJobs).toEqual(first.value.eligibleJobs)
  })

  it("deduplicates across sources before relevance and visible selection", async () => {
    const shared = job("a-shared", "Accountant", "source-a", { url: "https://example.test/shared" })
    const duplicate = job("b-shared", "Accountant", "source-b", { url: "https://example.test/shared" })
    const result = await retrieveSearchAwareJobs({ search: { query: "Accountant", limit: 2, adapters: [adapter("source-a", [shared]), adapter("source-b", [duplicate, job("b2", "Accountant", "source-b")])] } })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.search.jobs.map((item) => item.id)).toEqual(["a-shared", "b2"])
    expect(result.value.eligibleJobs.map((item) => item.id)).toEqual(["a-shared", "b2"])
  })

  it("preserves successful sources when another fails and distinguishes all-source failure", async () => {
    const failing: JobSourceAdapter = { name: "failed", search: async () => ({ jobs: [], status: "error", source: "failed", error: "offline failure" }) }
    const working = adapter("working", [job("warehouse", "Warehouse Worker", "working")])
    const partial = await retrieveSearchAwareJobs({ search: { query: "Warehouse Worker", limit: 2, adapters: [failing, working] } })
    expect(partial).toMatchObject({ ok: true, value: { eligibleJobs: [{ id: "warehouse" }], search: { sourceStatus: [{ status: "error" }, { status: "ok" }] } } })
    const failed = await retrieveSearchAwareJobs({ search: { query: "Warehouse Worker", limit: 2, adapters: [failing] } })
    expect(failed).toMatchObject({ ok: false, error: { code: "ALL_SOURCES_FAILED" }, search: { sourceStatus: [{ status: "error", error: "offline failure" }] } })
  })

  it("preserves source defaults without a visible limit and keeps strong/related only", async () => {
    const calls: UnifiedSearchOptions[] = []
    const source = adapter("fixture", [
      job("strong", "IT Support Specialist"),
      job("related", "Help Desk Analyst"),
      job("uncertain", "Project Manager", "fixture", { description: "Responsible for IT support." }),
      job("irrelevant", "Marketing Coordinator"),
    ], calls)
    const result = await retrieveSearchAwareJobs({ search: { query: "IT Support", adapters: [source] } })
    if (!result.ok) throw new Error(result.error.message)
    expect(calls[0].limit).toBeUndefined()
    expect(result.value.plan).toEqual({ oversamplingApplied: false })
    expect(result.value.eligibleJobs.map((item) => item.id)).toEqual(["strong", "related"])
    expect(result.value.relevance.excludedJobs.map((item) => item.relevance.tier)).toEqual(["uncertain", "irrelevant"])
  })

  it("composes the same mechanics for domain-neutral role intents", async () => {
    for (const query of ["Operations Coordinator", "Registered Nurse", "Accountant", "Warehouse Worker", "Retail Manager", "Administrative Assistant", "Marketing Coordinator"]) {
      const result = await retrieveSearchAwareJobs({ search: { query, limit: 1, adapters: [adapter("fixture", [job(query, query)])] } })
      expect(result).toMatchObject({ ok: true, value: { eligibleJobs: [{ title: query }] } })
    }
  })

  it("does not let unrelated target roles override the explicit query", async () => {
    const result = await retrieveSearchAwareJobs({ search: { query: "IT Support", limit: 2, adapters: [adapter("fixture", [job("profile-role", "Operations Coordinator")])] }, targetRoles: ["Operations Coordinator"] })
    expect(result).toMatchObject({ ok: true, value: { eligibleJobs: [], relevance: { excludedJobs: [{ relevance: { tier: "irrelevant" } }] } } })
  })
})
