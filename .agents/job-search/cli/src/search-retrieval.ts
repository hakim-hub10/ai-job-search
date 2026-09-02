import { searchJobs as defaultSearchJobs } from "./engine"
import { selectSearchRelevantJobs, type SearchRelevanceSelection } from "./search-relevance"
import type { JobSourceAdapter, NormalizedJob, UnifiedSearchOptions, UnifiedSearchResponse } from "./types"

export interface SearchRetrievalPlan {
  visibleLimit?: number
  retrievalLimit?: number
  oversamplingApplied: boolean
}

export interface SearchAwareRetrievalInput {
  search: UnifiedSearchOptions & { adapters: JobSourceAdapter[] }
  targetRoles?: readonly string[]
}

export interface SearchAwareRetrievalResult {
  plan: SearchRetrievalPlan
  search: UnifiedSearchResponse
  relevance: SearchRelevanceSelection
  eligibleJobs: NormalizedJob[]
}

export type SearchAwareRetrievalErrorCode = "ALL_SOURCES_FAILED"

export type SearchAwareRetrievalOutcome =
  | { ok: true; value: SearchAwareRetrievalResult }
  | { ok: false; error: { code: SearchAwareRetrievalErrorCode; message: string }; search: UnifiedSearchResponse }

export interface SearchAwareRetrievalDependencies {
  searchJobs?: typeof defaultSearchJobs
}

export function createSearchRetrievalPlan(visibleLimit?: number): SearchRetrievalPlan {
  if (visibleLimit === undefined) return { oversamplingApplied: false }
  if (!Number.isSafeInteger(visibleLimit) || visibleLimit < 1) {
    throw new RangeError("Search retrieval limits must be positive safe integers.")
  }
  const retrievalLimit = Math.max(visibleLimit, Math.min(visibleLimit * 3, 50))
  return { visibleLimit, retrievalLimit, oversamplingApplied: retrievalLimit > visibleLimit }
}

function orderedSources(adapters: readonly JobSourceAdapter[], jobs: readonly NormalizedJob[]): string[] {
  const sources: string[] = []
  const seen = new Set<string>()
  for (const source of [...adapters.map((adapter) => String(adapter.name)), ...jobs.map((job) => String(job.source))]) {
    if (seen.has(source)) continue
    seen.add(source)
    sources.push(source)
  }
  return sources
}

function selectSourceFairJobs(
  jobs: readonly NormalizedJob[],
  adapters: readonly JobSourceAdapter[],
  visibleLimit?: number,
): NormalizedJob[] {
  if (visibleLimit === undefined || jobs.length <= visibleLimit) return structuredClone([...jobs])
  const queues = new Map<string, NormalizedJob[]>()
  for (const source of orderedSources(adapters, jobs)) queues.set(source, [])
  for (const job of jobs) {
    const source = String(job.source)
    const queue = queues.get(source) ?? []
    queue.push(job)
    queues.set(source, queue)
  }

  const selected: NormalizedJob[] = []
  let round = 0
  while (selected.length < visibleLimit) {
    let added = false
    for (const queue of queues.values()) {
      const job = queue[round]
      if (!job) continue
      selected.push(structuredClone(job))
      added = true
      if (selected.length === visibleLimit) break
    }
    if (!added) break
    round += 1
  }
  return selected
}

/** Builds a bounded pool, applies H6 once, and selects a source-fair visible set. */
export async function retrieveSearchAwareJobs(
  input: SearchAwareRetrievalInput,
  dependencies: SearchAwareRetrievalDependencies = {},
): Promise<SearchAwareRetrievalOutcome> {
  const plan = createSearchRetrievalPlan(input.search.limit)
  const searchOptions = {
    ...input.search,
    adapters: [...input.search.adapters],
    includeSourceStatus: true,
    ...(plan.retrievalLimit === undefined ? {} : { limit: plan.retrievalLimit }),
  }
  const search = await (dependencies.searchJobs ?? defaultSearchJobs)(searchOptions)
  const allSourcesFailed = input.search.adapters.length > 0
    && search.sourceStatus.length >= input.search.adapters.length
    && search.sourceStatus.every((status) => status.status === "error")
  if (allSourcesFailed) {
    return { ok: false, error: { code: "ALL_SOURCES_FAILED", message: "All selected job sources failed." }, search }
  }

  const relevance = selectSearchRelevantJobs(search.jobs, {
    query: input.search.query ?? "",
    targetRoles: input.targetRoles === undefined ? undefined : [...input.targetRoles],
  })
  const eligibleJobs = selectSourceFairJobs(relevance.eligibleJobs, input.search.adapters, plan.visibleLimit)
  return { ok: true, value: { plan, search, relevance, eligibleJobs } }
}
