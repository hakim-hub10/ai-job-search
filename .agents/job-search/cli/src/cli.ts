#!/usr/bin/env bun
import { SourceSelectionError, resolveBuiltInSourceAdapters } from "./adapters"
import { searchJobs } from "./engine"

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith("--")) continue
    const key = token.slice(2)
    if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      args[key] = argv[i + 1]
      i += 1
    } else {
      args[key] = true
    }
  }
  return args
}

function parseSourceArguments(argv: string[]): string[] {
  const sources: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--source") continue
    const source = argv[index + 1]
    if (!source || source.startsWith("--")) throw new SourceSelectionError(["(missing source ID)"])
    sources.push(source)
    index += 1
  }
  return sources
}

async function main() {
  const args = parseArgs(Bun.argv.slice(2))
  const query = typeof args.query === "string" ? args.query : undefined
  const location = typeof args.location === "string" ? args.location : undefined
  const jobage = typeof args.jobage === "string" ? Number(args.jobage) : undefined
  const limit = typeof args.limit === "string" ? Number(args.limit) : undefined
  const format = typeof args.format === "string" ? args.format : "json"
  const includeSourceStatus = true
  const adapters = resolveBuiltInSourceAdapters(parseSourceArguments(Bun.argv.slice(2)))
  const result = await searchJobs({
    query,
    location,
    jobage,
    limit,
    includeSourceStatus,
    adapters,
  })

  if (format === "table") {
    if (result.jobs.length === 0) {
      console.log("No jobs found.")
      return 0
    }

    console.log("SOURCE  TITLE  COMPANY  LOCATION")
    for (const job of result.jobs) {
      console.log(`${job.source}  ${job.title.slice(0, 24)}  ${String(job.company ?? "-").slice(0, 18)}  ${String(job.location ?? "-").slice(0, 20)}`)
    }
    return 0
  }

  console.log(JSON.stringify({
    query,
    location,
    total: result.total,
    jobs: result.jobs,
    sourceStatus: result.sourceStatus,
  }, null, 2))
  return 0
}

main().then((code) => {
  process.exit(code)
}).catch((error) => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error), code: error instanceof SourceSelectionError ? error.code : "UNIFIED_SEARCH_ERROR" }))
  process.exit(1)
})
