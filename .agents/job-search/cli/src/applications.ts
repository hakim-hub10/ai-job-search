import type { MatchingResult } from "./matching"
import type { RankedJob } from "./ranking"
import type { ScoringResult } from "./scoring"
import type { SkillGapResult } from "./skillgaps"
import type { NormalizedJob } from "./types"

const APPLICATION_STATUSES = [
  "saved",
  "preparing",
  "applied",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
  "closed",
] as const

export type ApplicationStatus = typeof APPLICATION_STATUSES[number]

export interface ApplicationStatusEvent {
  status: ApplicationStatus
  timestamp: string
  note?: string
}

export interface ApplicationNote {
  text: string
  createdAt: string
}

export interface ApplicationAnalysisSnapshot {
  rank: number
  matchingResult: MatchingResult
  scoringResult: ScoringResult
  skillGapResult: SkillGapResult
  explanation: string
}

/** A durable, storage-neutral snapshot of one selected job opportunity. */
export interface ApplicationRecord {
  id: string
  jobSnapshot: NormalizedJob
  analysisSnapshot: ApplicationAnalysisSnapshot
  status: ApplicationStatus
  statusHistory: ApplicationStatusEvent[]
  notes: ApplicationNote[]
  createdAt: string
  updatedAt: string
}

export interface CreateApplicationInput {
  id: string
  rankedJob: RankedJob
  createdAt: string
  initialStatus?: ApplicationStatus
  initialStatusNote?: string
  initialNote?: ApplicationNote
}

export interface UpdateApplicationStatusInput {
  status: ApplicationStatus
  timestamp: string
  note?: string
}

export interface AddApplicationNoteInput {
  text: string
  createdAt: string
}

export type ApplicationDomainErrorCode =
  | "INVALID_APPLICATION_ID"
  | "INVALID_APPLICATION_STATUS"
  | "INVALID_TIMESTAMP"
  | "TIMESTAMP_OUT_OF_ORDER"
  | "EMPTY_NOTE"
  | "MALFORMED_APPLICATION_INPUT"

export interface ApplicationDomainError {
  code: ApplicationDomainErrorCode
  message: string
}

export type ApplicationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ApplicationDomainError }

export type ApplicationDuplicateReason = "same_source_and_source_id" | "same_normalized_job_id"

export interface ApplicationDuplicateMatch {
  applicationId: string
  reasons: ApplicationDuplicateReason[]
}

function failure<T>(code: ApplicationDomainErrorCode, message: string): ApplicationResult<T> {
  return { ok: false, error: { code, message } }
}

function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return typeof value === "string" && APPLICATION_STATUSES.includes(value as ApplicationStatus)
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    && !Number.isNaN(Date.parse(value))
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isRankedJob(value: unknown): value is RankedJob {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<RankedJob>
  return Boolean(candidate.job && hasText(candidate.job.id) && hasText(candidate.job.title))
}

function snapshotRankedJob(rankedJob: RankedJob): Pick<ApplicationRecord, "jobSnapshot" | "analysisSnapshot"> {
  return structuredClone({
    jobSnapshot: rankedJob.job,
    analysisSnapshot: {
      rank: rankedJob.rank,
      matchingResult: rankedJob.matchingResult,
      scoringResult: rankedJob.scoringBreakdown,
      skillGapResult: rankedJob.skillGapResult,
      explanation: rankedJob.explanation,
    },
  })
}

function validateNote(note: ApplicationNote): ApplicationDomainError | null {
  if (!hasText(note.text)) return { code: "EMPTY_NOTE", message: "Application notes must contain non-whitespace text." }
  if (!isValidTimestamp(note.createdAt)) return { code: "INVALID_TIMESTAMP", message: "Application note timestamps must be valid UTC ISO timestamps." }
  return null
}

function validateRecord(record: ApplicationRecord): ApplicationDomainError | null {
  if (!hasText(record?.id)) return { code: "INVALID_APPLICATION_ID", message: "Application IDs must be non-empty strings." }
  if (!isValidTimestamp(record.createdAt) || !isValidTimestamp(record.updatedAt)) {
    return { code: "INVALID_TIMESTAMP", message: "Application timestamps must be valid UTC ISO timestamps." }
  }
  if (!isApplicationStatus(record.status)) return { code: "INVALID_APPLICATION_STATUS", message: "Application status is not supported." }
  return null
}

/** Creates a detached historical snapshot; it never recalculates Phase 2 analysis. */
export function createApplication(input: CreateApplicationInput): ApplicationResult<ApplicationRecord> {
  if (!hasText(input?.id)) return failure("INVALID_APPLICATION_ID", "Application IDs must be non-empty strings.")
  if (!isRankedJob(input.rankedJob)) return failure("MALFORMED_APPLICATION_INPUT", "Applications must be created from a valid RankedJob.")
  if (!isValidTimestamp(input.createdAt)) return failure("INVALID_TIMESTAMP", "Application creation timestamps must be valid UTC ISO timestamps.")

  const status = input.initialStatus ?? "saved"
  if (!isApplicationStatus(status)) return failure("INVALID_APPLICATION_STATUS", "Application status is not supported.")
  if (input.initialStatusNote !== undefined && !hasText(input.initialStatusNote)) {
    return failure("EMPTY_NOTE", "Application status notes must contain non-whitespace text.")
  }
  if (input.initialNote) {
    const noteError = validateNote(input.initialNote)
    if (noteError) return { ok: false, error: noteError }
  }

  const snapshot = snapshotRankedJob(input.rankedJob)
  return {
    ok: true,
    value: {
      id: input.id,
      ...snapshot,
      status,
      statusHistory: [{ status, timestamp: input.createdAt, ...(input.initialStatusNote ? { note: input.initialStatusNote } : {}) }],
      notes: input.initialNote ? [structuredClone(input.initialNote)] : [],
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    },
  }
}

/** Appends a status event without mutating the existing application record. */
export function updateApplicationStatus(
  record: ApplicationRecord,
  input: UpdateApplicationStatusInput,
): ApplicationResult<ApplicationRecord> {
  const recordError = validateRecord(record)
  if (recordError) return { ok: false, error: recordError }
  if (!isApplicationStatus(input?.status)) return failure("INVALID_APPLICATION_STATUS", "Application status is not supported.")
  if (!isValidTimestamp(input.timestamp)) return failure("INVALID_TIMESTAMP", "Application status timestamps must be valid UTC ISO timestamps.")
  if (Date.parse(input.timestamp) < Date.parse(record.updatedAt)) {
    return failure("TIMESTAMP_OUT_OF_ORDER", "Application status timestamps cannot precede the current update timestamp.")
  }
  if (input.note !== undefined && !hasText(input.note)) {
    return failure("EMPTY_NOTE", "Application status notes must contain non-whitespace text.")
  }

  return {
    ok: true,
    value: {
      ...record,
      status: input.status,
      statusHistory: [...record.statusHistory, { status: input.status, timestamp: input.timestamp, ...(input.note ? { note: input.note } : {}) }],
      updatedAt: input.timestamp,
    },
  }
}

/** Appends a user-authored note without interpreting its contents. */
export function addApplicationNote(
  record: ApplicationRecord,
  input: AddApplicationNoteInput,
): ApplicationResult<ApplicationRecord> {
  const recordError = validateRecord(record)
  if (recordError) return { ok: false, error: recordError }
  const note: ApplicationNote = { text: input?.text, createdAt: input?.createdAt }
  const noteError = validateNote(note)
  if (noteError) return { ok: false, error: noteError }
  if (Date.parse(note.createdAt) < Date.parse(record.updatedAt)) {
    return failure("TIMESTAMP_OUT_OF_ORDER", "Application note timestamps cannot precede the current update timestamp.")
  }

  return {
    ok: true,
    value: {
      ...record,
      notes: [...record.notes, structuredClone(note)],
      updatedAt: note.createdAt,
    },
  }
}

/** Returns conservative duplicate evidence only; callers decide whether to create another record. */
export function findDuplicateApplications(
  records: ApplicationRecord[],
  rankedJob: RankedJob,
): ApplicationDuplicateMatch[] {
  if (!isRankedJob(rankedJob)) return []

  return records.flatMap((record) => {
    const reasons: ApplicationDuplicateReason[] = []
    const existingJob = record.jobSnapshot
    if (existingJob.source === rankedJob.job.source
      && existingJob.sourceId !== null
      && existingJob.sourceId === rankedJob.job.sourceId) {
      reasons.push("same_source_and_source_id")
    }
    if (existingJob.id === rankedJob.job.id) reasons.push("same_normalized_job_id")
    return reasons.length > 0 ? [{ applicationId: record.id, reasons }] : []
  })
}
