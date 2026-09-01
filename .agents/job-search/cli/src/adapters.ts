import { resolve } from "node:path"
import type { JobSourceAdapter, NormalizedJob, SourceName, UnifiedSearchOptions } from "./types"
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

export async function runBunJsonCommand(command: string[], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn({
    cmd: [process.execPath, ...command],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const exitCode = await proc.exited

  return { stdout, stderr, exitCode }
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

export function createSourceAdapter(name: SourceName | string, command: string[], cwd: string): JobSourceAdapter {
  return {
    name,
    search: async (options: UnifiedSearchOptions) => {
      const finalArgs = [...command, ...buildSourceArgs(name, options)]
      const result = await runBunJsonCommand(finalArgs, cwd)
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
