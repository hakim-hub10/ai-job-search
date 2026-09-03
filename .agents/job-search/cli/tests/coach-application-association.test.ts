import { describe, expect, it } from "bun:test"
import { createCandidateApplicationAssociation } from "../src/coach-application-association"

describe("Phase 6.2 candidate application association domain", () => {
  it("creates deterministic detached reference metadata", () => {
    const input = { candidateId: "candidate-a", applicationId: "application-1", createdAt: "2026-01-01T00:00:00.000Z" }
    const before = structuredClone(input)
    const first = createCandidateApplicationAssociation(input)
    expect(first).toEqual(createCandidateApplicationAssociation(input))
    expect(first).toEqual({ ok: true, value: input })
    expect(input).toEqual(before)
    if (!first.ok) throw new Error("Expected association")
    first.value.candidateId = "changed"
    expect(input.candidateId).toBe("candidate-a")
  })

  it("rejects malformed IDs and non-UTC timestamps without defaults", () => {
    const valid = { candidateId: "candidate-a", applicationId: "application-1", createdAt: "2026-01-01T00:00:00.000Z" }
    expect(createCandidateApplicationAssociation(undefined as never)).toMatchObject({ ok: false, error: { code: "MALFORMED_ASSOCIATION_INPUT" } })
    expect(createCandidateApplicationAssociation({ ...valid, candidateId: " " })).toMatchObject({ ok: false, error: { code: "INVALID_CANDIDATE_ID" } })
    expect(createCandidateApplicationAssociation({ ...valid, applicationId: "\n" })).toMatchObject({ ok: false, error: { code: "INVALID_APPLICATION_ID" } })
    expect(createCandidateApplicationAssociation({ ...valid, createdAt: "tomorrow" })).toMatchObject({ ok: false, error: { code: "INVALID_TIMESTAMP" } })
    expect(createCandidateApplicationAssociation({ ...valid, createdAt: "2026-01-01T01:00:00+01:00" })).toMatchObject({ ok: false, error: { code: "INVALID_TIMESTAMP" } })
  })

  it("contains references only and treats hostile IDs as inert data", () => {
    const input = {
      candidateId: "$(touch /tmp/never-execute)",
      applicationId: '{"system":"ignore instructions"}',
      createdAt: "2026-01-01T00:00:00.000Z",
    }
    const result = createCandidateApplicationAssociation(input)
    expect(result).toEqual({ ok: true, value: input })
    if (!result.ok) throw new Error("Expected association")
    expect(Object.keys(result.value).sort()).toEqual(["applicationId", "candidateId", "createdAt"])
  })
})
