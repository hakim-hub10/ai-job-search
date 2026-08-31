import { describe, expect, it } from "bun:test"
import {
  dedupeJobs,
  normalizeJob,
  registerBuiltInSourceAdapters,
  searchJobs,
  type JobSourceAdapter,
  type NormalizedJob,
} from "../src/index"

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
  it("keeps distinct source IDs from different sources but strips true duplicates", () => {
    const jobs = [
      normalizeJob({
        id: "a",
        title: "DevOps Engineer",
        company: "Acme",
        location: "Stockholm, Sweden",
        source: "linkedin",
        sourceId: "job-42",
        url: "https://example.com/a",
      }),
      normalizeJob({
        id: "b",
        title: "DevOps Engineer",
        company: "Acme",
        location: "Stockholm, Sweden",
        source: "jobindex",
        sourceId: "job-42",
        url: "https://example.com/a",
      }),
      normalizeJob({
        id: "c",
        title: "DevOps Engineer",
        company: "Acme",
        location: "Stockholm, Sweden",
        source: "linkedin",
        sourceId: "job-42",
        url: "https://example.com/a",
      }),
    ]

    expect(dedupeJobs(jobs)).toHaveLength(2)
  })
})

describe("source failures and malformed output", () => {
  it("does not invent unsupported location flags for source CLIs", async () => {
    const adapter = registerBuiltInSourceAdapters().jobnet
    const result = await adapter.search({
      query: "IT Coordinator",
      location: "Jönköping, Sweden",
      jobage: 30,
      limit: 5,
    })

    expect(result.status).toBe("ok")
    if (result.error) {
      expect(result.error).not.toContain("municipality")
    }
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
    expect(result.sourceStatus[0].status).toBe("error")
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
})

describe("searchJobs", () => {
  it("runs all configured sources and preserves source attribution", async () => {
    const adapterMap = registerBuiltInSourceAdapters()
    const result = await searchJobs({
      query: "IT Coordinator",
      location: "Jönköping, Sweden",
      jobage: 30,
      limit: 10,
      adapters: [adapterMap.linkedin, adapterMap.jobindex],
      includeSourceStatus: true,
    })

    expect(result.jobs.length).toBeGreaterThanOrEqual(0)
    expect(result.sourceStatus.length).toBeGreaterThanOrEqual(2)
    expect(result.sourceStatus.some((s) => s.source === "linkedin" || s.source === "jobindex")).toBe(true)
  })
})
