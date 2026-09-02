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
    const sourceId = canonicalKey(job.sourceId)
    const sourceIdKey = sourceKey && sourceId ? `source:${sourceKey}:${sourceId}` : null
    const urlKey = canonicalUrl(job.url) ? `url:${canonicalUrl(job.url)}` : null
    const title = canonicalKey(job.title)
    const company = canonicalKey(job.company)
    const location = canonicalKey(job.location)
    const titleCompanyLocationKey = title && company && location ? `combo:${title}|${company}|${location}` : null

    const dedupeKeys = [sourceIdKey, urlKey, titleCompanyLocationKey].filter((key): key is string => Boolean(key))
    const alreadySeen = dedupeKeys.some((key) => seen.has(key))
    // Register every exact identity from every observed record. Duplicate
    // records can bridge another exact identity without changing first-seen
    // retained-record ordering or introducing fuzzy matching.
    for (const key of dedupeKeys) seen.add(key)
    if (alreadySeen) continue

    deduped.push(job)
  }

  return deduped
}
