import { beforeEach, describe, expect, test } from "bun:test"
import {
  createJobTechAdapter,
  jobTechHitToNormalizedJob,
} from "../src/jobtech-adapter"
import { clearMunicipalityCacheForTests } from "../src/jobtech-taxonomy"

const sampleHit = {
  id: "31354762",
  webpage_url: "https://arbetsformedlingen.se/platsbanken/annonser/31354762",
  headline: "IT Support Engineer",
  description: {
    text: "Support users and maintain secure IT systems.",
  },
  employment_type: {
    label: "Tillsvidareanställning",
  },
  employer: {
    name: "Nordic Air Defence AB",
  },
  application_details: {
    url: "https://example.com/apply",
  },
  occupation: {
    label: "IT-tekniker",
  },
  workplace_model: {
    label: "Arbete på plats",
  },
  workplace_address: {
    municipality: "Solna",
    region: "Stockholms län",
    country: "Sverige",
    city: "SOLNA",
  },
  publication_date: "2026-08-14T14:27:45",
  salary_description: null,
}

describe("JobTech adapter", () => {
  beforeEach(() => {
    clearMunicipalityCacheForTests()
  })

  test("normalizes a JobTech hit", () => {
    const job = jobTechHitToNormalizedJob(sampleHit)

    expect(job).not.toBeNull()
    expect(job?.id).toBe("31354762")
    expect(job?.title).toBe("IT Support Engineer")
    expect(job?.company).toBe("Nordic Air Defence AB")
    expect(job?.location).toBe("Solna")
    expect(job?.country).toBe("Sverige")
    expect(job?.source).toBe("jobtech")
    expect(job?.sourceId).toBe("31354762")
    expect(job?.applyUrl).toBe("https://example.com/apply")
    expect(job?.employmentType).toBe("Tillsvidareanställning")
    expect(job?.remote).toBe("Arbete på plats")
    expect(job?.category).toBe("IT-tekniker")
  })

  test("search resolves municipality and maps API hits without network access", async () => {
    const requestedUrls: string[] = []

    const fakeFetch = async (input: RequestInfo | URL) => {
      const requestedUrl = String(input)
      requestedUrls.push(requestedUrl)

      if (requestedUrl.includes("all-concepts.json")) {
        return new Response(
          JSON.stringify({
            data: {
              concepts: [
                {
                  id: "KURg_KJF_Lwc",
                  preferred_label: "Jönköping",
                  type: "municipality",
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        )
      }

      return new Response(
        JSON.stringify({ hits: [sampleHit] }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )
    }

    const adapter = createJobTechAdapter(fakeFetch as unknown as typeof fetch)

    const result = await adapter.search({
      query: "IT support",
      location: "Jönköping",
      limit: 5,
    })

    expect(result.status).toBe("ok")
    expect(result.source).toBe("jobtech")
    expect(result.jobs).toHaveLength(1)
    expect(result.jobs[0]?.title).toBe("IT Support Engineer")

    expect(requestedUrls).toHaveLength(2)

    const searchUrl = new URL(requestedUrls[1]!)
    expect(searchUrl.searchParams.get("q")).toBe("IT support")
    expect(searchUrl.searchParams.get("municipality")).toBe("KURg_KJF_Lwc")
    expect(searchUrl.searchParams.get("limit")).toBe("5")
  })

  test("returns an error result for failed HTTP responses", async () => {
    const fakeFetch = async () => new Response("error", { status: 503 })

    const adapter = createJobTechAdapter(fakeFetch as unknown as typeof fetch)
    const result = await adapter.search({ query: "IT support" })

    expect(result.status).toBe("error")
    expect(result.jobs).toEqual([])
    expect(result.source).toBe("jobtech")
    expect(result.error).toContain("503")
  })

  test("ignores malformed hits", () => {
    expect(jobTechHitToNormalizedJob(null)).toBeNull()
    expect(jobTechHitToNormalizedJob({ id: "123" })).toBeNull()
    expect(jobTechHitToNormalizedJob({ headline: "Missing id" })).toBeNull()
  })
})
