import { describe, expect, it } from "bun:test"
import {
  dedupeJobs,
  normalizeJob,
  searchJobs,
  type JobSourceAdapter,
  type NormalizedJob,
} from "../src/index"
import { createSourceAdapter } from "../src/adapters"

describe("normalizeJob", () => {
  it("maps source-specific fields into the shared model", () => {
    const job: NormalizedJob = normalizeJob({
      id: "linkedin-123",
      title: "IT Coordinator",
      company: "Example AB",
      location: "Jönköping, Sweden",
      country: "Sweden",
      url: "https://example.com/jobs/123",
      source: "linkedin",
      sourceId: "linkedin-123",
      applyUrl: "https://example.com/apply/123",
      date: "2026-08-30",
      employmentType: "full-time",
      remote: "hybrid",
      description: "Coordinate IT systems.",
      salary: "50000 SEK",
      skills: ["IT", "support"],
      seniority: "mid",
      category: "it",
    })

    expect(job.id).toBe("linkedin-123")
    expect(job.source).toBe("linkedin")
    expect(job.sourceId).toBe("linkedin-123")
    expect(job.location).toBe("Jönköping, Sweden")
    expect(job.country).toBe("Sweden")
    expect(job.remote).toBe("hybrid")
  })
})

describe("dedupeJobs", () => {
  const job = (id: string, overrides: Partial<NormalizedJob> = {}) => normalizeJob({
    id, title: "Operations Coordinator", company: "Example AB", location: "Malmö", source: "linkedin", sourceId: id,
    url: `https://example.test/jobs/${id}`, ...overrides,
  })

  it("deduplicates every existing exact identity while retaining the first record", () => {
    const first = job("first")
    const sameSourceId = job("other-id", { sourceId: "first", url: "https://other.test/source-id", title: "Different", company: "Other", location: "Lund" })
    const sameUrl = job("url-copy", { source: "jobindex", sourceId: "different", url: first.url, title: "Different", company: "Other", location: "Lund" })
    const sameTuple = job("tuple-copy", { source: "jobnet", sourceId: "another", url: "https://other.test/tuple", title: " operations   coordinator ", company: "EXAMPLE AB", location: " malmö " })
    expect(dedupeJobs([first, sameSourceId, sameUrl, sameTuple])).toEqual([first])
  })

  it("keeps unrelated and partial-identity vacancies distinct", () => {
    const first = job("first")
    const differentCompany = job("company", { source: "jobindex", title: first.title, company: "Other AB", location: first.location })
    const differentLocation = job("location", { source: "jobnet", title: first.title, company: first.company, location: "Lund" })
    const partialA = job("partial-a", { source: "jobbank", url: null, company: null, location: null })
    const partialB = job("partial-b", { source: "freehire", url: null, company: null, location: null })
    expect(dedupeJobs([first, differentCompany, differentLocation, partialA, partialB])).toEqual([first, differentCompany, differentLocation, partialA, partialB])
  })

  it("deduplicates without a URL through the exact tuple but scopes source IDs by source", () => {
    const first = job("first", { url: null })
    const tupleCopy = job("copy", { source: "jobindex", sourceId: "copy", url: null })
    const sameIdDifferentSource = job("same-id-other-source", { source: "jobnet", sourceId: "shared", url: null, title: "Nurse", company: "Clinic", location: "Lund" })
    const otherSource = job("other-source", { source: "jobbank", sourceId: "shared", url: null, title: "Planner", company: "Warehouse", location: "Aarhus" })
    expect(dedupeJobs([first, tupleCopy, sameIdDifferentSource, otherSource])).toEqual([first, sameIdDifferentSource, otherSource])
  })

  it("registers all keys and propagates exact transitive identity", () => {
    const a = job("a", { title: "Role A", company: "Company A", location: "Malmö", url: "https://example.test/shared" })
    const b = job("b", { source: "jobindex", title: "Bridge Role", company: "Bridge AB", location: "Lund", url: a.url })
    const c = job("c", { source: "jobnet", title: b.title, company: b.company, location: b.location, url: "https://example.test/third" })
    expect(dedupeJobs([a, b, c])).toEqual([a])
  })

  it("is deterministic, preserves first-seen ordering, and does not mutate inputs", () => {
    const first = job("first")
    const unique = job("unique", { title: "Warehouse Planner", company: "Other", location: "Lund" })
    const duplicate = job("duplicate", { source: "jobindex", sourceId: "different", url: first.url })
    const jobs = [first, unique, duplicate]
    const before = structuredClone(jobs)
    expect(dedupeJobs(jobs)).toEqual([first, unique])
    expect(dedupeJobs(jobs)).toEqual([first, unique])
    expect(jobs).toEqual(before)
  })
})

describe("source failures and malformed output", () => {
  it("does not pass unsupported location flags to the Jobnet adapter command", async () => {
    const adapter = createSourceAdapter(
      "jobnet",
      ["tests/fixtures/jobnet-argument-fixture.ts"],
      process.cwd(),
    )
    const result = await adapter.search({
      query: "IT Coordinator",
      location: "Jönköping, Sweden",
      jobage: 30,
      limit: 5,
    })

    expect(result.status).toBe("ok")
  })

  it("keeps successful sources working even when one fails", async () => {
    const failingAdapter: JobSourceAdapter = {
      name: "linkedin",
      search: async () => ({ jobs: [], status: "error", source: "linkedin", error: "boom" }),
    }
    const workingAdapter: JobSourceAdapter = {
      name: "jobindex",
      search: async () => ({
        jobs: [normalizeJob({
          id: "j1",
          title: "Systems Engineer",
          company: "Contoso",
          location: "Gothenburg",
          source: "jobindex",
          sourceId: "j1",
          url: "https://example.com/j1",
        })],
        status: "ok",
        source: "jobindex",
      }),
    }

    const result = await searchJobs({
      query: "systems engineer",
      adapters: [failingAdapter, workingAdapter],
      includeSourceStatus: true,
    })

    expect(result.jobs).toHaveLength(1)
    expect(result.sourceStatus).toHaveLength(2)
    expect(result.sourceStatus).toEqual([
      { source: "linkedin", status: "error", count: 0, error: "boom" },
      { source: "jobindex", status: "ok", count: 1, error: undefined },
    ])
    expect(result.jobs[0]).toMatchObject({
      id: "j1",
      source: "jobindex",
      sourceId: "j1",
      url: "https://example.com/j1",
    })
  })

  it("returns empty results when a source JSON payload is malformed", async () => {
    const malformedAdapter: JobSourceAdapter = {
      name: "freehire",
      search: async () => ({ jobs: [], status: "error", source: "freehire", error: "Unexpected token" }),
    }

    const result = await searchJobs({
      query: "IT",
      adapters: [malformedAdapter],
      includeSourceStatus: true,
    })

    expect(result.jobs).toHaveLength(0)
    expect(result.sourceStatus[0].status).toBe("error")
  })

  it("isolates a thrown adapter exception while retaining successful results", async () => {
    const throwingAdapter: JobSourceAdapter = {
      name: "jobnet",
      search: async () => { throw new Error("offline fixture exception") },
    }
    const workingAdapter: JobSourceAdapter = {
      name: "jobbank",
      search: async () => ({
        jobs: [normalizeJob({
          id: "safe-result",
          title: "Operations Coordinator",
          company: "Example employer",
          location: "Aarhus",
          source: "jobbank",
          sourceId: "safe-source-id",
          url: "https://example.com/safe-result",
        })],
        status: "ok",
        source: "jobbank",
      }),
    }

    const result = await searchJobs({
      adapters: [throwingAdapter, workingAdapter],
      includeSourceStatus: true,
    })

    expect(result.jobs).toHaveLength(1)
    expect(result.sourceStatus).toEqual([
      { source: "jobnet", status: "error", error: "offline fixture exception" },
      { source: "jobbank", status: "ok", count: 1, error: undefined },
    ])
  })

  it("deduplicates results returned by multiple successful adapters", async () => {
    const firstAdapter: JobSourceAdapter = {
      name: "linkedin",
      search: async () => ({
        jobs: [normalizeJob({
          id: "first",
          title: "Data Analyst",
          company: "Example employer",
          location: "Aarhus",
          source: "linkedin",
          sourceId: "same-source-id",
          url: "https://example.com/data-analyst",
        })],
        status: "ok",
        source: "linkedin",
      }),
    }
    const secondAdapter: JobSourceAdapter = {
      name: "jobindex",
      search: async () => ({
        jobs: [normalizeJob({
          id: "duplicate",
          title: "Data Analyst",
          company: "Example employer",
          location: "Aarhus",
          source: "linkedin",
          sourceId: "same-source-id",
          url: "https://example.com/data-analyst",
        })],
        status: "ok",
        source: "jobindex",
      }),
    }

    const result = await searchJobs({ adapters: [firstAdapter, secondAdapter], includeSourceStatus: true })

    expect(result.jobs).toHaveLength(1)
    expect(result.sourceStatus).toEqual([
      { source: "linkedin", status: "ok", count: 1, error: undefined },
      { source: "jobindex", status: "ok", count: 1, error: undefined },
    ])
  })
})
