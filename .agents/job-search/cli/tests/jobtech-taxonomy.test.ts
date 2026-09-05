import { beforeEach, describe, expect, test } from "bun:test"
import {
  clearMunicipalityCacheForTests,
  resolveMunicipalityConceptId,
} from "../src/jobtech-taxonomy"

describe("JobTech taxonomy municipality resolver", () => {
  beforeEach(() => {
    clearMunicipalityCacheForTests()
  })

  test("resolves municipality labels case-insensitively", async () => {
    let fetchCount = 0

    const fakeFetch = async () => {
      fetchCount += 1

      return new Response(
        JSON.stringify({
          data: {
            concepts: [
              {
                id: "KURg_KJF_Lwc",
                preferred_label: "Jönköping",
                type: "municipality",
              },
              {
                id: "not-a-municipality",
                preferred_label: "Jönköping",
                type: "region",
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

    const first = await resolveMunicipalityConceptId(
      "JÖNKÖPING",
      fakeFetch as unknown as typeof fetch,
    )

    const second = await resolveMunicipalityConceptId(
      " jönköping ",
      fakeFetch as unknown as typeof fetch,
    )

    expect(first).toBe("KURg_KJF_Lwc")
    expect(second).toBe("KURg_KJF_Lwc")
    expect(fetchCount).toBe(1)
  })

  test("shares one in-flight taxonomy request between concurrent lookups", async () => {
    let fetchCount = 0

    const fakeFetch = async () => {
      fetchCount += 1

      await Promise.resolve()

      return new Response(
        JSON.stringify({
          data: {
            concepts: [
              {
                id: "KURg_KJF_Lwc",
                preferred_label: "Jönköping",
                type: "municipality",
              },
              {
                id: "AvNB_uwa_6n6",
                preferred_label: "Stockholm",
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

    const [jonkoping, stockholm] = await Promise.all([
      resolveMunicipalityConceptId(
        "Jönköping",
        fakeFetch as unknown as typeof fetch,
      ),
      resolveMunicipalityConceptId(
        "Stockholm",
        fakeFetch as unknown as typeof fetch,
      ),
    ])

    expect(jonkoping).toBe("KURg_KJF_Lwc")
    expect(stockholm).toBe("AvNB_uwa_6n6")
    expect(fetchCount).toBe(1)
  })

  test("does not permanently cache a failed taxonomy request", async () => {
    let fetchCount = 0

    const fakeFetch = async () => {
      fetchCount += 1

      if (fetchCount === 1) {
        return new Response("temporary failure", { status: 503 })
      }

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

    const failed = await resolveMunicipalityConceptId(
      "Jönköping",
      fakeFetch as unknown as typeof fetch,
    )

    const recovered = await resolveMunicipalityConceptId(
      "Jönköping",
      fakeFetch as unknown as typeof fetch,
    )

    expect(failed).toBeNull()
    expect(recovered).toBe("KURg_KJF_Lwc")
    expect(fetchCount).toBe(2)
  })
})
