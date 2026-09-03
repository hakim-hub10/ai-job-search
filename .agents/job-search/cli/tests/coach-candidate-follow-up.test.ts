import { describe, expect, it } from "bun:test"
import {
  completeCandidateFollowUp,
  createCandidateFollowUp,
  deriveCandidateFollowUpState,
} from "../src/index"

const createdAt = "2026-01-01T00:00:00.000Z"
const dueAt = "2026-01-03T00:00:00.000Z"

function followUp(overrides: Record<string, unknown> = {}) {
  return { id: "follow-up-1", candidateId: "candidate-a", dueAt, createdAt, updatedAt: createdAt, ...overrides }
}

describe("Phase 6.3 candidate follow-up domain", () => {
  it("creates detached candidate-level and application-specific metadata", () => {
    const input = followUp({ applicationId: "application-1" })
    const result = createCandidateFollowUp(input)
    expect(result).toEqual({ ok: true, value: input })
    input.candidateId = "changed"
    expect(result.ok && result.value.candidateId).toBe("candidate-a")
  })

  it("derives open, overdue, and completed state from explicit asOf", () => {
    const open = createCandidateFollowUp(followUp())
    if (!open.ok) throw new Error(open.error.message)
    expect(deriveCandidateFollowUpState(open.value, "2026-01-02T00:00:00.000Z")).toEqual({ ok: true, value: "open" })
    expect(deriveCandidateFollowUpState(open.value, "2026-01-04T00:00:00.000Z")).toEqual({ ok: true, value: "overdue" })
    const completed = completeCandidateFollowUp(open.value, { completedAt: "2026-01-02T00:00:00.000Z" })
    expect(completed).toMatchObject({ ok: true, value: { completedAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" } })
    if (!completed.ok) throw new Error(completed.error.message)
    expect(deriveCandidateFollowUpState(completed.value, "2026-01-04T00:00:00.000Z")).toEqual({ ok: true, value: "completed" })
  })

  it("rejects malformed fields and invalid chronology without defaults", () => {
    expect(createCandidateFollowUp(undefined as never)).toMatchObject({ ok: false, error: { code: "MALFORMED_FOLLOW_UP_INPUT" } })
    expect(createCandidateFollowUp(followUp({ applicationId: " " }))).toMatchObject({ ok: false, error: { code: "INVALID_APPLICATION_ID" } })
    expect(createCandidateFollowUp(followUp({ dueAt: "tomorrow" }))).toMatchObject({ ok: false, error: { code: "INVALID_TIMESTAMP" } })
    expect(createCandidateFollowUp(followUp({ updatedAt: "2025-12-31T00:00:00.000Z" }))).toMatchObject({ ok: false, error: { code: "TIMESTAMP_OUT_OF_ORDER" } })
    const result = createCandidateFollowUp(followUp())
    if (!result.ok) throw new Error(result.error.message)
    expect(completeCandidateFollowUp(result.value, { completedAt: "2025-12-31T00:00:00.000Z" })).toMatchObject({ ok: false, error: { code: "TIMESTAMP_OUT_OF_ORDER" } })
  })
})