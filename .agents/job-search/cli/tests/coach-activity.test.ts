import { describe, expect, it } from "bun:test"
import { createCoachActivity, transitionCoachActivity, updateCoachActivity } from "../src/index"

const createdAt = "2026-01-01T00:00:00.000Z"
describe("Phase 7.1 coach activity domain", () => {
  it("supports planned, completed, and cancelled operational activities", () => {
    const result = createCoachActivity({ id: "activity-1", candidateId: "candidate-a", kind: "applyForJob", plannedAt: "2026-01-03T00:00:00.000Z", applicationId: "application-1", createdAt })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.status).toBe("planned")
    const completed = transitionCoachActivity(result.value, { status: "completed", updatedAt: "2026-01-04T00:00:00.000Z" })
    expect(completed).toMatchObject({ ok: true, value: { completedAt: "2026-01-04T00:00:00.000Z", status: "completed" } })
    const cancelled = transitionCoachActivity(result.value, { status: "cancelled", updatedAt: "2026-01-02T00:00:00.000Z" })
    expect(cancelled).toMatchObject({ ok: true, value: { status: "cancelled" } })
    if (cancelled.ok) expect("completedAt" in cancelled.value).toBe(false)
  })

  it("validates kinds, timestamps, terminal states, and never adds application data", () => {
    expect(createCoachActivity({ id: "activity-1", candidateId: "candidate-a", kind: "unknown" as never, createdAt })).toMatchObject({ ok: false, error: { code: "INVALID_KIND" } })
    const result = createCoachActivity({ id: "activity-1", candidateId: "candidate-a", kind: "updateCv", createdAt })
    if (!result.ok) throw new Error(result.error.message)
    expect(updateCoachActivity(result.value, { plannedAt: "bad", updatedAt: createdAt })).toMatchObject({ ok: false, error: { code: "INVALID_TIMESTAMP" } })
    expect(Object.keys(result.value).sort()).toEqual(["candidateId", "createdAt", "id", "kind", "status", "updatedAt"])
  })
})