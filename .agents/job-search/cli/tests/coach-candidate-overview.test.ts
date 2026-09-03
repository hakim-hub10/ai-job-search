import { describe, expect, it } from "bun:test"
import { createCandidateOverview } from "../src/index"
import type { ApplicationRecord } from "../src/applications"
import type { CandidateFollowUp } from "../src/coach-candidate-follow-up"
import type { CoachCandidate } from "../src/coach-workspace"

const candidate: CoachCandidate = { id: "candidate-a", displayName: "Alex", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }

function application(id: string, status: string, updatedAt: string): ApplicationRecord {
  return { id, status, createdAt: "2026-01-01T00:00:00.000Z", updatedAt, statusHistory: [{ status, timestamp: updatedAt }], notes: [{ text: "private", createdAt: updatedAt }] } as unknown as ApplicationRecord
}

function followUp(id: string, dueAt: string, createdAt: string, completedAt?: string): CandidateFollowUp {
  return { id, candidateId: candidate.id, dueAt, createdAt, updatedAt: completedAt ?? createdAt, ...(completedAt ? { completedAt } : {}) }
}

describe("Phase 6.4 candidate overview domain", () => {
  it("derives minimal application rows, progress, overdue follow-ups, and next action", () => {
    const result = createCandidateOverview({
      candidate,
      applications: [application("application-b", "applied", "2026-01-03T00:00:00.000Z"), application("application-a", "interview", "2026-01-04T00:00:00.000Z")],
      followUps: [followUp("later", "2026-01-05T00:00:00.000Z", "2026-01-01T00:00:00.000Z"), followUp("overdue", "2026-01-02T00:00:00.000Z", "2026-01-02T00:00:00.000Z"), followUp("completed", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z")],
      asOf: "2026-01-03T00:00:00.000Z",
    })
    expect(result).toMatchObject({
      ok: true,
      value: {
        candidate,
        applications: [
          { applicationId: "application-a", status: "interview", latestActivity: { applicationId: "application-a", kind: "status" } },
          { applicationId: "application-b", status: "applied" },
        ],
        progress: { applicationCount: 2, statusCounts: { interview: 1, applied: 1, offer: 0 } },
        overdueFollowUps: [{ id: "overdue", state: "overdue" }],
        nextFollowUp: { id: "overdue", state: "overdue" },
      },
    })
    if (result.ok) {
      expect(JSON.stringify(result.value.applications)).not.toContain("private")
      expect(Object.keys(result.value.applications[0]).sort()).toEqual(["applicationId", "createdAt", "latestActivity", "status", "updatedAt"])
    }
  })

  it("keeps equal follow-up due dates deterministic and returns detached output", () => {
    const result = createCandidateOverview({ candidate, applications: [], followUps: [followUp("b", "2026-01-02T00:00:00.000Z", "2026-01-02T00:00:00.000Z"), followUp("a", "2026-01-02T00:00:00.000Z", "2026-01-01T00:00:00.000Z")], asOf: "2026-01-01T00:00:00.000Z" })
    expect(result.ok && result.value.followUps.map((item) => item.id)).toEqual(["a", "b"])
    if (result.ok) {
      result.value.candidate.displayName = "changed"
      expect(candidate.displayName).toBe("Alex")
    }
  })
})