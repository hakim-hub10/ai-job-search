import { describe, expect, it } from "bun:test"
import { registerBuiltInSourceAdapters, searchJobs } from "../src/index"

const liveIt = process.env.LIVE_TESTS === "1" ? it : it.skip

describe("live built-in source adapters", () => {
  liveIt("validates Jobnet provider behavior", async () => {
    const result = await registerBuiltInSourceAdapters().jobnet.search({
      query: "IT Coordinator",
      location: "Jönköping, Sweden",
      jobage: 30,
      limit: 5,
    })

    expect(result.status, result.error ?? "Jobnet returned a non-ok status without a diagnostic").toBe("ok")
  })

  liveIt("validates LinkedIn and Jobindex configured-source attribution", async () => {
    const adapterMap = registerBuiltInSourceAdapters()
    const result = await searchJobs({
      query: "IT Coordinator",
      location: "Jönköping, Sweden",
      jobage: 30,
      limit: 10,
      adapters: [adapterMap.linkedin, adapterMap.jobindex],
      includeSourceStatus: true,
    })

    expect(result.sourceStatus.map((status) => status.source)).toEqual(["linkedin", "jobindex"])
    for (const status of result.sourceStatus) {
      expect(status.status, status.error ?? `${status.source} returned a non-ok status without a diagnostic`).toBe("ok")
    }
  })
})
