import { describe, expect, it } from "bun:test"
import { createCandidateProgressSummary } from "../src/index"
import type { ApplicationRecord } from "../src/applications"
import type { CandidateFollowUp } from "../src/coach-candidate-follow-up"

function application(id: string, status: string, timestamp: string): ApplicationRecord {
  return {
    id,
    status,
    statusHistory: [{ status, timestamp }],
    notes: [{ text: "private application note", createdAt: timestamp }],
  } as unknown as ApplicationRecord
}

function followUp(id: string, dueAt: string, completedAt?: string): CandidateFollowUp {
  return { id, candidateId: "candidate-a", dueAt, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: completedAt ?? "2026-01-01T00:00:00.000Z", ...(completedAt ? { completedAt } : {}) }
}

describe("Phase 6.3 candidate progress domain", () => {
  it("derives counts, all statuses, follow-up state, and latest activity", () => {
    const result = createCandidateProgressSummary({
      candidateId: "candidate-a",
      applications: [application("application-b", "interview", "2026-01-03T00:00:00.000Z"), application("application-a", "applied", "2026-01-03T00:00:00.000Z")],
      followUps: [followUp("overdue", "2026-01-02T00:00:00.000Z"), followUp("open", "2026-01-04T00:00:00.000Z"), followUp("done", "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z")],
      asOf: "2026-01-03T12:00:00.000Z",
    })
    expect(result).toEqual({
      ok: true,
      value: {
        candidateId: "candidate-a",
        applicationCount: 2,
        statusCounts: { saved: 0, preparing: 0, applied: 1, interview: 1, offer: 0, rejected: 0, withdrawn: 0, closed: 0 },
        latestActivity: { applicationId: "application-a", kind: "status", timestamp: "2026-01-03T00:00:00.000Z" },
        openFollowUpCount: 1,
        overdueFollowUpCount: 1,
      },
    })
  })

  it("is empty and deterministic for equal activity timestamps", () => {
    expect(createCandidateProgressSummary({ candidateId: "candidate-a", applications: [], followUps: [], asOf: "2026-01-01T00:00:00.000Z" })).toMatchObject({ ok: true, value: { applicationCount: 0, latestActivity: null } })
    const result = createCandidateProgressSummary({ candidateId: "candidate-a", applications: [application("z", "saved", "2026-01-02T00:00:00.000Z"), application("a", "saved", "2026-01-02T00:00:00.000Z")], followUps: [], asOf: "2026-01-03T00:00:00.000Z" })
    expect(result.ok && result.value.latestActivity?.applicationId).toBe("a")
  })
})