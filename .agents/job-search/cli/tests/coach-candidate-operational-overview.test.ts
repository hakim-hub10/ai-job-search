import { describe, expect, it } from "bun:test"
import { createCandidateOperationalOverview } from "../src/index"
import type { CandidateOverview } from "../src/coach-candidate-overview"
import type { CoachActivity } from "../src/coach-activity"
import type { CoachGoal } from "../src/coach-goal"
import type { CoachNote } from "../src/coach-note"
import type { CoachCandidate } from "../src/coach-workspace"

const candidate: CoachCandidate = { id: "candidate-a", displayName: "Alex", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
const overview = { candidate, applications: [], progress: {}, followUps: [], overdueFollowUps: [], nextFollowUp: null } as unknown as CandidateOverview
const note = (id: string, updatedAt: string): CoachNote => ({ id, candidateId: candidate.id, text: `PRIVATE ${id}`, createdAt: "2026-01-01T00:00:00.000Z", updatedAt })
const goal = (id: string, status: CoachGoal["status"], dueAt?: string): CoachGoal => ({ id, candidateId: candidate.id, title: id, status, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...(dueAt ? { dueAt } : {}), ...(status === "completed" ? { completedAt: "2026-01-02T00:00:00.000Z" } : {}) })
const activity = (id: string, status: CoachActivity["status"], plannedAt?: string): CoachActivity => ({ id, candidateId: candidate.id, kind: "coachingMeeting", status, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...(plannedAt ? { plannedAt } : {}) })

describe("Phase 7.2 operational overview domain", () => {
  it("derives goal/activity counts, overdue state, ordering, and next activity without note text", () => {
    const result = createCandidateOperationalOverview({
      candidate,
      overview,
      notes: [note("note-b", "2026-01-03T00:00:00.000Z"), note("note-a", "2026-01-02T00:00:00.000Z")],
      goals: [goal("completed", "completed", "2026-01-01T00:00:00.000Z"), goal("overdue", "inProgress", "2026-01-02T00:00:00.000Z"), goal("planned", "planned", "2026-01-04T00:00:00.000Z"), goal("cancelled", "cancelled", "2026-01-01T00:00:00.000Z")],
      activities: [activity("later", "planned", "2026-01-05T00:00:00.000Z"), activity("earlier", "planned", "2026-01-03T00:00:00.000Z"), activity("done", "completed", "2026-01-02T00:00:00.000Z"), activity("unplanned", "planned")],
      asOf: "2026-01-03T00:00:00.000Z",
    })
    expect(result).toMatchObject({ ok: true, value: { goalCounts: { planned: 1, inProgress: 1, completed: 1, cancelled: 1, overdue: 1 }, activityCounts: { planned: 3, completed: 1, cancelled: 0 }, nextPlannedActivity: { id: "earlier" } } })
    if (result.ok) {
      expect(result.value.notes[0]).toMatchObject({ id: "note-b", createdAt: "2026-01-01T00:00:00.000Z" })
      expect(result.value.notes[0]).not.toHaveProperty("text")
      expect(JSON.stringify(result.value)).not.toContain("PRIVATE")
      expect(result.value.goals.find((item) => item.id === "completed")?.overdue).toBe(false)
      expect(result.value.goals.find((item) => item.id === "cancelled")?.overdue).toBe(false)
    }
  })

  it("is deterministic and detached for empty operations and equal timestamps", () => {
    const input = { candidate, overview, notes: [note("b", "2026-01-01T00:00:00.000Z"), note("a", "2026-01-01T00:00:00.000Z")], goals: [], activities: [], asOf: "2026-01-01T00:00:00.000Z" }
    const first = createCandidateOperationalOverview(input)
    const second = createCandidateOperationalOverview(input)
    expect(first).toEqual(second)
    expect(first.ok && first.value.notes.map((item) => item.id)).toEqual(["a", "b"])
    if (first.ok) first.value.candidate.displayName = "changed"
    expect(candidate.displayName).toBe("Alex")
  })
})