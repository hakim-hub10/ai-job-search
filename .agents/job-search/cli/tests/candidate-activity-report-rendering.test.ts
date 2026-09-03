import { describe, expect, it } from "bun:test"
import { renderCandidateActivityReport } from "../src/index"
import type { CandidateActivityReport } from "../src/candidate-activity-report"

const report: CandidateActivityReport = {
  candidateId: "candidate, \"A\"",
  period: { startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-02-01T00:00:00.000Z", endExclusive: true },
  summary: {
    applicationCreated: 1,
    applicationStatusChanged: 1,
    followUpCreated: 1,
    followUpCompleted: 0,
    coachActivityPlanned: 1,
    coachActivityCompleted: 0,
    coachActivityCancelled: 0,
  },
  events: [
    { kind: "applicationCreated", timestamp: "2026-01-01T00:00:00.000Z", applicationId: "application,1", status: "saved" },
    { kind: "applicationStatusChanged", timestamp: "2026-01-02T00:00:00.000Z", applicationId: "application,1", status: "applied" },
    { kind: "followUpCreated", timestamp: "2026-01-03T00:00:00.000Z", followUpId: "follow-up-1", applicationId: "application,1" },
    { kind: "coachActivityPlanned", timestamp: "2026-01-04T00:00:00.000Z", activityId: "activity|1", activityKind: "coachingMeeting" },
  ],
}

const emptyReport: CandidateActivityReport = {
  candidateId: "candidate-empty",
  period: { startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-02-01T00:00:00.000Z", endExclusive: true },
  summary: {
    applicationCreated: 0,
    applicationStatusChanged: 0,
    followUpCreated: 0,
    followUpCompleted: 0,
    coachActivityPlanned: 0,
    coachActivityCompleted: 0,
    coachActivityCancelled: 0,
  },
  events: [],
}

describe("Phase 8.2 candidate activity report rendering", () => {
  it("renders exact deterministic JSON without enrichment", () => {
    const result = renderCandidateActivityReport(report, "json")
    expect(result).toMatchObject({ ok: true, value: { format: "json", mediaType: "application/json" } })
    if (!result.ok) throw new Error(result.error.message)
    expect(JSON.parse(result.value.content)).toEqual(report)
    expect(result.value.content.endsWith("\n")).toBe(true)
    expect(renderCandidateActivityReport(report, "json")).toEqual(result)
  })

  it("renders one CSV row per event with stable header and RFC4180 escaping", () => {
    const result = renderCandidateActivityReport(report, "csv")
    expect(result).toMatchObject({ ok: true, value: { format: "csv", mediaType: "text/csv" } })
    if (!result.ok) throw new Error(result.error.message)
    const lines = result.value.content.split("\r\n")
    expect(lines[0]).toBe("candidateId,periodStartAt,periodEndAt,eventKind,timestamp,applicationId,followUpId,activityId,applicationStatus,activityKind")
    expect(lines).toHaveLength(report.events.length + 2)
    expect(lines[1]).toContain('"candidate, ""A"""')
    expect(lines[1]).toContain('"application,1"')
    expect(lines[4]).toContain('activity|1')
    expect(lines[1].split(",").length).toBeGreaterThan(10)
  })

  it("renders factual Markdown with escaped identifiers and event details", () => {
    const result = renderCandidateActivityReport(report, "markdown")
    expect(result).toMatchObject({ ok: true, value: { format: "markdown", mediaType: "text/markdown" } })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.content).toContain("# Candidate Activity Report")
    expect(result.value.content).toContain("## Summary")
    expect(result.value.content).toContain("## Events")
    expect(result.value.content).toContain("candidate, \"A\"")
    expect(result.value.content).toContain("activity\\|1")
    expect(result.value.content).toContain("status: applied")
    expect(result.value.content).not.toContain("application notes")
    expect(result.value.content).not.toContain("score")
  })

  it("renders empty reports and rejects unsupported runtime formats", () => {
    for (const format of ["json", "csv", "markdown"] as const) {
      const result = renderCandidateActivityReport(emptyReport, format)
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      if (format === "csv") expect(result.value.content.split("\r\n")).toHaveLength(2)
      if (format === "markdown") expect(result.value.content).toContain("No events in the selected period.")
    }
    expect(renderCandidateActivityReport(report, "xml" as never)).toEqual({ ok: false, error: { code: "UNSUPPORTED_FORMAT", message: "Candidate activity report format is not supported." } })
  })

  it("does not mutate the report or its nested values", () => {
    const before = structuredClone(report)
    renderCandidateActivityReport(report, "json")
    renderCandidateActivityReport(report, "csv")
    renderCandidateActivityReport(report, "markdown")
    expect(report).toEqual(before)
  })
})