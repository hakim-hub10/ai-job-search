export type SourceName = "linkedin" | "jobindex" | "jobnet" | "jobbank" | "jobdanmark" | "freehire" | "jobtech" | "jobadlinks"

export interface NormalizedJob {
  id: string
  title: string
  company: string | null
  location: string | null
  country: string | null
  url: string | null
  applyUrl: string | null
  source: SourceName | string
  sourceId: string | null
  date: string | null
  employmentType: string | null
  remote: string | null
  description: string | null
  salary: string | null
  skills: string[]
  seniority: string | null
  category: string | null
}

export interface JobSourceAdapter {
  name: SourceName | string
  search: (options: UnifiedSearchOptions) => Promise<SourceSearchResult>
  /** Optional source-neutral capability for retrieving richer public job evidence. */
  detail?: (job: Readonly<NormalizedJob>, context?: Readonly<{ signal: AbortSignal }>) => Promise<JobDetailOutcome>
}

export type JobAvailability = "active" | "closed" | "unknown"

export interface JobDetailEvidence {
  source: SourceName | string
  sourceId: string | null
  title?: string | null
  company?: string | null
  location?: string | null
  country?: string | null
  url?: string | null
  applyUrl?: string | null
  date?: string | null
  employmentType?: string | null
  remote?: string | null
  description?: string | null
  salary?: string | null
  skills?: string[]
  seniority?: string | null
  category?: string | null
  jobFunction?: string | null
  industries?: string[]
  availability?: JobAvailability
}

export type JobDetailOutcome =
  | { status: "ok"; detail: JobDetailEvidence }
  | { status: "error"; code?: string }

export interface UnifiedSearchOptions {
  query?: string
  location?: string
  jobage?: number
  limit?: number
  sources?: Array<SourceName | string>
  includeSourceStatus?: boolean
}

export interface SourceSearchResult {
  jobs: NormalizedJob[]
  status: "ok" | "error"
  error?: string
  source?: string
}

export interface SourceStatusEntry {
  source: string
  status: "ok" | "error"
  count?: number
  error?: string
}

export interface UnifiedSearchResponse {
  query?: string
  location?: string
  jobs: NormalizedJob[]
  total: number
  sourceStatus: SourceStatusEntry[]
}
