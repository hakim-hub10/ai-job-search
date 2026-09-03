import { describe, expect, it } from "bun:test"
import { createCoachNote, updateCoachNote } from "../src/index"

const createdAt = "2026-01-01T00:00:00.000Z"
describe("Phase 7.1 coach note domain", () => {
  it("creates candidate-level notes and updates them immutably", () => {
    const result = createCoachNote({ id: "note-1", candidateId: "candidate-a", text: "Discuss CV structure", createdAt })
    expect(result).toEqual({ ok: true, value: { id: "note-1", candidateId: "candidate-a", text: "Discuss CV structure", createdAt, updatedAt: createdAt } })
    if (!result.ok) throw new Error(result.error.message)
    const updated = updateCoachNote(result.value, { text: "Discuss CV structure next meeting", updatedAt: "2026-01-02T00:00:00.000Z" })
    expect(updated).toMatchObject({ ok: true, value: { text: "Discuss CV structure next meeting", updatedAt: "2026-01-02T00:00:00.000Z" } })
    expect(result.value.text).toBe("Discuss CV structure")
    expect("applicationId" in result.value).toBe(false)
  })

  it("rejects empty text, invalid timestamps, and out-of-order updates", () => {
    expect(createCoachNote({ id: "note-1", candidateId: "candidate-a", text: " ", createdAt })).toMatchObject({ ok: false, error: { code: "EMPTY_NOTE" } })
    expect(createCoachNote({ id: "note-1", candidateId: "candidate-a", text: "text", createdAt: "tomorrow" })).toMatchObject({ ok: false, error: { code: "INVALID_TIMESTAMP" } })
    const result = createCoachNote({ id: "note-1", candidateId: "candidate-a", text: "text", createdAt })
    if (!result.ok) throw new Error(result.error.message)
    expect(updateCoachNote(result.value, { text: "new", updatedAt: "2025-12-31T00:00:00.000Z" })).toMatchObject({ ok: false, error: { code: "TIMESTAMP_OUT_OF_ORDER" } })
  })
})