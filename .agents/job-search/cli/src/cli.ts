#!/usr/bin/env bun
import { readFile } from "node:fs/promises"
import { SourceSelectionError, resolveBuiltInSourceAdapters } from "./adapters"
import { createFileApplicationRepository } from "./application-file-repository"
import { CliInputError, CliUsageError, formatCliError, parseSafeInteger, safeCliError, validateCommandArguments } from "./cli-errors"
import {
  appendManagedApplicationNote,
  formatNoteAppendConfirmation,
  formatStatusUpdateConfirmation,
  updateManagedApplicationStatus,
} from "./cli-application-management"
import { generateExistingApplicationDocument } from "./cli-application-documents"
import {
  discoverAnalysis,
  discoverApplication,
  discoverApplicationList,
  discoverInterviewQuestions,
  formatAnalysisDiscovery,
  formatApplication,
  formatApplicationList,
  formatInterviewQuestions,
} from "./cli-discovery"
import { CandidateDocumentEvidenceInputError, loadCandidateDocumentEvidence } from "./document-evidence-input"
import { searchJobs } from "./engine"
import { runInterviewCliWorkflow } from "./interview-cli-workflow"
import type { InterviewType } from "./interview-preparation"
import { runMvpWorkflow } from "./mvp-workflow"
import { CandidateProfileInputError, loadCandidateProfile } from "./profile-input"
import { createOpenAIDocumentGenerator } from "./providers/openai-document-generator"
import { createOpenAIInterviewGenerator } from "./providers/openai-interview-generator"
import type { ApplicationWorkflowError } from "./application-workflow"
import type { ApplicationStatus } from "./applications"
import { coachCommand, coachHelp } from "./cli-coach"

class InterviewCliInputError extends CliInputError {}
class DiscoveryCliInputError extends CliInputError {}

const USAGE = {
  search: "career-agent search [--query <query>] [--location <location>] [--jobage <days>] [--limit <count>] [--source <id>] [--format <json|table>]",
  analyze: "career-agent analyze --profile <path> --query <query> [search options]",
  run: "career-agent run --profile <path> --evidence <path> --repository <path> --query <query> --select <zero-based-index>",
  applications: "career-agent applications <list|show|status|note|document> [options]",
  applicationList: "career-agent applications list --repository <path>",
  applicationShow: "career-agent applications show --repository <path> --application-id <id>",
  applicationStatus: "career-agent applications status --repository <path> --application-id <id> --status <status> [--timestamp <UTC-ISO>]",
  applicationNote: "career-agent applications note --repository <path> --application-id <id> (--note-file <path> | --note-stdin) [--timestamp <UTC-ISO>]",
  applicationDocument: "career-agent applications document --repository <path> --application-id <id> --evidence <path> --type <cv|cover-letter> [options]",
  interview: "career-agent interview --repository <path> --application-id <id> --evidence <path> [answer options]",
  interviewQuestions: "career-agent interview questions --repository <path> --application-id <id> --evidence <path>",
} as const

const SEARCH_OPTIONS = ["query", "location", "jobage", "limit", "format", "source"] as const

function validateArgs(argv: string[], allowed: readonly string[], usage: string, options: { boolean?: readonly string[]; repeatable?: readonly string[] } = {}) {
  validateCommandArguments(argv, { allowed, usage, ...options })
}

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

function parseRepeatedArguments(argv: string[], name: string): string[] {
  const values: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== `--${name}`) continue
    const value = argv[index + 1]
    if (!value || value.startsWith("--")) throw new InterviewCliInputError(`--${name} requires a value.`)
    values.push(value)
    index += 1
  }
  return values
}

async function searchCommand(argv: string[]) {
  validateArgs(argv, SEARCH_OPTIONS, USAGE.search, { repeatable: ["source"] })
  const args = parseArgs(argv)
  const query = typeof args.query === "string" ? args.query : undefined
  const location = typeof args.location === "string" ? args.location : undefined
  const jobage = typeof args.jobage === "string" ? parseSafeInteger(args.jobage, "jobage", 1, USAGE.search) : undefined
  const limit = typeof args.limit === "string" ? parseSafeInteger(args.limit, "limit", 1, USAGE.search) : undefined
  const format = typeof args.format === "string" ? args.format : "json"
  if (format !== "json" && format !== "table") throw new CliUsageError("--format must be either json or table.", USAGE.search)
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
  if (typeof value !== "string" || value.trim().length === 0) throw new CliUsageError(`--${name} is required for career-agent run.`, USAGE.run)
  return value
}

function requiredDiscoveryArgument(args: Record<string, string | boolean>, name: string, command: string): string {
  const value = args[name]
  if (typeof value !== "string" || value.trim().length === 0) throw new CliUsageError(`--${name} is required for career-agent ${command}.`, `career-agent ${command} [options]`)
  return value
}

async function analyzeCommand(argv: string[]) {
  validateArgs(argv, ["profile", "query", "location", "jobage", "limit", "source"], USAGE.analyze, { repeatable: ["source"] })
  const args = parseArgs(argv)
  const profile = await loadCandidateProfile(requiredDiscoveryArgument(args, "profile", "analyze"))
  const query = requiredDiscoveryArgument(args, "query", "analyze")
  const result = await discoverAnalysis({
    profile,
    search: {
      query,
      ...(typeof args.location === "string" ? { location: args.location } : {}),
      ...(typeof args.jobage === "string" ? { jobage: parseSafeInteger(args.jobage, "jobage", 1, USAGE.analyze) } : {}),
      ...(typeof args.limit === "string" ? { limit: parseSafeInteger(args.limit, "limit", 1, USAGE.analyze) } : {}),
      includeSourceStatus: true,
      adapters: resolveBuiltInSourceAdapters(parseSourceArguments(argv)),
    },
  }, { searchJobs })
  if (!result.ok) throw new DiscoveryCliInputError(result.error.message, result.error.code)
  console.log(formatAnalysisDiscovery(result))
  return 0
}

async function applicationsCommand(argv: string[]) {
  const action = argv[0]
  if (action !== "list" && action !== "show" && action !== "status" && action !== "note" && action !== "document") {
    throw new CliUsageError("Expected career-agent applications list, show, status, note, or document.", USAGE.applications)
  }
  const applicationSpecs = {
    list: { allowed: ["repository"], usage: USAGE.applicationList },
    show: { allowed: ["repository", "application-id"], usage: USAGE.applicationShow },
    status: { allowed: ["repository", "application-id", "status", "timestamp"], usage: USAGE.applicationStatus },
    note: { allowed: ["repository", "application-id", "note", "note-file", "note-stdin", "timestamp"], boolean: ["note-stdin"], usage: USAGE.applicationNote },
    document: { allowed: ["repository", "application-id", "evidence", "type", "language", "output", "generator", "allow-remote-generation"], boolean: ["allow-remote-generation"], usage: USAGE.applicationDocument },
  } as const
  const spec = applicationSpecs[action]
  validateArgs(argv.slice(1), spec.allowed, spec.usage, { boolean: "boolean" in spec ? spec.boolean : [] })
  const args = parseArgs(argv.slice(1))
  const repository = createFileApplicationRepository(requiredDiscoveryArgument(args, "repository", `applications ${action}`))
  if (action === "list") {
    const result = await discoverApplicationList(repository)
    if (!result.ok) throw new DiscoveryCliInputError(result.error.message, result.error.code)
    console.log(formatApplicationList(result.value))
    return 0
  }
  const applicationId = requiredDiscoveryArgument(args, "application-id", `applications ${action}`)
  if (action === "document") return applicationDocumentCommand(args, repository, applicationId)
  if (action === "show") {
    const result = await discoverApplication(repository, applicationId)
    if (!result.ok) throw new DiscoveryCliInputError(result.error.message, result.error.code)
    console.log(formatApplication(result.value))
    return 0
  }

  if (args.timestamp !== undefined && typeof args.timestamp !== "string") throw new DiscoveryCliInputError("--timestamp requires a value.")
  const timestamp = typeof args.timestamp === "string" ? args.timestamp : new Date().toISOString()
  if (action === "status") {
    const status = requiredDiscoveryArgument(args, "status", "applications status") as ApplicationStatus
    const input = { applicationId, status, timestamp }
    const result = await updateManagedApplicationStatus(repository, input)
    if (!result.ok) throwApplicationWorkflowError(result.error)
    console.log(formatStatusUpdateConfirmation(input))
    return 0
  }

  if (args.note !== undefined) throw new DiscoveryCliInputError("Inline application notes are not accepted; use --note-file or --note-stdin.")
  if (args["note-file"] !== undefined && typeof args["note-file"] !== "string") throw new DiscoveryCliInputError("--note-file requires a path.")
  if (args["note-stdin"] !== undefined && args["note-stdin"] !== true) throw new DiscoveryCliInputError("--note-stdin does not accept a value.")
  const noteFile = typeof args["note-file"] === "string" ? args["note-file"] : undefined
  const noteStdin = args["note-stdin"] === true
  if (noteFile && noteStdin) throw new DiscoveryCliInputError("Use exactly one of --note-file or --note-stdin.")
  if (!noteFile && !noteStdin) throw new DiscoveryCliInputError("Use exactly one of --note-file or --note-stdin.")
  let text: string
  if (noteFile) {
    try { text = await readFile(noteFile, "utf8") } catch { throw new DiscoveryCliInputError("Application note file could not be read.", "NOTE_FILE_READ_ERROR") }
  } else {
    try { text = await new Response(Bun.stdin.stream()).text() } catch { throw new DiscoveryCliInputError("Application note could not be read from stdin.", "NOTE_STDIN_READ_ERROR") }
  }
  const input = { applicationId, text, timestamp }
  const result = await appendManagedApplicationNote(repository, input)
  if (!result.ok) throwApplicationWorkflowError(result.error)
  console.log(formatNoteAppendConfirmation(input))
  return 0
}

async function applicationDocumentCommand(
  args: Record<string, string | boolean>,
  repository: ReturnType<typeof createFileApplicationRepository>,
  applicationId: string,
) {
  const evidencePath = requiredDiscoveryArgument(args, "evidence", "applications document")
  const cliType = requiredDiscoveryArgument(args, "type", "applications document")
  if (cliType !== "cv" && cliType !== "cover-letter") throw new DiscoveryCliInputError("--type must be either cv or cover-letter.")
  if (args.language !== undefined && typeof args.language !== "string") throw new DiscoveryCliInputError("--language requires a value.")
  const language = typeof args.language === "string" ? args.language : "en"
  if (language !== "en" && language !== "sv") throw new DiscoveryCliInputError("--language must be either en or sv.")
  if (args.output !== undefined && typeof args.output !== "string") throw new DiscoveryCliInputError("--output requires a path.")
  const outputPath = typeof args.output === "string" ? args.output : undefined

  const generatorName = typeof args.generator === "string" ? args.generator : undefined
  if (args["allow-remote-generation"] === true && !generatorName) throw new DiscoveryCliInputError("--allow-remote-generation requires --generator openai.")
  if (generatorName && generatorName !== "openai") throw new DiscoveryCliInputError("Unsupported generator. Supported generator: openai.")
  if (generatorName === "openai" && args["allow-remote-generation"] !== true) throw new DiscoveryCliInputError("OpenAI generation requires --allow-remote-generation.")
  if (generatorName === "openai" && !process.env.OPENAI_API_KEY?.trim()) throw new DiscoveryCliInputError("OpenAI generation was requested but OPENAI_API_KEY is not configured.")

  const application = await discoverApplication(repository, applicationId)
  if (!application.ok) throw new DiscoveryCliInputError(application.error.message, application.error.code)
  const documentEvidence = await loadCandidateDocumentEvidence(evidencePath)
  const generator = generatorName === "openai"
    ? createOpenAIDocumentGenerator({ enabled: true, remoteGenerationConsent: true, apiKey: process.env.OPENAI_API_KEY!, model: "gpt-4.1-mini", maxOutputTokens: 1200, timeoutMs: 30_000 })
    : undefined
  const type = cliType === "cover-letter" ? "coverLetter" : "cv"
  const result = await generateExistingApplicationDocument({
    application: application.value,
    candidateDocumentInput: documentEvidence,
    type,
    language,
    ...(outputPath ? { outputPath } : {}),
    ...(generator ? { generator } : {}),
  })
  if (!result.ok) throw new DiscoveryCliInputError(result.error.error.message, result.error.error.code)

  console.log(`Document: ${cliType} | Language: ${language} | Application: ${applicationId}`)
  for (const warning of result.deterministic.warnings) console.log(`Warning [${warning.code}]: ${warning.message}`)
  if (result.outputPath) console.log(`Deterministic document written to ${result.outputPath}.`)
  else console.log(`\n--- ${cliType} markdown ---\n${result.deterministic.content}`)
  if (result.ai && !result.ai.ok) console.log(`AI document proposal warning [${result.ai.error.error.code}]: ${result.ai.error.error.message}`)
  if (result.ai?.ok) {
    console.log(`\n--- AI-generated ${cliType} proposal — review required ---`)
    console.log("Requires human review: true")
    console.log(result.ai.value.renderedDocument.content)
  }
  return 0
}

function throwApplicationWorkflowError(error: ApplicationWorkflowError): never {
  if (error.kind === "duplicate_advisory") throw new DiscoveryCliInputError("Unexpected duplicate advisory during application update.")
  throw new DiscoveryCliInputError(error.error.message, error.error.code)
}

async function interviewQuestionsCommand(argv: string[]) {
  validateArgs(argv, ["repository", "application-id", "evidence", "language", "interview-type"], USAGE.interviewQuestions)
  const args = parseArgs(argv)
  const repositoryPath = requiredDiscoveryArgument(args, "repository", "interview questions")
  const applicationId = requiredDiscoveryArgument(args, "application-id", "interview questions")
  const evidencePath = requiredDiscoveryArgument(args, "evidence", "interview questions")
  const language = typeof args.language === "string" ? args.language : "en"
  if (language !== "en" && language !== "sv") throw new DiscoveryCliInputError("--language must be either en or sv.")
  const interviewType = typeof args["interview-type"] === "string" ? args["interview-type"] : "hiringManager"
  const supportedTypes: InterviewType[] = ["recruiterScreening", "hiringManager", "behavioral", "roleSpecific", "situational"]
  if (!supportedTypes.includes(interviewType as InterviewType)) throw new DiscoveryCliInputError("Unsupported interview type.")
  const application = await discoverApplication(createFileApplicationRepository(repositoryPath), applicationId)
  if (!application.ok) throw new DiscoveryCliInputError(application.error.message, application.error.code)
  const documentEvidence = await loadCandidateDocumentEvidence(evidencePath)
  const prepared = discoverInterviewQuestions({ application: application.value, documentEvidence, language, interviewType: interviewType as InterviewType })
  if (!prepared.ok) throw new DiscoveryCliInputError(prepared.error.message, prepared.error.code)
  console.log(formatInterviewQuestions(prepared.value))
  return 0
}

function helpCommand() {
  console.log([
    "career-agent --query <query> [search options]",
    "career-agent search --query <query> [search options]",
    "career-agent analyze --profile <path> --query <query> [search options]",
    "career-agent run --profile <path> --evidence <path> --repository <path> --query <query> --select <zero-based-index>",
    "career-agent applications list --repository <path>",
    "career-agent applications show --repository <path> --application-id <id>",
    "career-agent applications status --repository <path> --application-id <id> --status <status> [--timestamp <UTC-ISO>]",
    "career-agent applications note --repository <path> --application-id <id> (--note-file <path> | --note-stdin) [--timestamp <UTC-ISO>]",
    "career-agent applications document --repository <path> --application-id <id> --evidence <path> --type <cv|cover-letter> [--language <en|sv>] [--output <path>] [--generator openai --allow-remote-generation]",
    "career-agent interview --repository <path> --application-id <id> --evidence <path> [answer options]",
    "career-agent interview questions --repository <path> --application-id <id> --evidence <path>",
    "career-agent coach <candidates|overview|operational-overview|follow-ups|notes|goals|activities> [options]",
  ].join("\n"))
  return 0
}

async function runCommand(argv: string[]) {
  validateArgs(argv, ["profile", "evidence", "repository", "query", "select", "generator", "allow-remote-generation", "location", "jobage", "limit", "source", "application-id", "created-at", "allow-duplicate", "document", "language"], USAGE.run, { boolean: ["allow-remote-generation", "allow-duplicate"], repeatable: ["source"] })
  const args = parseArgs(argv)
  const profilePath = requiredArgument(args, "profile")
  const evidencePath = requiredArgument(args, "evidence")
  const repositoryPath = requiredArgument(args, "repository")
  const query = requiredArgument(args, "query")
  const selectedRank = parseSafeInteger(requiredArgument(args, "select"), "select", 0, USAGE.run)
  const generatorName = typeof args.generator === "string" ? args.generator : undefined
  if (args["allow-remote-generation"] === true && !generatorName) throw new CliUsageError("--allow-remote-generation requires --generator openai.", USAGE.run)
  if (generatorName && generatorName !== "openai") throw new CliUsageError("Unsupported generator. Supported generator: openai.", USAGE.run)
  if (generatorName === "openai" && args["allow-remote-generation"] !== true) throw new CliUsageError("OpenAI generation requires --allow-remote-generation.", USAGE.run)
  if (generatorName === "openai" && !process.env.OPENAI_API_KEY?.trim()) throw new CliUsageError("OpenAI generation was requested but OPENAI_API_KEY is not configured.", USAGE.run)
  const generation = generatorName === "openai"
    ? { generator: createOpenAIDocumentGenerator({ enabled: true, remoteGenerationConsent: true, apiKey: process.env.OPENAI_API_KEY!, model: "gpt-4.1-mini", maxOutputTokens: 1200, timeoutMs: 30_000 }) }
    : undefined
  const profile = await loadCandidateProfile(profilePath)
  const documentEvidence = await loadCandidateDocumentEvidence(evidencePath)
  const result = await runMvpWorkflow({
    profile,
    documentEvidence,
    search: {
      query,
      ...(typeof args.location === "string" ? { location: args.location } : {}),
      ...(typeof args.jobage === "string" ? { jobage: parseSafeInteger(args.jobage, "jobage", 1, USAGE.run) } : {}),
      ...(typeof args.limit === "string" ? { limit: parseSafeInteger(args.limit, "limit", 1, USAGE.run) } : {}),
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
    ...(generation ? { generation } : {}),
  }, { searchJobs, applicationRepository: createFileApplicationRepository(repositoryPath) })

  if (!result.ok) {
    console.error(JSON.stringify({ code: `MVP_${result.error.stage.toUpperCase()}_ERROR`, error: result.error }, null, 2))
    return 1
  }
  console.log(JSON.stringify({
    jobsDiscovered: result.search.total,
    retrievalLimitPerSource: result.retrievalPlan.retrievalLimit,
    jobsEligible: result.relevance.eligibleJobs.length,
    jobsSelectedForAnalysis: result.analysis.inputJobCount,
    jobsExcludedOrUncertain: result.relevance.excludedJobs.length,
    detailEnrichment: result.enrichment.records.map(({ jobId, source, status, enrichedFields, conflicts }) => ({ jobId, source, status, enrichedFields, conflictFields: conflicts.map((conflict) => conflict.field) })),
    sourceStatus: result.search.sourceStatus,
    selectedJob: { rank: result.selectedJob.rank, title: result.selectedJob.job.title, company: result.selectedJob.job.company, source: result.selectedJob.job.source, url: result.selectedJob.job.url, score: result.selectedJob.score, confidence: result.selectedJob.scoringBreakdown.confidence },
    application: { id: result.application.id, status: result.application.status },
    documents: result.documents.map((document) => ({ type: document.type, warnings: document.rendered.warnings })),
    generatedDocuments: result.generatedDocuments.map((document) => document.result.ok
      ? { generator: generatorName, type: document.type, requiresHumanReview: document.result.value.document.requiresHumanReview, warnings: document.result.value.renderedDocument.warnings }
      : { generator: generatorName, type: document.type, error: document.result.error }),
  }, null, 2))
  for (const document of result.documents) console.log(`\n--- ${document.type} markdown ---\n${document.rendered.content}`)
  for (const document of result.generatedDocuments) if (document.result.ok) console.log(`\n--- AI-generated ${document.type} proposal — review required ---\n${document.result.value.renderedDocument.content}`)
  return 0
}

function requiredInterviewArgument(args: Record<string, string | boolean>, name: string): string {
  const value = args[name]
  if (typeof value !== "string" || value.trim().length === 0) throw new CliUsageError(`--${name} is required for career-agent interview.`, USAGE.interview)
  return value
}

async function interviewCommand(argv: string[]) {
  validateArgs(argv, ["repository", "application-id", "evidence", "answer-file", "answer-stdin", "question-id", "cite-evidence", "answer", "language", "interview-type", "interview-generator", "allow-remote-interview-generation"], USAGE.interview, { boolean: ["answer-stdin", "allow-remote-interview-generation"], repeatable: ["cite-evidence"] })
  const args = parseArgs(argv)
  const repositoryPath = requiredInterviewArgument(args, "repository")
  const applicationId = requiredInterviewArgument(args, "application-id")
  const evidencePath = requiredInterviewArgument(args, "evidence")
  if (args["answer-file"] !== undefined && typeof args["answer-file"] !== "string") throw new InterviewCliInputError("--answer-file requires a path.")
  if (args["answer-stdin"] !== undefined && args["answer-stdin"] !== true) throw new InterviewCliInputError("--answer-stdin does not accept a value.")
  if (args["question-id"] !== undefined && typeof args["question-id"] !== "string") throw new InterviewCliInputError("--question-id requires a value.")
  const answerFile = typeof args["answer-file"] === "string" ? args["answer-file"] : undefined
  const answerStdin = args["answer-stdin"] === true
  if (answerFile && answerStdin) throw new InterviewCliInputError("Use exactly one of --answer-file or --answer-stdin.")
  if (args.answer !== undefined) throw new InterviewCliInputError("Raw interview answers are not accepted as command arguments; use --answer-file or --answer-stdin.")
  const evaluationMode = Boolean(answerFile || answerStdin)
  const citedEvidenceIds = parseRepeatedArguments(argv, "cite-evidence")
  if (citedEvidenceIds.length > 0 && !evaluationMode) throw new InterviewCliInputError("--cite-evidence requires --answer-file or --answer-stdin.")

  if (args.language !== undefined && typeof args.language !== "string") throw new InterviewCliInputError("--language requires a value.")
  const language = typeof args.language === "string" ? args.language : "en"
  if (language !== "en" && language !== "sv") throw new InterviewCliInputError("--language must be either en or sv.")
  if (args["interview-type"] !== undefined && typeof args["interview-type"] !== "string") throw new InterviewCliInputError("--interview-type requires a value.")
  const interviewType = typeof args["interview-type"] === "string" ? args["interview-type"] : "hiringManager"
  const supportedTypes: InterviewType[] = ["recruiterScreening", "hiringManager", "behavioral", "roleSpecific", "situational"]
  if (!supportedTypes.includes(interviewType as InterviewType)) throw new InterviewCliInputError("Unsupported interview type.")

  if (args["interview-generator"] !== undefined && typeof args["interview-generator"] !== "string") throw new InterviewCliInputError("--interview-generator requires a value.")
  if (args["allow-remote-interview-generation"] !== undefined && args["allow-remote-interview-generation"] !== true) throw new InterviewCliInputError("--allow-remote-interview-generation does not accept a value.")
  const generatorName = typeof args["interview-generator"] === "string" ? args["interview-generator"] : undefined
  const remoteConsent = args["allow-remote-interview-generation"] === true
  if (remoteConsent && !generatorName) throw new InterviewCliInputError("--allow-remote-interview-generation requires --interview-generator openai.")
  if (generatorName && generatorName !== "openai") throw new InterviewCliInputError("Unsupported interview generator. Supported generator: openai.")
  if (generatorName === "openai" && !remoteConsent) throw new InterviewCliInputError("OpenAI interview generation requires --allow-remote-interview-generation.")
  if ((generatorName || remoteConsent) && !evaluationMode) throw new InterviewCliInputError("Remote interview generation requires --answer-file or --answer-stdin.")
  if (generatorName === "openai" && !process.env.OPENAI_API_KEY?.trim()) throw new InterviewCliInputError("OpenAI interview generation was requested but OPENAI_API_KEY is not configured.")

  let answerText: string | undefined
  if (answerFile) {
    try { answerText = await readFile(answerFile, "utf8") } catch { throw new InterviewCliInputError("Interview answer file could not be read.") }
  } else if (answerStdin) {
    try { answerText = await new Response(Bun.stdin.stream()).text() } catch { throw new InterviewCliInputError("Interview answer could not be read from stdin.") }
  }
  if (answerText !== undefined && answerText.trim().length === 0) throw new InterviewCliInputError("Interview answer must not be empty.")

  const repository = createFileApplicationRepository(repositoryPath)
  const application = await repository.getById(applicationId)
  if (!application.ok) throw new InterviewCliInputError(`Application lookup failed: ${application.error.message}`)
  const documentEvidence = await loadCandidateDocumentEvidence(evidencePath)
  const generator = generatorName === "openai"
    ? createOpenAIInterviewGenerator({ enabled: true, remoteGenerationConsent: true, apiKey: process.env.OPENAI_API_KEY!, model: "gpt-4.1-mini", maxOutputTokens: 1200, timeoutMs: 30_000 })
    : undefined
  if (generator) console.log("Remote interview generation enabled: minimized interview content will be sent to the configured provider.")
  const result = await runInterviewCliWorkflow({
    application: application.value,
    documentEvidence,
    questionId: typeof args["question-id"] === "string" ? args["question-id"] : undefined,
    language,
    interviewType: interviewType as InterviewType,
    ...(answerText === undefined ? {} : { answer: { text: answerText, citedEvidenceIds } }),
    ...(generator ? { generator } : {}),
  })
  if (!result.ok) {
    console.error(`Interview ${result.error.stage} error [${result.error.code}]: ${result.error.message}`)
    return 1
  }

  console.log(`Interview preparation for ${result.plan.job.jobTitle}${result.plan.job.company ? ` at ${result.plan.job.company}` : ""}`)
  console.log(`Application: ${result.plan.applicationId}`)
  console.log(`Language: ${result.plan.language}`)
  console.log(`Interview type: ${result.plan.interviewType}`)
  console.log(`Question ID: ${result.question.id}`)
  console.log(`Category: ${result.question.category}`)
  console.log(`Question: ${result.question.prompt}`)
  if (result.mode === "preparation") return 0

  const turn = result.session.turns.find((candidate) => candidate.questionId === result.question.id)
  if (turn?.status === "submitted") {
    console.log(`Cited evidence IDs: ${turn.preparation.citedEvidence.map((item) => item.evidenceId).join(", ") || "none"}`)
    console.log(`STAR structure: ${turn.preparation.structuralChecks.star}`)
    console.log(`Semantic support: ${turn.preparation.structuralChecks.semanticSupport}`)
    for (const warning of turn.preparation.warnings) console.log(`Warning [${warning.code}]: ${warning.message}`)
  }
  const feedback = result.deterministicFeedback.questionFeedback.find((candidate) => candidate.questionId === result.question.id)
  for (const item of feedback?.observations ?? []) console.log(`Observation [${item.code}]: ${item.message}`)
  for (const item of feedback?.improvementPriorities ?? []) console.log(`Improvement priority [${item.code}]: ${item.message}`)
  console.log(`Deterministic feedback semantic support: ${result.deterministicFeedback.semanticSupport}`)
  if (result.ai && !result.ai.ok) console.log(`AI proposal warning [${result.ai.error.code}]: ${result.ai.error.message}`)
  if (result.ai?.ok) {
    console.log("AI-generated interview proposal — review required")
    console.log("Not deterministic truth or an authoritative assessment.")
    console.log(`Requires human review: ${result.ai.value.requiresHumanReview}`)
    for (const item of result.ai.value.proposal.feedback) console.log(`AI feedback proposal [${item.category}]: ${item.suggestion}`)
    for (const item of result.ai.value.proposal.followUpQuestions) console.log(`AI follow-up proposal — review required: ${item.prompt}`)
  }
  return 0
}

export async function main(argv = Bun.argv.slice(2)) {
  if (argv.length === 0) return helpCommand()
  if (argv[0] === "--help") return helpCommand()
  if (argv[0] === "analyze") return analyzeCommand(argv.slice(1))
  if (argv[0] === "coach") {
    if (argv[1] === "--help" || argv.length === 1) return coachHelp()
    return coachCommand(argv.slice(1))
  }
  if (argv[0] === "applications") return applicationsCommand(argv.slice(1))
  if (argv[0] === "run") return runCommand(argv.slice(1))
  if (argv[0] === "interview" && argv[1] === "questions") return interviewQuestionsCommand(argv.slice(2))
  if (argv[0] === "interview") {
    if (argv[1] && !argv[1].startsWith("--")) throw new CliUsageError(`Unknown interview action: ${argv[1]}.`, USAGE.interview)
    return interviewCommand(argv.slice(1))
  }
  if (argv[0] === "search") return searchCommand(argv.slice(1))
  if (argv[0].startsWith("--")) return searchCommand(argv)
  throw new CliUsageError(`Unknown command: ${argv[0]}.`, "career-agent --help")
}

main().then((code) => {
  process.exit(code)
}).catch((error) => {
  const safe = safeCliError(error, (candidate) => candidate instanceof SourceSelectionError
    ? { error: candidate.message, code: candidate.code }
    : candidate instanceof CandidateProfileInputError
      ? { error: candidate.message, code: `PROFILE_${candidate.code}` }
      : candidate instanceof CandidateDocumentEvidenceInputError
        ? { error: candidate.message, code: `EVIDENCE_${candidate.code}` }
        : candidate instanceof InterviewCliInputError || candidate instanceof DiscoveryCliInputError
          ? { error: candidate.message, code: candidate.code }
          : candidate instanceof Error && candidate.message.startsWith("--")
            ? { error: candidate.message, code: "CLI_USAGE_ERROR" }
            : undefined)
  console.error(formatCliError(safe))
  process.exit(1)
})
