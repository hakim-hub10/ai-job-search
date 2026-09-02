import type { JobDetailEvidence, JobDetailOutcome, JobSourceAdapter, NormalizedJob } from "./types"

export const MAX_DETAIL_REQUESTS = 10
export const MAX_DETAIL_CONCURRENCY = 2
/** Source requests currently use 15-second timeouts; this outer bound allows cleanup overhead. */
export const DEFAULT_DETAIL_TIMEOUT_MS = 20_000

export type JobEnrichmentStatus =
  | "enriched"
  | "not_needed"
  | "unsupported"
  | "not_attempted_limit"
  | "failed"
  | "timeout"
  | "malformed"
  | "closed"

export type EnrichableJobField = keyof Pick<NormalizedJob,
  | "title"
  | "company"
  | "location"
  | "country"
  | "url"
  | "applyUrl"
  | "date"
  | "employmentType"
  | "remote"
  | "description"
  | "salary"
  | "skills"
  | "seniority"
  | "category"
>

export interface JobEnrichmentConflict {
  field: EnrichableJobField
  searchValue: string | string[]
  detailValue: string | string[]
}

export interface JobEnrichmentRecord {
  jobId: string
  source: string
  status: JobEnrichmentStatus
  enrichedFields: EnrichableJobField[]
  conflicts: JobEnrichmentConflict[]
  /** Validated source evidence is retained separately from the normalized job for later consumers. */
  detailEvidence?: JobDetailEvidence
}

export interface JobDetailEnrichmentResult {
  jobs: NormalizedJob[]
  records: JobEnrichmentRecord[]
}

export interface JobDetailEnrichmentOptions {
  timeoutMs?: number
  /** A conservative caller-supplied policy; by default every supported selected job is attempted. */
  shouldEnrich?: (job: Readonly<NormalizedJob>) => boolean
}

type MutableRecord = JobEnrichmentRecord & { job?: NormalizedJob }

const stringFields: EnrichableJobField[] = [
  "title", "company", "location", "country", "url", "applyUrl", "date", "employmentType",
  "remote", "description", "salary", "seniority", "category",
]

function cloneJob(job: Readonly<NormalizedJob>): NormalizedJob {
  return { ...job, skills: [...job.skills] }
}

function cloneEvidence(detail: JobDetailEvidence): JobDetailEvidence {
  return {
    ...detail,
    ...(detail.skills === undefined ? {} : { skills: [...detail.skills] }),
    ...(detail.industries === undefined ? {} : { industries: [...detail.industries] }),
  }
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function validOptionalText(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string"
}

function validStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0)
}

function isValidDetailOutcome(value: unknown, job: Readonly<NormalizedJob>): value is JobDetailOutcome {
  if (!value || typeof value !== "object") return false
  const outcome = value as Record<string, unknown>
  if (outcome.status === "error") return outcome.code === undefined || typeof outcome.code === "string"
  if (outcome.status !== "ok" || !outcome.detail || typeof outcome.detail !== "object") return false
  const detail = outcome.detail as Record<string, unknown>
  if (!hasText(detail.source) || detail.source !== String(job.source)) return false
  if (!(detail.sourceId === null || hasText(detail.sourceId))) return false
  if (job.sourceId && detail.sourceId && job.sourceId !== detail.sourceId) return false
  if (detail.availability !== undefined && !["active", "closed", "unknown"].includes(String(detail.availability))) return false
  for (const field of stringFields) {
    if (!validOptionalText(detail[field])) return false
  }
  if (detail.jobFunction !== undefined && !validOptionalText(detail.jobFunction)) return false
  if (detail.skills !== undefined && !validStringArray(detail.skills)) return false
  if (detail.industries !== undefined && !validStringArray(detail.industries)) return false
  return true
}

function equalValues(left: string | string[], right: string | string[]): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => value === right[index])
  }
  return left === right
}

function mergeDetail(job: Readonly<NormalizedJob>, evidence: JobDetailEvidence): {
  job: NormalizedJob
  enrichedFields: EnrichableJobField[]
  conflicts: JobEnrichmentConflict[]
} {
  const merged = cloneJob(job)
  const enrichedFields: EnrichableJobField[] = []
  const conflicts: JobEnrichmentConflict[] = []

  for (const field of stringFields) {
    const searchValue = merged[field] as string | null
    const detailValue = evidence[field] as string | null | undefined
    if (!hasText(detailValue)) continue
    if (!hasText(searchValue)) {
      ;(merged as unknown as Record<string, unknown>)[field] = detailValue
      enrichedFields.push(field)
    } else if (!equalValues(searchValue, detailValue)) {
      conflicts.push({ field, searchValue, detailValue })
    }
  }

  if (evidence.skills && evidence.skills.length > 0) {
    if (merged.skills.length === 0) {
      merged.skills = [...evidence.skills]
      enrichedFields.push("skills")
    } else if (!equalValues(merged.skills, evidence.skills)) {
      conflicts.push({ field: "skills", searchValue: [...merged.skills], detailValue: [...evidence.skills] })
    }
  }

  return { job: merged, enrichedFields, conflicts }
}

function baseRecord(job: Readonly<NormalizedJob>, status: JobEnrichmentStatus): JobEnrichmentRecord {
  return { jobId: job.id, source: String(job.source), status, enrichedFields: [], conflicts: [] }
}

async function withTimeout(
  operation: (signal: AbortSignal) => Promise<JobDetailOutcome>,
  timeoutMs: number,
): Promise<JobDetailOutcome | "timeout"> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      resolve("timeout")
      controller.abort()
    }, timeoutMs)
  })
  try {
    return await Promise.race([operation(controller.signal), timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function enrichOne(job: Readonly<NormalizedJob>, adapter: JobSourceAdapter, timeoutMs: number): Promise<MutableRecord> {
  try {
    const outcome = await withTimeout((signal) => adapter.detail!(cloneJob(job), { signal }), timeoutMs)
    if (outcome === "timeout") return { ...baseRecord(job, "timeout"), job: cloneJob(job) }
    if (!isValidDetailOutcome(outcome, job)) return { ...baseRecord(job, "malformed"), job: cloneJob(job) }
    if (outcome.status === "error") {
      const status = outcome.code === "MALFORMED_DETAIL" ? "malformed" : "failed"
      return { ...baseRecord(job, status), job: cloneJob(job) }
    }

    const detailEvidence = cloneEvidence(outcome.detail)
    if (detailEvidence.availability === "closed") {
      return { ...baseRecord(job, "closed"), detailEvidence }
    }
    const merged = mergeDetail(job, detailEvidence)
    return { ...baseRecord(job, "enriched"), ...merged, detailEvidence }
  } catch {
    return { ...baseRecord(job, "failed"), job: cloneJob(job) }
  }
}

/**
 * Enriches only the supplied selected jobs. Calls are globally capped, run with
 * bounded concurrency, and cannot turn detail failure into search failure.
 */
export async function enrichJobDetails(
  selectedJobs: readonly NormalizedJob[],
  adapters: readonly JobSourceAdapter[],
  options: JobDetailEnrichmentOptions = {},
): Promise<JobDetailEnrichmentResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DETAIL_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("Detail timeout must be a positive finite number.")
  const shouldEnrich = options.shouldEnrich ?? (() => true)
  const adapterBySource = new Map(adapters.map((adapter) => [String(adapter.name), adapter]))
  const records: Array<MutableRecord | undefined> = new Array(selectedJobs.length)
  const requests: Array<{ index: number; job: Readonly<NormalizedJob>; adapter: JobSourceAdapter }> = []

  for (const [index, job] of selectedJobs.entries()) {
    if (!shouldEnrich(cloneJob(job))) {
      records[index] = { ...baseRecord(job, "not_needed"), job: cloneJob(job) }
      continue
    }
    const adapter = adapterBySource.get(String(job.source))
    if (!adapter?.detail) {
      records[index] = { ...baseRecord(job, "unsupported"), job: cloneJob(job) }
      continue
    }
    if (requests.length >= MAX_DETAIL_REQUESTS) {
      records[index] = { ...baseRecord(job, "not_attempted_limit"), job: cloneJob(job) }
      continue
    }
    requests.push({ index, job, adapter })
  }

  let next = 0
  const worker = async () => {
    while (next < requests.length) {
      const request = requests[next++]
      records[request.index] = await enrichOne(request.job, request.adapter, timeoutMs)
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_DETAIL_CONCURRENCY, requests.length) }, worker))

  const completed = records.map((record, index) => record ?? { ...baseRecord(selectedJobs[index], "failed"), job: cloneJob(selectedJobs[index]) })
  return {
    jobs: completed.flatMap((record) => record.status === "closed" || !record.job ? [] : [record.job]),
    records: completed.map(({ job: _job, ...record }) => record),
  }
}
