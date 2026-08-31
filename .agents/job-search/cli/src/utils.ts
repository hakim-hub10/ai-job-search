import type { NormalizedJob, SourceName } from "./types"

export function asString(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === "string") return value.trim() || null
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return null
}

export function asOptionalString(value: unknown): string | null {
  return asString(value)
}

export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => asString(entry))
      .filter((entry): entry is string => Boolean(entry))
  }
  const text = asString(value)
  return text ? [text] : []
}

export function canonicalUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).toString()
  } catch {
    return url.trim() || null
  }
}

export function cleanedText(text: unknown): string | null {
  const value = asString(text)
  return value ? value.replace(/\s+/g, " ").trim() : null
}

export function normalizeSourceName(source: string | undefined | null): SourceName | string {
  return (source || "unknown") as SourceName | string
}

export function makeFallbackId(source: string, title: string | null, company: string | null, location: string | null, url: string | null): string {
  const labels = [source, title, company, location, url].filter(Boolean).map((part) => String(part).trim()).filter(Boolean)
  return labels.join("|") || `${source}-job`
}

export function normalizeFieldList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => normalizeFieldList(item))
  const text = cleanedText(value)
  return text ? [text] : []
}

export function pickFirst(...values: Array<unknown>): string | null {
  for (const value of values) {
    const text = cleanedText(value)
    if (text) return text
  }
  return null
}

export function createNormalizedJob(raw: Partial<NormalizedJob> & { source: string }): NormalizedJob {
  const title = cleanedText(raw.title) ?? "Untitled role"
  const company = cleanedText(raw.company)
  const location = cleanedText(raw.location)
  const country = cleanedText(raw.country)
  const source = normalizeSourceName(raw.source)
  const url = canonicalUrl(raw.url ?? raw.applyUrl ?? null)
  const applyUrl = canonicalUrl(raw.applyUrl ?? raw.url ?? null)
  const sourceId = cleanedText(raw.sourceId) ?? cleanedText(raw.id) ?? null
  const id = cleanedText(raw.id) ?? sourceId ?? makeFallbackId(source as string, title, company, location, url)

  return {
    id,
    title,
    company,
    location,
    country,
    url,
    applyUrl,
    source,
    sourceId,
    date: cleanedText(raw.date),
    employmentType: cleanedText(raw.employmentType),
    remote: cleanedText(raw.remote),
    description: cleanedText(raw.description),
    salary: cleanedText(raw.salary),
    skills: Array.isArray(raw.skills) ? raw.skills.map((item) => cleanedText(item)).filter((item): item is string => Boolean(item)) : [],
    seniority: cleanedText(raw.seniority),
    category: cleanedText(raw.category),
  }
}

export function normalizeJob(raw: Partial<NormalizedJob> & { source: string }): NormalizedJob {
  return createNormalizedJob(raw)
}
