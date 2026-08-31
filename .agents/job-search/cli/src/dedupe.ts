import type { NormalizedJob } from "./types"
import { canonicalUrl, cleanedText } from "./utils"

function canonicalKey(value: string | null | undefined): string | null {
  const text = cleanedText(value)
  if (!text) return null
  return text.toLowerCase().replace(/\s+/g, " ").trim()
}

export function dedupeJobs(jobs: NormalizedJob[]): NormalizedJob[] {
  const seen = new Set<string>()
  const deduped: NormalizedJob[] = []

  for (const job of jobs) {
    const sourceKey = job.source ? canonicalKey(String(job.source)) : null
    const sourceIdKey = sourceKey && job.sourceId ? `source:${sourceKey}:${canonicalKey(job.sourceId)}` : null
    const urlKey = canonicalUrl(job.url) ? `url:${canonicalUrl(job.url)}` : null
    const titleCompanyLocationKey =
      job.title && job.company && job.location
        ? `combo:${canonicalKey(job.title)}|${canonicalKey(job.company)}|${canonicalKey(job.location)}`
        : null

    const dedupeKeys = [sourceIdKey, urlKey, titleCompanyLocationKey].filter((key): key is string => Boolean(key))
    const alreadySeen = dedupeKeys.some((key) => seen.has(key))
    if (alreadySeen) continue

    const primaryKey = sourceIdKey ?? urlKey ?? titleCompanyLocationKey
    if (primaryKey) seen.add(primaryKey)
    deduped.push(job)
  }

  return deduped
}
