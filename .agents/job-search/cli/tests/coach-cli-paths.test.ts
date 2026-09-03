import { describe, expect, it } from "bun:test"
import { resolveCoachRepositoryPaths } from "../src/index"

describe("Phase 7.3 coach CLI paths", () => {
  it("resolves the four coach repositories deterministically", () => {
    expect(resolveCoachRepositoryPaths("coach-data")).toEqual({
      candidates: "coach-data/candidates.json",
      associations: "coach-data/associations.json",
      followUps: "coach-data/follow-ups.json",
      operations: "coach-data/operations.json",
    })
  })
})