import { describe, expect, it } from "bun:test"
import { createCandidateActivityReport } from "../src/index"
import type { ApplicationRecord } from "../src/applications"
import type { CoachActivity } from "../src/coach-activity"
import type { CandidateFollowUp } from "../src/coach-candidate-follow-up"

const startAt = "2026-01-01T00:00:00.000Z"
const endAt = "2026-02-01T00:00:00.000Z"

function application(id: string, createdAt = "2026-01-10T00:00:00.000Z"): ApplicationRecord {
  return {
    id,
    status: "applied",
    createdAt,
    statusHistory: [
      { status: "saved", timestamp: createdAt },
      { status: "applied", timestamp: "2026-01-11T00:00:00.000Z" },
    ],
  } as unknown as ApplicationRecord
}

function followUp(id: string, overrides: Partial<CandidateFollowUp> = {}): CandidateFollowUp {
  return {
    id,
    candidateId: "candidate-a",
    dueAt: "2026-01-20T00:00:00.000Z",
    createdAt: "2026-01-12T00:00:00.000Z",
    updatedAt: "2026-01-12T00:00:00.000Z",
    ...overrides,
  }
}

function activity(id: string, overrides: Partial<CoachActivity> = {}): CoachActivity {
  return {
    id,
    candidateId: "candidate-a",
    kind: "coachingMeeting",
    status: "planned",
    createdAt: "2026-01-13T00:00:00.000Z",
    updatedAt: "2026-01-13T00:00:00.000Z",
    ...overrides,
  }
}

describe("Phase 8.1 candidate activity report domain", () => {
  it("derives all factual event types and counts them from the included stream", () => {
    const result = createCandidateActivityReport({
      candidateId: "candidate-a",
      period: { startAt, endAt },
      applications: [application("application-1")],
      followUps: [followUp("follow-up-1", { completedAt: "2026-01-15T00:00:00.000Z" }), followUp("follow-up-2")],
      activities: [
        activity("planned", { plannedAt: "2026-01-16T00:00:00.000Z" }),
        activity("completed", { status: "completed", completedAt: "2026-01-17T00:00:00.000Z" }),
        activity("cancelled", { status: "cancelled", updatedAt: "2026-01-18T00:00:00.000Z" }),
        activity("without-plan"),
      ],
    })
    expect(result).toMatchObject({
      ok: true,
      value: {
        candidateId: "candidate-a",
        period: { startAt, endAt, endExclusive: true },
        summary: {
          applicationCreated: 1,
          applicationStatusChanged: 2,
          followUpCreated: 2,
          followUpCompleted: 1,
          coachActivityPlanned: 1,
          coachActivityCompleted: 1,
          coachActivityCancelled: 1,
        },
      },
    })
    if (result.ok) {
      expect(result.value.events.map((event) => event.kind)).toEqual([
        "applicationCreated",
        "applicationStatusChanged",
        "applicationStatusChanged",
        "followUpCreated",
        "followUpCreated",
        "followUpCompleted",
        "coachActivityPlanned",
        "coachActivityCompleted",
        "coachActivityCancelled",
      ])
      expect(result.value.events.some((event) => event.kind === "coachActivityPlanned" && event.activityId === "without-plan")).toBe(false)
      expect(JSON.stringify(result.value)).not.toContain("notes")
      expect(JSON.stringify(result.value)).not.toContain("description")
    }
  })

  it("keeps the initial status event separate and applies inclusive/exclusive boundaries", () => {
    const result = createCandidateActivityReport({
      candidateId: "candidate-a",
      period: { startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-01-03T00:00:00.000Z" },
      applications: [application("at-start", "2026-01-01T00:00:00.000Z"), application("at-end", "2026-01-03T00:00:00.000Z")],
      followUps: [],
      activities: [],
    })
    expect(result).toMatchObject({ ok: true, value: { summary: { applicationCreated: 1, applicationStatusChanged: 1 } } })
    if (result.ok) expect(result.value.events).toEqual([
      { kind: "applicationCreated", timestamp: "2026-01-01T00:00:00.000Z", applicationId: "at-start", status: "applied" },
      { kind: "applicationStatusChanged", timestamp: "2026-01-01T00:00:00.000Z", applicationId: "at-start", status: "saved" },
    ])
  })

  it("rejects invalid periods and orders equal timestamps deterministically without mutation", () => {
    const valid = { candidateId: "candidate-a", period: { startAt, endAt }, applications: [application("z", startAt), application("a", startAt)], followUps: [], activities: [] }
    expect(createCandidateActivityReport({ ...valid, period: { startAt: "2026-01-01T00:00:00+01:00", endAt } })).toMatchObject({ ok: false, error: { code: "INVALID_TIMESTAMP" } })
    expect(createCandidateActivityReport({ ...valid, period: { startAt, endAt: startAt } })).toMatchObject({ ok: false, error: { code: "INVALID_PERIOD" } })
    expect(createCandidateActivityReport({ ...valid, period: { startAt: endAt, endAt: startAt } })).toMatchObject({ ok: false, error: { code: "INVALID_PERIOD" } })
    const before = structuredClone(valid)
    const first = createCandidateActivityReport(valid)
    const second = createCandidateActivityReport(valid)
    expect(first).toEqual(second)
    expect(valid).toEqual(before)
    expect(first.ok && first.value.events.map((event) => event.applicationId)).toEqual(["a", "z", "a", "z", "a", "z"])
  })
})