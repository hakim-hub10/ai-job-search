import type { JobSourceAdapter, NormalizedJob, SourceName, UnifiedSearchOptions } from "./types"
import { asOptionalString, normalizeJob } from "./utils"

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export async function runBunJsonCommand(command: string[], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn({
    cmd: ["bun", ...command],
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

export function registerBuiltInSourceAdapters(): Record<string, JobSourceAdapter> {
  const repoRoot = "/home/user/ai-job-search"
  const sourceDirs = {
    linkedin: [".agents/skills/linkedin-search/cli/src/cli.ts"],
    jobindex: [".agents/skills/jobindex-search/cli/src/cli.ts"],
    jobnet: [".agents/skills/jobnet-search/cli/src/cli.ts"],
    jobbank: [".agents/skills/jobbank-search/cli/src/cli.ts"],
    jobdanmark: [".agents/skills/jobdanmark-search/cli/src/cli.ts"],
    freehire: [".agents/skills/freehire-search/cli/src/cli.ts"],
  }

  return Object.fromEntries(
    Object.entries(sourceDirs).map(([key, command]) => [key, createSourceAdapter(key, command, repoRoot)]),
  )
}
