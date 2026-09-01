#!/usr/bin/env bun
import { SourceSelectionError, resolveBuiltInSourceAdapters } from "./adapters"
import { createFileApplicationRepository } from "./application-file-repository"
import { CandidateDocumentEvidenceInputError, loadCandidateDocumentEvidence } from "./document-evidence-input"
import { searchJobs } from "./engine"
import { runMvpWorkflow } from "./mvp-workflow"
import { CandidateProfileInputError, loadCandidateProfile } from "./profile-input"

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

async function searchCommand(argv: string[]) {
  const args = parseArgs(argv)
  const query = typeof args.query === "string" ? args.query : undefined
  const location = typeof args.location === "string" ? args.location : undefined
  const jobage = typeof args.jobage === "string" ? Number(args.jobage) : undefined
  const limit = typeof args.limit === "string" ? Number(args.limit) : undefined
  const format = typeof args.format === "string" ? args.format : "json"
  const includeSourceStatus = true
  const adapters = resolveBuiltInSourceAdapters(parseSourceArguments(argv))
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

function requiredArgument(args: Record<string, string | boolean>, name: string): string {
  const value = args[name]
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`--${name} is required for career-agent run.`)
  return value
}

async function runCommand(argv: string[]) {
  const args = parseArgs(argv)
  const profilePath = requiredArgument(args, "profile")
  const evidencePath = requiredArgument(args, "evidence")
  const repositoryPath = requiredArgument(args, "repository")
  const query = requiredArgument(args, "query")
  const selectedRank = Number(requiredArgument(args, "select"))
  if (!Number.isInteger(selectedRank) || selectedRank < 0) throw new Error("--select must be a non-negative ranked-job index.")
  const profile = await loadCandidateProfile(profilePath)
  const documentEvidence = await loadCandidateDocumentEvidence(evidencePath)
  const result = await runMvpWorkflow({
    profile,
    documentEvidence,
    search: {
      query,
      ...(typeof args.location === "string" ? { location: args.location } : {}),
      ...(typeof args.jobage === "string" ? { jobage: Number(args.jobage) } : {}),
      ...(typeof args.limit === "string" ? { limit: Number(args.limit) } : {}),
      includeSourceStatus: true,
      adapters: resolveBuiltInSourceAdapters(parseSourceArguments(argv)),
    },
    selectedRank,
    application: {
      id: typeof args["application-id"] === "string" ? args["application-id"] : crypto.randomUUID(),
      createdAt: typeof args["created-at"] === "string" ? args["created-at"] : new Date().toISOString(),
      ...(args["allow-duplicate"] === true ? { allowDuplicate: true } : {}),
    },
    documents: [{ type: args.document === "coverLetter" ? "coverLetter" : "cv", language: args.language === "sv" ? "sv" : "en" }],
  }, { searchJobs, applicationRepository: createFileApplicationRepository(repositoryPath) })

  if (!result.ok) {
    console.error(JSON.stringify({ code: `MVP_${result.error.stage.toUpperCase()}_ERROR`, error: result.error }, null, 2))
    return 1
  }
  console.log(JSON.stringify({
    jobsDiscovered: result.search.total,
    sourceStatus: result.search.sourceStatus,
    selectedJob: { rank: result.selectedJob.rank, title: result.selectedJob.job.title, company: result.selectedJob.job.company, source: result.selectedJob.job.source, url: result.selectedJob.job.url, score: result.selectedJob.score, confidence: result.selectedJob.scoringBreakdown.confidence },
    application: { id: result.application.id, status: result.application.status },
    documents: result.documents.map((document) => ({ type: document.type, warnings: document.rendered.warnings })),
  }, null, 2))
  for (const document of result.documents) console.log(`\n--- ${document.type} markdown ---\n${document.rendered.content}`)
  return 0
}

export async function main(argv = Bun.argv.slice(2)) {
  if (argv[0] === "run") return runCommand(argv.slice(1))
  if (argv[0] === "search") return searchCommand(argv.slice(1))
  return searchCommand(argv)
}

main().then((code) => {
  process.exit(code)
}).catch((error) => {
  const code = error instanceof SourceSelectionError
    ? error.code
    : error instanceof CandidateProfileInputError
      ? `PROFILE_${error.code}`
      : error instanceof CandidateDocumentEvidenceInputError
        ? `EVIDENCE_${error.code}`
        : "UNIFIED_SEARCH_ERROR"
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error), code }))
  process.exit(1)
})
