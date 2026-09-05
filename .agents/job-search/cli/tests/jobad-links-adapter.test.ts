import { beforeEach, describe, expect, test } from "bun:test"
import {
  createJobAdLinksAdapter,
  jobAdLinksHitToNormalizedJob,
} from "../src/jobad-links-adapter"
import { clearMunicipalityCacheForTests } from "../src/jobtech-taxonomy"

const sampleHit = {
  id: "bbaad15f1c2557981e0272f02265d52c",
  headline: "IT Support Engineer",
  brief: "Support users and maintain secure IT systems.",
  occupation_group: {
    label: "Supporttekniker, IT",
    concept_id: "hmaC_cfi_UKg",
  },
  occupation_field: {
    label: "Data/IT",
    concept_id: "apaJ_2ja_LuF",
  },
  employer: {
    name: "Nordic Air Defence AB",
  },
  workplace_addresses: [
    {
      municipality_concept_id: "KURg_KJF_Lwc",
      municipality: "Jönköping",
      region_concept_id: "MtbE_xWT_eMi",
      region: "Jönköpings län",
      country_concept_id: "i46j_HmG_v64",
      country: "Sverige",
    },
  ],
  publication_date: "2026-09-04T00:00:00",
  source_links: [
    {
      label: "arbetsformedlingen.se",
      url: "https://arbetsformedlingen.se/platsbanken/annonser/31354762",
    },
  ],
}

describe("JobAd Links adapter", () => {
  beforeEach(() => {
    clearMunicipalityCacheForTests()
  })

  test("normalizes a JobAd Links hit", () => {
    const job = jobAdLinksHitToNormalizedJob(sampleHit)

    expect(job).not.toBeNull()
    expect(job?.id).toBe("bbaad15f1c2557981e0272f02265d52c")
    expect(job?.title).toBe("IT Support Engineer")
    expect(job?.company).toBe("Nordic Air Defence AB")
    expect(job?.location).toBe("Jönköping")
    expect(job?.country).toBe("Sverige")
    expect(job?.source).toBe("jobadlinks")
    expect(job?.sourceId).toBe("bbaad15f1c2557981e0272f02265d52c")
    expect(job?.url).toBe(
      "https://arbetsformedlingen.se/platsbanken/annonser/31354762",
    )
    expect(job?.applyUrl).toBe(
      "https://arbetsformedlingen.se/platsbanken/annonser/31354762",
    )
    expect(job?.description).toBe(
      "Support users and maintain secure IT systems.",
    )
    expect(job?.category).toBe("Supporttekniker, IT")
  })

  test("preserves multiple unique workplace municipalities", () => {
    const job = jobAdLinksHitToNormalizedJob({
      ...sampleHit,
      workplace_addresses: [
        {
          municipality: "Stockholm",
          region: "Stockholms län",
          country: "Sverige",
        },
        {
          municipality: "Jönköping",
          region: "Jönköpings län",
          country: "Sverige",
        },
        {
          municipality: "Jönköping",
          region: "Jönköpings län",
          country: "Sverige",
        },
      ],
      source_links: [
        {
          label: "ingenjorsjobb.se",
          url: "https://ingenjorsjobb.se/jobs/example",
        },
        {
          label: "example.se",
          url: "https://example.se/jobs/example",
        },
      ],
    })

    expect(job).not.toBeNull()
    expect(job?.location).toBe("Stockholm, Jönköping")
    expect(job?.country).toBe("Sverige")
    expect(job?.url).toBe("https://ingenjorsjobb.se/jobs/example")
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
        JSON.stringify({
          total: { value: 1 },
          hits: [sampleHit],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )
    }

    const adapter = createJobAdLinksAdapter(
      fakeFetch as unknown as typeof fetch,
    )

    const result = await adapter.search({
      query: "IT support",
      location: "Jönköping",
      limit: 5,
    })

    expect(result.status).toBe("ok")
    expect(result.source).toBe("jobadlinks")
    expect(result.jobs).toHaveLength(1)
    expect(result.jobs[0]?.title).toBe("IT Support Engineer")
    expect(result.jobs[0]?.location).toBe("Jönköping")

    expect(requestedUrls).toHaveLength(2)

    const searchUrl = new URL(requestedUrls[1]!)
    expect(searchUrl.pathname).toBe("/joblinks")
    expect(searchUrl.searchParams.get("q")).toBe("IT support")
    expect(searchUrl.searchParams.get("municipality")).toBe("KURg_KJF_Lwc")
    expect(searchUrl.searchParams.get("limit")).toBe("5")
  })

  test("returns an error result for failed HTTP responses", async () => {
    const fakeFetch = async () => new Response("error", { status: 503 })

    const adapter = createJobAdLinksAdapter(
      fakeFetch as unknown as typeof fetch,
    )

    const result = await adapter.search({ query: "IT support" })

    expect(result.status).toBe("error")
    expect(result.jobs).toEqual([])
    expect(result.source).toBe("jobadlinks")
    expect(result.error).toContain("503")
  })

  test("ignores malformed hits", () => {
    expect(jobAdLinksHitToNormalizedJob(null)).toBeNull()
    expect(jobAdLinksHitToNormalizedJob({ id: "123" })).toBeNull()
    expect(
      jobAdLinksHitToNormalizedJob({ headline: "Missing id" }),
    ).toBeNull()
  })
})
