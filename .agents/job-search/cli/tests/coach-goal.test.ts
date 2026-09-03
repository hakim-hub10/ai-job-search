import { describe, expect, it } from "bun:test"
import { createCoachGoal, transitionCoachGoal, updateCoachGoal } from "../src/index"

const createdAt = "2026-01-01T00:00:00.000Z"
describe("Phase 7.1 coach goal domain", () => {
  it("uses explicit planned, in-progress, completed, and cancelled lifecycle", () => {
    const result = createCoachGoal({ id: "goal-1", candidateId: "candidate-a", title: "Apply to five relevant jobs", dueAt: "2026-02-01T00:00:00.000Z", createdAt })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.status).toBe("planned")
    const inProgress = transitionCoachGoal(result.value, { status: "inProgress", updatedAt: "2026-01-02T00:00:00.000Z" })
    if (!inProgress.ok) throw new Error(inProgress.error.message)
    const completed = transitionCoachGoal(inProgress.value, { status: "completed", updatedAt: "2026-01-03T00:00:00.000Z" })
    expect(completed).toMatchObject({ ok: true, value: { status: "completed", completedAt: "2026-01-03T00:00:00.000Z" } })
    const cancelled = transitionCoachGoal(result.value, { status: "cancelled", updatedAt: "2026-01-02T00:00:00.000Z" })
    expect(cancelled).toMatchObject({ ok: true, value: { status: "cancelled" } })
    if (cancelled.ok) expect("completedAt" in cancelled.value).toBe(false)
  })

  it("requires completion timestamps and prevents terminal transitions", () => {
    expect(createCoachGoal({ id: "goal-1", candidateId: "candidate-a", title: "Goal", createdAt })).toMatchObject({ ok: true, value: { status: "planned" } })
    const invalid = { id: "goal-1", candidateId: "candidate-a", title: "Goal", status: "completed", createdAt, updatedAt: createdAt }
    expect((transitionCoachGoal(invalid as never, { status: "inProgress", updatedAt: "2026-01-02T00:00:00.000Z" }))).toMatchObject({ ok: false })
    const result = createCoachGoal({ id: "goal-2", candidateId: "candidate-a", title: "Goal", createdAt })
    if (!result.ok) throw new Error(result.error.message)
    const completed = transitionCoachGoal(result.value, { status: "completed", updatedAt: "2026-01-02T00:00:00.000Z" })
    if (!completed.ok) throw new Error(completed.error.message)
    expect(transitionCoachGoal(completed.value, { status: "planned", updatedAt: "2026-01-03T00:00:00.000Z" })).toMatchObject({ ok: false, error: { code: "INVALID_TRANSITION" } })
    expect(updateCoachGoal(result.value, { title: " ", updatedAt: "2026-01-02T00:00:00.000Z" })).toMatchObject({ ok: false, error: { code: "EMPTY_GOAL_TITLE" } })
  })
})