import type { NormalizedJob } from "./types"

export type SearchRelevanceTier = "strong" | "related" | "uncertain" | "irrelevant"

export type SearchRelevanceReasonCode =
  | "EXACT_TITLE_PHRASE"
  | "QUERY_TITLE_COVERAGE"
  | "TARGET_ROLE_TITLE_COVERAGE"
  | "RELATED_ROLE_TERMS"
  | "DESCRIPTION_ONLY_SUPPORT"
  | "INSUFFICIENT_ROLE_EVIDENCE"
  | "EMPTY_QUERY"

export interface SearchRelevanceInput {
  query: string
  targetRoles?: readonly string[]
}

export interface SearchRelevanceResult {
  jobId: string
  tier: SearchRelevanceTier
  reasons: SearchRelevanceReasonCode[]
  matchedTerms: string[]
}

export interface SearchRelevanceSelection {
  eligibleJobs: NormalizedJob[]
  excludedJobs: Array<{ job: NormalizedJob; relevance: SearchRelevanceResult }>
  results: SearchRelevanceResult[]
}

const STOP_WORDS = new Set(["a", "an", "and", "for", "of", "the", "to"])
const COMPOUNDS: ReadonlyArray<[RegExp, string]> = [
  [/\bhelpdesk\b/gu, "help desk"],
  [/\bservicedesk\b/gu, "service desk"],
]
// A deliberately small title-vocabulary bridge, not an occupation ontology.
const RELATED_ROLE_GROUPS = [
  ["it support", "technical support", "help desk", "service desk"],
] as const

function normalizeText(value: string): string {
  let normalized = value.normalize("NFKC").toLocaleLowerCase("en")
  for (const [pattern, replacement] of COMPOUNDS) normalized = normalized.replace(pattern, replacement)
  return normalized.replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/gu, " ")
}

function normalizeToken(token: string): string {
  const exact: Record<string, string> = {
    operational: "operation",
    operations: "operation",
    coordination: "coordinate",
    coordinator: "coordinate",
    coordinators: "coordinate",
    coordinating: "coordinate",
    specialists: "specialist",
    technicians: "technician",
    analysts: "analyst",
    managers: "manager",
    nurses: "nurse",
    engineers: "engineer",
  }
  return exact[token] ?? token
}

function surfaceTokens(value: string): string[] {
  return [...new Set(normalizeText(value).split(" ").filter((token) => token && !STOP_WORDS.has(token)))]
}

function tokens(value: string): string[] {
  return surfaceTokens(value).map(normalizeToken)
}

function intersection(left: readonly string[], right: readonly string[]): string[] {
  const available = new Set(right)
  return left.filter((token) => available.has(token)).sort((a, b) => a.localeCompare(b))
}

function containsPhrase(text: string, phrase: string): boolean {
  return phrase.length > 0 && (` ${text} `).includes(` ${phrase} `)
}

function relatedGroup(value: string): number | undefined {
  const normalized = normalizeText(value)
  return RELATED_ROLE_GROUPS.findIndex((group) => group.some((phrase) => containsPhrase(normalized, phrase)))
}

function queryCompatibleTargetRoles(query: string, targetRoles: readonly string[]): string[] {
  const queryTokens = tokens(query)
  const queryGroup = relatedGroup(query)
  return targetRoles.filter((role) => {
    if (queryGroup !== undefined && queryGroup >= 0 && relatedGroup(role) === queryGroup) return true
    return intersection(queryTokens, tokens(role)).length > 0
  })
}

/** Classifies role relevance without reading candidate qualifications or location. */
export function assessSearchRelevance(job: NormalizedJob, input: SearchRelevanceInput): SearchRelevanceResult {
  const query = normalizeText(input.query ?? "")
  const queryTokens = tokens(query)
  if (queryTokens.length === 0) return { jobId: job.id, tier: "strong", reasons: ["EMPTY_QUERY"], matchedTerms: [] }

  const title = normalizeText(job.title)
  const titleTokens = tokens(title)
  const titleMatches = intersection(queryTokens, titleTokens)
  if (containsPhrase(title, query)) {
    return { jobId: job.id, tier: "strong", reasons: ["EXACT_TITLE_PHRASE"], matchedTerms: titleMatches }
  }
  const surfaceQueryTokens = surfaceTokens(query)
  const surfaceTitleMatches = intersection(surfaceQueryTokens, surfaceTokens(title))
  if (surfaceTitleMatches.length === surfaceQueryTokens.length) {
    return { jobId: job.id, tier: "strong", reasons: ["QUERY_TITLE_COVERAGE"], matchedTerms: titleMatches }
  }

  const queryGroup = relatedGroup(query)
  if (queryGroup !== undefined && queryGroup >= 0 && relatedGroup(title) === queryGroup) {
    return { jobId: job.id, tier: "related", reasons: ["RELATED_ROLE_TERMS"], matchedTerms: titleMatches }
  }

  if (titleMatches.length >= Math.ceil(queryTokens.length / 2)) {
    return { jobId: job.id, tier: "related", reasons: ["QUERY_TITLE_COVERAGE"], matchedTerms: titleMatches }
  }

  for (const role of queryCompatibleTargetRoles(query, input.targetRoles ?? [])) {
    const roleTokens = tokens(role)
    const roleMatches = intersection(roleTokens, titleTokens)
    if (roleTokens.length > 0 && roleMatches.length === roleTokens.length) {
      return { jobId: job.id, tier: "related", reasons: ["TARGET_ROLE_TITLE_COVERAGE"], matchedTerms: roleMatches }
    }
  }

  const descriptionTokens = tokens(job.description ?? "")
  const descriptionMatches = intersection(queryTokens, descriptionTokens)
  if (descriptionMatches.length === queryTokens.length) {
    return { jobId: job.id, tier: "uncertain", reasons: ["DESCRIPTION_ONLY_SUPPORT"], matchedTerms: descriptionMatches }
  }
  return { jobId: job.id, tier: "irrelevant", reasons: ["INSUFFICIENT_ROLE_EVIDENCE"], matchedTerms: titleMatches }
}

/** Selects strong/related jobs stably and returns detached diagnostics for all jobs. */
export function selectSearchRelevantJobs(jobs: readonly NormalizedJob[], input: SearchRelevanceInput): SearchRelevanceSelection {
  const eligibleJobs: NormalizedJob[] = []
  const excludedJobs: SearchRelevanceSelection["excludedJobs"] = []
  const results: SearchRelevanceResult[] = []
  for (const sourceJob of jobs) {
    const job = structuredClone(sourceJob)
    const relevance = assessSearchRelevance(job, input)
    results.push(structuredClone(relevance))
    if (relevance.tier === "strong" || relevance.tier === "related") eligibleJobs.push(job)
    else excludedJobs.push({ job, relevance: structuredClone(relevance) })
  }
  return { eligibleJobs, excludedJobs, results }
}
