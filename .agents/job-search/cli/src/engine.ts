import { dedupeJobs } from "./dedupe"
import { normalizeJob } from "./utils"
import type { JobSourceAdapter, SourceStatusEntry, UnifiedSearchOptions, UnifiedSearchResponse } from "./types"

export async function searchJobs(options: UnifiedSearchOptions & { adapters: JobSourceAdapter[]; includeSourceStatus?: boolean }): Promise<UnifiedSearchResponse> {
  const adapters = options.adapters ?? []
  const status: SourceStatusEntry[] = []
  const allJobs = [] as Awaited<ReturnType<JobSourceAdapter["search"]>>["jobs"]

  for (const adapter of adapters) {
    try {
      const result = await adapter.search(options)
      allJobs.push(...result.jobs)
      if (options.includeSourceStatus) {
        status.push({
          source: adapter.name,
          status: result.status,
          count: result.jobs.length,
          error: result.error,
        })
      }
    } catch (error) {
      if (options.includeSourceStatus) {
        status.push({
          source: adapter.name,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  const normalized = allJobs.map((job) => normalizeJob(job))
  const finalJobs = dedupeJobs(normalized)

  return {
    query: options.query,
    location: options.location,
    jobs: finalJobs,
    total: finalJobs.length,
    sourceStatus: status,
  }
}
