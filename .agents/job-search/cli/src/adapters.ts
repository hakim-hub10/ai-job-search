import { resolve } from "node:path"
import type { JobDetailEvidence, JobDetailOutcome, JobSourceAdapter, NormalizedJob, SourceName, UnifiedSearchOptions } from "./types"
import { asOptionalString, normalizeJob } from "./utils"

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export interface BuiltInSourceDefinition {
  readonly id: SourceName
  readonly relativeScriptPath: string
  readonly scriptPath: string
  readonly defaultEnabled: boolean
}

export class SourceSelectionError extends Error {
  readonly code = "UNKNOWN_SOURCE"
  readonly unknownSourceIds: readonly string[]

  constructor(unknownSourceIds: readonly string[]) {
    const available = BUILT_IN_SOURCE_REGISTRY.map((source) => source.id).join(", ")
    super(`Unknown source: ${unknownSourceIds.join(", ")}. Available sources: ${available}.`)
    this.name = "SourceSelectionError"
    this.unknownSourceIds = Object.freeze([...unknownSourceIds])
  }
}

const repositoryRoot = resolve(import.meta.dir, "../../../..")
const sourceDefinitions = [
  { id: "linkedin", relativeScriptPath: ".agents/skills/linkedin-search/cli/src/cli.ts", defaultEnabled: true },
  { id: "jobindex", relativeScriptPath: ".agents/skills/jobindex-search/cli/src/cli.ts", defaultEnabled: false },
  { id: "jobnet", relativeScriptPath: ".agents/skills/jobnet-search/cli/src/cli.ts", defaultEnabled: false },
  { id: "jobbank", relativeScriptPath: ".agents/skills/jobbank-search/cli/src/cli.ts", defaultEnabled: false },
  { id: "jobdanmark", relativeScriptPath: ".agents/skills/jobdanmark-search/cli/src/cli.ts", defaultEnabled: false },
  { id: "freehire", relativeScriptPath: ".agents/skills/freehire-search/cli/src/cli.ts", defaultEnabled: true },
] as const satisfies ReadonlyArray<Pick<BuiltInSourceDefinition, "id" | "relativeScriptPath" | "defaultEnabled">>

const BUILT_IN_SOURCE_REGISTRY: readonly BuiltInSourceDefinition[] = Object.freeze(sourceDefinitions.map((source) => Object.freeze({
  ...source,
  scriptPath: resolve(repositoryRoot, source.relativeScriptPath),
})))

export async function runBunJsonCommand(command: string[], cwd?: string, signal?: AbortSignal): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn({
    cmd: [process.execPath, ...command],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })

  const abort = () => proc.kill()
  if (signal?.aborted) abort()
  else signal?.addEventListener("abort", abort, { once: true })

  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  signal?.removeEventListener("abort", abort)

  return { stdout, stderr, exitCode }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value.map(asOptionalString).filter((item): item is string => Boolean(item))
  return values.length > 0 ? values : undefined
}

function firstString(value: unknown): string | null {
  return Array.isArray(value) ? asOptionalString(value[0]) : asOptionalString(value)
}

/** Maps existing source detail JSON into the central evidence contract without requirement inference. */
export function sourceDetailToEvidence(source: string, payload: unknown, fallback: Readonly<NormalizedJob>): JobDetailEvidence | null {
  const record = asRecord(payload)
  if (!record) return null
  const base = { source, sourceId: asOptionalString(record.sourceId ?? record.id ?? record.slug ?? record.jobAdId) ?? fallback.sourceId }

  if (source === "linkedin") {
    const active = record.isActive
    return {
      ...base,
      title: asOptionalString(record.title), company: asOptionalString(record.company), location: asOptionalString(record.location),
      url: asOptionalString(record.url), date: asOptionalString(record.date), description: asOptionalString(record.description),
      seniority: asOptionalString(record.seniority), employmentType: asOptionalString(record.employmentType),
      jobFunction: asOptionalString(record.jobFunction), industries: stringList(record.industries) ?? (asOptionalString(record.industries) ? [String(record.industries)] : undefined),
      availability: typeof active === "boolean" ? (active ? "active" : "closed") : "unknown",
    }
  }
  if (source === "freehire") {
    return {
      ...base,
      title: asOptionalString(record.title), company: asOptionalString(record.company), location: asOptionalString(record.location),
      country: stringList(record.countries)?.[0] ?? null, url: asOptionalString(record.url), date: asOptionalString(record.date),
      description: asOptionalString(record.description), remote: asOptionalString(record.work_mode), salary: asOptionalString(record.salary),
      skills: stringList(record.skills), seniority: asOptionalString(record.seniority), category: asOptionalString(record.category),
      employmentType: asOptionalString(record.employment_type), availability: "unknown",
    }
  }
  if (source === "jobindex") {
    return {
      ...base,
      title: asOptionalString(record.title), company: asOptionalString(record.company), location: asOptionalString(record.location),
      url: asOptionalString(record.url), applyUrl: asOptionalString(record.applyUrl), date: asOptionalString(record.date),
      employmentType: asOptionalString(record.employmentType), description: asOptionalString(record.description), availability: "unknown",
    }
  }
  if (source === "jobnet") {
    const employer = asRecord(record.employer)
    const job = asRecord(record.job)
    const address = asRecord(job?.address)
    const application = asRecord(record.application)
    return {
      ...base,
      title: asOptionalString(record.title), company: asOptionalString(employer?.name),
      location: asOptionalString(address?.city ?? address?.municipality), country: asOptionalString(address?.countryName ?? address?.countryCode),
      url: fallback.url, applyUrl: asOptionalString(application?.url), date: asOptionalString(record.publicationDateTime),
      employmentType: asOptionalString(job?.type), description: asOptionalString(record.body), category: asOptionalString(job?.preferredLabelDa),
      availability: "unknown",
    }
  }
  if (source === "jobbank") {
    const company = asRecord(record.company)
    const location = asRecord(record.location)
    return {
      ...base,
      title: asOptionalString(record.title), company: asOptionalString(company?.name), location: asOptionalString(location?.city),
      country: asOptionalString(location?.country), url: asOptionalString(record.url), date: asOptionalString(record.datePosted),
      employmentType: firstString(record.employmentType), description: asOptionalString(record.description), availability: "unknown",
    }
  }
  if (source === "jobdanmark") {
    const company = asRecord(record.hiringOrganization)
    const location = asRecord(record.jobLocation)
    return {
      ...base,
      title: asOptionalString(record.title), company: asOptionalString(company?.name), location: asOptionalString(location?.addressLocality ?? location?.streetAddress),
      country: asOptionalString(location?.addressCountry), url: asOptionalString(record.url), applyUrl: asOptionalString(record.applyUrl),
      date: asOptionalString(record.datePosted), employmentType: firstString(record.employmentType),
      description: asOptionalString(record.description), availability: "unknown",
    }
  }
  return null
}

function detailIdentifier(job: Readonly<NormalizedJob>): string | null {
  return asOptionalString(job.sourceId ?? job.url)
}

function buildSourceArgs(source: string, options: UnifiedSearchOptions): string[] {
  const query = options.query?.trim() ?? ""
  const location = options.location?.trim() ?? ""
  const limit = options.limit ? String(options.limit) : undefined

  switch (source) {
    case "linkedin":
      return [
        "search",
        ...(query ? ["--query", query] : []),
        ...(location ? ["--location", location] : []),
        ...(options.jobage !== undefined ? ["--jobage", String(options.jobage)] : []),
        ...(limit ? ["--limit", limit] : []),
        "--format",
        "json",
      ]
    case "jobindex":
      return [
        "search",
        ...(query ? ["--query", query] : []),
        ...(options.jobage !== undefined ? ["--jobage", String(options.jobage)] : []),
        ...(limit ? ["--limit", limit] : []),
        "--format",
        "json",
      ]
    case "jobnet":
      return [
        "search",
        ...(query ? ["--search-string", query] : []),
        ...(limit ? ["--limit", limit] : []),
        "--format",
        "json",
      ]
    case "jobbank":
      return [
        "search",
        ...(query ? ["--key", query] : []),
        ...(location ? ["--location", location] : []),
        ...(limit ? ["--limit", limit] : []),
        "--format",
        "json",
      ]
    case "jobdanmark":
      return [
        "search",
        ...(query ? ["--text", query] : []),
        ...(location ? ["--municipality", location] : []),
        ...(limit ? ["--limit", limit] : []),
        "--format",
        "json",
      ]
    case "freehire":
      return [
        "search",
        ...(query ? ["--query", query] : []),
        ...(location ? ["--city", location] : []),
        ...(options.jobage !== undefined ? ["--jobage", String(options.jobage)] : []),
        ...(limit ? ["--limit", limit] : []),
        "--format",
        "json",
      ]
    default:
      return ["search", ...(query ? ["--query", query] : []), "--format", "json"]
  }
}

function sourceResultToJobs(source: string, payload: unknown): NormalizedJob[] {
  if (!payload || typeof payload !== "object") return []
  const resultObject = payload as Record<string, unknown>
  const results = resultObject.results ?? resultObject.jobs ?? resultObject.data ?? []

  if (!Array.isArray(results)) return []

  return results
    .map((item) => {
      if (!item || typeof item !== "object") return null
      const record = item as Record<string, unknown>
      return normalizeJob({
        id: asOptionalString(record.id ?? record.slug ?? record.jobAdId ?? record.public_slug) ?? "",
        title: asOptionalString(record.title) ?? "Untitled role",
        company: asOptionalString(record.company ?? record.companyName ?? record.hiringOrgName),
        location: asOptionalString(record.location ?? record.companyAddress ?? record.municipality ?? record.postalDistrictName),
        country: asOptionalString(record.country),
        url: asOptionalString(record.url),
        applyUrl: asOptionalString(record.applyUrl ?? record.url),
        source,
        sourceId: asOptionalString(record.sourceId ?? record.id ?? record.slug ?? record.jobAdId ?? record.public_slug),
        date: asOptionalString(record.date ?? record.publishedDate ?? record.publicationDate ?? record.posted),
        employmentType: asOptionalString(record.employmentType ?? record.jobType ?? (Array.isArray(record.jobTypes) ? record.jobTypes[0] : undefined)),
        remote: asOptionalString(record.remote ?? record.work_mode),
        description: asOptionalString(record.description),
        salary: asOptionalString(record.salary),
        skills: Array.isArray(record.skills) ? (record.skills.map((s) => asOptionalString(s)).filter((s): s is string => Boolean(s))) : [],
        seniority: asOptionalString(record.seniority),
        category: asOptionalString(record.category),
      })
    })
    .filter((item): item is NormalizedJob => Boolean(item))
}

export function createSourceAdapter(
  name: SourceName | string,
  command: string[],
  cwd: string,
  runCommand: typeof runBunJsonCommand = runBunJsonCommand,
): JobSourceAdapter {
  return {
    name,
    search: async (options: UnifiedSearchOptions) => {
      const finalArgs = [...command, ...buildSourceArgs(name, options)]
      const result = await runCommand(finalArgs, cwd)
      if (result.exitCode !== 0) {
        return {
          jobs: [],
          status: "error",
          source: name,
          error: result.stderr.trim() || `Source ${name} failed with exit code ${result.exitCode}`,
        }
      }

      try {
        const payload = JSON.parse(result.stdout)
        return {
          jobs: sourceResultToJobs(name, payload),
          status: "ok",
          source: name,
        }
      } catch (error) {
        return {
          jobs: [],
          status: "error",
          source: name,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
    detail: async (job, context): Promise<JobDetailOutcome> => {
      const identifier = detailIdentifier(job)
      if (!identifier) return { status: "error", code: "MISSING_DETAIL_IDENTIFIER" }
      const result = await runCommand([...command, "detail", identifier, "--format", "json"], cwd, context?.signal)
      if (result.exitCode !== 0) return { status: "error", code: "DETAIL_COMMAND_FAILED" }
      try {
        const detail = sourceDetailToEvidence(String(name), JSON.parse(result.stdout), job)
        return detail ? { status: "ok", detail } : { status: "error", code: "MALFORMED_DETAIL" }
      } catch {
        return { status: "error", code: "MALFORMED_DETAIL" }
      }
    },
  }
}

/** Returns an immutable, deterministically ordered view of the built-in source registry. */
export function getBuiltInSourceDefinitions(): readonly BuiltInSourceDefinition[] {
  return BUILT_IN_SOURCE_REGISTRY
}

/** Resolves default sources or exactly the requested valid source IDs in registry order. */
export function resolveBuiltInSourceAdapters(requestedSources?: readonly string[]): JobSourceAdapter[] {
  const requested = requestedSources?.length ? new Set(requestedSources) : undefined
  if (requested) {
    const known = new Set<string>(BUILT_IN_SOURCE_REGISTRY.map((source) => source.id))
    const unknown = [...requested].filter((source) => !known.has(source))
    if (unknown.length > 0) throw new SourceSelectionError(unknown)
  }
  return BUILT_IN_SOURCE_REGISTRY
    .filter((source) => requested ? requested.has(source.id) : source.defaultEnabled)
    .map((source) => createSourceAdapter(source.id, [source.scriptPath], repositoryRoot))
}

export function registerBuiltInSourceAdapters(): Record<string, JobSourceAdapter> {
  return Object.fromEntries(
    BUILT_IN_SOURCE_REGISTRY.map((source) => [source.id, createSourceAdapter(source.id, [source.scriptPath], repositoryRoot)]),
  )
}
