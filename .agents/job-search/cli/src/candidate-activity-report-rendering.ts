import type { CandidateActivityReport, CandidateActivityReportEvent } from "./candidate-activity-report"

export type CandidateActivityReportRenderFormat = "json" | "csv" | "markdown"

export interface CandidateActivityReportRenderSuccess {
  format: CandidateActivityReportRenderFormat
  content: string
  mediaType: "application/json" | "text/csv" | "text/markdown"
}

export type CandidateActivityReportRenderErrorCode = "UNSUPPORTED_FORMAT"

export interface CandidateActivityReportRenderError {
  code: CandidateActivityReportRenderErrorCode
  message: string
}

export type CandidateActivityReportRenderResult =
  | { ok: true; value: CandidateActivityReportRenderSuccess }
  | { ok: false; error: CandidateActivityReportRenderError }

const CSV_HEADER = [
  "candidateId",
  "periodStartAt",
  "periodEndAt",
  "eventKind",
  "timestamp",
  "applicationId",
  "followUpId",
  "activityId",
  "applicationStatus",
  "activityKind",
]

function csvCell(value: string): string {
  return /[,"\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

function csvValue(value: string | undefined): string {
  return value === undefined ? "" : csvCell(value)
}

function eventFields(event: CandidateActivityReportEvent): { applicationId?: string; followUpId?: string; activityId?: string; applicationStatus?: string; activityKind?: string } {
  if (event.kind === "applicationCreated") return { applicationId: event.applicationId, applicationStatus: event.status }
  if (event.kind === "applicationStatusChanged") return { applicationId: event.applicationId, applicationStatus: event.status }
  if (event.kind === "followUpCreated" || event.kind === "followUpCompleted") return { followUpId: event.followUpId, applicationId: event.applicationId }
  return { activityId: event.activityId, activityKind: event.activityKind, applicationId: event.applicationId }
}

function csvRow(report: CandidateActivityReport, event: CandidateActivityReportEvent): string {
  const fields = eventFields(event)
  return [
    report.candidateId,
    report.period.startAt,
    report.period.endAt,
    event.kind,
    event.timestamp,
    fields.applicationId,
    fields.followUpId,
    fields.activityId,
    fields.applicationStatus,
    fields.activityKind,
  ].map(csvValue).join(",")
}

function markdownText(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("\r", " ").replaceAll("\n", " ")
}

function markdownDetails(event: CandidateActivityReportEvent): string {
  if (event.kind === "applicationCreated" || event.kind === "applicationStatusChanged") return `status: ${markdownText(event.status)}`
  if (event.kind === "followUpCreated" || event.kind === "followUpCompleted") return event.applicationId ? `application: ${markdownText(event.applicationId)}` : ""
  return `activity: ${markdownText(event.activityKind)}`
}

function renderJson(report: CandidateActivityReport): CandidateActivityReportRenderSuccess {
  return { format: "json", mediaType: "application/json", content: `${JSON.stringify(report, null, 2)}\n` }
}

function renderCsv(report: CandidateActivityReport): CandidateActivityReportRenderSuccess {
  return { format: "csv", mediaType: "text/csv", content: [CSV_HEADER.join(","), ...report.events.map((event) => csvRow(report, event))].join("\r\n") + "\r\n" }
}

function renderMarkdown(report: CandidateActivityReport): CandidateActivityReportRenderSuccess {
  const summaryLines = Object.entries(report.summary).map(([kind, count]) => `- ${markdownText(kind)}: ${count}`)
  const eventLines = report.events.length === 0
    ? ["No events in the selected period."]
    : report.events.map((event) => {
      const fields = eventFields(event)
      const reference = fields.applicationId ?? fields.followUpId ?? fields.activityId ?? ""
      return `| ${markdownText(event.timestamp)} | ${markdownText(event.kind)} | ${markdownText(reference)} | ${markdownDetails(event)} |`
    })
  return {
    format: "markdown",
    mediaType: "text/markdown",
    content: [
      "# Candidate Activity Report",
      "",
      `Candidate: ${markdownText(report.candidateId)}`,
      `Period: ${markdownText(report.period.startAt)} to ${markdownText(report.period.endAt)} (end exclusive)`,
      "",
      "## Summary",
      "",
      ...summaryLines,
      "",
      "## Events",
      "",
      ...(report.events.length === 0 ? eventLines : ["| Timestamp | Event | Reference | Details |", "| --- | --- | --- | --- |", ...eventLines]),
      "",
    ].join("\n"),
  }
}

export function renderCandidateActivityReport(
  report: CandidateActivityReport,
  format: CandidateActivityReportRenderFormat,
): CandidateActivityReportRenderResult {
  if (format === "json") return { ok: true, value: renderJson(report) }
  if (format === "csv") return { ok: true, value: renderCsv(report) }
  if (format === "markdown") return { ok: true, value: renderMarkdown(report) }
  return { ok: false, error: { code: "UNSUPPORTED_FORMAT", message: "Candidate activity report format is not supported." } }
}