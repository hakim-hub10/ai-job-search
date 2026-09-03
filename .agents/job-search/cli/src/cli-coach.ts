import { readFile } from "node:fs/promises"
import { CliInputError, CliUsageError, validateCommandArguments } from "./cli-errors"
import { createFileCandidateApplicationAssociationRepository } from "./coach-application-association-file-repository"
import { createCoachApplicationWorkflow } from "./coach-application-workflow"
import { createCoachCandidateOverviewWorkflow } from "./coach-candidate-overview-workflow"
import { createCoachCandidateOperationalOverviewWorkflow } from "./coach-candidate-operational-overview-workflow"
import { createCoachCandidateProgressWorkflow } from "./coach-candidate-progress-workflow"
import { createFileCandidateFollowUpRepository } from "./coach-candidate-follow-up-file-repository"
import { createCoachOperationsWorkflow } from "./coach-operations-workflow"
import { createFileCoachOperationsRepository } from "./coach-operations-file-repository"
import { createFileCoachWorkspaceRepository } from "./coach-workspace-file-repository"
import { createCoachCandidateWorkflow } from "./coach-candidate-workflow"
import { createFileApplicationRepository } from "./application-file-repository"
import { resolveCoachRepositoryPaths } from "./coach-cli-paths"

type CliArgs = Record<string, string | boolean>

const USAGE = {
  root: "career-agent coach <candidates|overview|operational-overview|follow-ups|notes|goals|activities> [options]",
  candidates: "career-agent coach candidates <list|show|create> --coach-dir <path> [options]",
  overview: "career-agent coach overview --coach-dir <path> --application-repository <path> --candidate-id <id> --as-of <UTC-ISO>",
  operationalOverview: "career-agent coach operational-overview --coach-dir <path> --application-repository <path> --candidate-id <id> --as-of <UTC-ISO>",
  followUps: "career-agent coach follow-ups <list|create|complete> --coach-dir <path> [options]",
  notes: "career-agent coach notes <list|create|update> --coach-dir <path> [options]",
  goals: "career-agent coach goals <list|create|transition> --coach-dir <path> [options]",
  activities: "career-agent coach activities <list|create|transition> --coach-dir <path> [options]",
} as const

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith("--")) throw new CliUsageError(`Unexpected positional argument: ${token}.`, USAGE.root)
    const key = token.slice(2)
    if (index + 1 < argv.length && !argv[index + 1].startsWith("--")) { args[key] = argv[index + 1]; index += 1 }
    else args[key] = true
  }
  return args
}

function required(args: CliArgs, name: string, usage: string): string {
  const value = args[name]
  if (typeof value !== "string" || value.trim().length === 0) throw new CliUsageError(`--${name} is required.`, usage)
  return value
}

function validate(argv: string[], allowed: readonly string[], usage: string, boolean: readonly string[] = []) {
  validateCommandArguments(argv, { allowed, boolean, usage })
}

async function sensitiveText(args: CliArgs, usage: string, name: string): Promise<string> {
  if (args[name] !== undefined) throw new CliInputError(`Inline ${name} content is not accepted; use --${name}-file or --${name}-stdin.`)
  const fileName = `${name}-file`
  const stdinName = `${name}-stdin`
  if (args[fileName] !== undefined && typeof args[fileName] !== "string") throw new CliInputError(`--${fileName} requires a path.`)
  if (args[stdinName] !== undefined && args[stdinName] !== true) throw new CliInputError(`--${stdinName} does not accept a value.`)
  const file = typeof args[fileName] === "string" ? args[fileName] : undefined
  const stdin = args[stdinName] === true
  if (file && stdin) throw new CliInputError(`Use exactly one of --${fileName} or --${stdinName}.`)
  if (!file && !stdin) throw new CliInputError(`Use exactly one of --${fileName} or --${stdinName}.`)
  if (file) {
    try { return await readFile(file, "utf8") } catch { throw new CliInputError(`${name} file could not be read.`, `${name.toUpperCase()}_FILE_READ_ERROR`) }
  }
  try { return await new Response(Bun.stdin.stream()).text() } catch { throw new CliInputError(`${name} could not be read from stdin.`, `${name.toUpperCase()}_STDIN_READ_ERROR`) }
}

function output(value: unknown): number { console.log(JSON.stringify(value, null, 2)); return 0 }

function workflowError(error: unknown): never {
  let current = error
  let fallback = "Coach operation failed."
  while (typeof current === "object" && current !== null) {
    const item = current as { kind?: string; code?: string; message?: string; error?: unknown }
    if (item.kind) fallback = `Coach operation failed: ${item.kind}.`
    if (item.message) throw new CliInputError(item.message, item.code ?? item.kind ?? "CLI_INPUT_ERROR")
    if (item.code) throw new CliInputError(fallback, item.code)
    if (item.error === undefined) break
    current = item.error
  }
  throw new CliInputError(fallback)
}

function repositories(coachDir: string) {
  const paths = resolveCoachRepositoryPaths(coachDir)
  return {
    paths,
    candidates: createFileCoachWorkspaceRepository(paths.candidates),
    associations: createFileCandidateApplicationAssociationRepository(paths.associations),
    followUps: createFileCandidateFollowUpRepository(paths.followUps),
    operations: createFileCoachOperationsRepository(paths.operations),
  }
}

async function candidatesCommand(argv: string[]): Promise<number> {
  const action = argv[0]
  if (action !== "list" && action !== "show" && action !== "create") throw new CliUsageError("Expected coach candidates list, show, or create.", USAGE.candidates)
  const allowed = action === "list" ? ["coach-dir"] : action === "show" ? ["coach-dir", "candidate-id"] : ["coach-dir", "candidate-id", "name", "created-at"]
  validate(argv.slice(1), allowed, action === "list" ? "career-agent coach candidates list --coach-dir <path>" : USAGE.candidates)
  const args = parseArgs(argv.slice(1)); const repos = repositories(required(args, "coach-dir", USAGE.candidates)); const workflow = createCoachCandidateWorkflow(repos.candidates)
  if (action === "list") { const result = await workflow.listCandidates(); return result.ok ? output(result.value) : workflowError(result.error) }
  const candidateId = required(args, "candidate-id", USAGE.candidates)
  if (action === "show") { const result = await workflow.getCandidate(candidateId); return result.ok ? output(result.value) : workflowError(result.error) }
  const result = await workflow.createCandidate({ id: candidateId, displayName: required(args, "name", USAGE.candidates), createdAt: required(args, "created-at", USAGE.candidates) })
  return result.ok ? output({ id: result.value.id, createdAt: result.value.createdAt }) : workflowError(result.error)
}

async function overviewCommand(argv: string[], operational: boolean): Promise<number> {
  const usage = operational ? USAGE.operationalOverview : USAGE.overview
  validate(argv, ["coach-dir", "application-repository", "candidate-id", "as-of"], usage)
  const args = parseArgs(argv); const repos = repositories(required(args, "coach-dir", usage)); const applications = createFileApplicationRepository(required(args, "application-repository", usage))
  const candidateId = required(args, "candidate-id", usage); const asOf = required(args, "as-of", usage)
  if (operational) {
    const workflow = createCoachCandidateOperationalOverviewWorkflow(repos.candidates, applications, repos.associations, repos.followUps, repos.operations)
    const result = await workflow.getCandidateOperationalOverview(candidateId, asOf)
    return result.ok ? output(result.value) : workflowError(result.error)
  }
  const workflow = createCoachCandidateOverviewWorkflow(repos.candidates, applications, repos.associations, repos.followUps)
  const result = await workflow.getCandidateOverview(candidateId, asOf)
  return result.ok ? output(result.value) : workflowError(result.error)
}

async function followUpsCommand(argv: string[]): Promise<number> {
  const action = argv[0]; if (action !== "list" && action !== "create" && action !== "complete") throw new CliUsageError("Expected coach follow-ups list, create, or complete.", USAGE.followUps)
  const allowed = action === "list" ? ["coach-dir", "candidate-id"] : action === "create" ? ["coach-dir", "application-repository", "candidate-id", "application-id", "follow-up-id", "due-at", "created-at", "updated-at", "completed-at"] : ["coach-dir", "candidate-id", "follow-up-id", "completed-at"]
  validate(argv.slice(1), allowed, USAGE.followUps); const args = parseArgs(argv.slice(1)); const repos = repositories(required(args, "coach-dir", USAGE.followUps))
  const applicationPath = typeof args["application-repository"] === "string" ? args["application-repository"] : undefined
  if (action === "create" && args["application-id"] !== undefined && !applicationPath) throw new CliUsageError("--application-repository is required for application-linked follow-ups.", USAGE.followUps)
  const applications = createFileApplicationRepository(applicationPath ?? "")
  const workflow = createCoachCandidateProgressWorkflow(repos.candidates, applications, repos.associations, repos.followUps)
  if (action === "list") { const result = await workflow.listCandidateFollowUps(required(args, "candidate-id", USAGE.followUps)); return result.ok ? output(result.value) : workflowError(result.error) }
  const candidateId = required(args, "candidate-id", USAGE.followUps); const followUpId = required(args, "follow-up-id", USAGE.followUps)
  if (action === "complete") { const result = await workflow.completeCandidateFollowUp({ candidateId, followUpId, completedAt: required(args, "completed-at", USAGE.followUps) }); return result.ok ? output({ id: result.value.id, completedAt: result.value.completedAt }) : workflowError(result.error) }
  const result = await workflow.createCandidateFollowUp({ id: followUpId, candidateId, ...(typeof args["application-id"] === "string" ? { applicationId: args["application-id"] } : {}), dueAt: required(args, "due-at", USAGE.followUps), createdAt: required(args, "created-at", USAGE.followUps), updatedAt: required(args, "updated-at", USAGE.followUps), ...(typeof args["completed-at"] === "string" ? { completedAt: args["completed-at"] } : {}) })
  return result.ok ? output({ id: result.value.id, candidateId: result.value.candidateId, applicationId: result.value.applicationId }) : workflowError(result.error)
}

async function operationsCommand(argv: string[], resource: "notes" | "goals" | "activities"): Promise<number> {
  const action = argv[0]; const supported = resource === "notes" ? ["list", "create", "update"] : ["list", "create", "transition"]
  if (!supported.includes(action)) throw new CliUsageError(`Expected coach ${resource} ${supported.join(", ")}.`, USAGE[resource])
  const base = ["coach-dir", "candidate-id"]; const allowed = resource === "notes" ? action === "list" ? base : action === "create" ? [...base, "note-id", "note-file", "note-stdin", "created-at"] : [...base, "note-id", "note-file", "note-stdin", "updated-at"] : resource === "goals" ? action === "list" ? base : action === "create" ? [...base, "goal-id", "title", "description-file", "description-stdin", "due-at", "created-at"] : [...base, "goal-id", "status", "updated-at"] : action === "list" ? base : action === "create" ? [...base, "activity-id", "kind", "application-repository", "application-id", "planned-at", "created-at"] : [...base, "activity-id", "status", "updated-at"]
  validate(argv.slice(1), allowed, USAGE[resource], resource === "notes" ? ["note-stdin"] : resource === "goals" ? ["description-stdin"] : []); const args = parseArgs(argv.slice(1)); const repos = repositories(required(args, "coach-dir", USAGE[resource])); const appPath = typeof args["application-repository"] === "string" ? args["application-repository"] : ""
  if (resource === "activities" && action === "create" && args["application-id"] !== undefined && !appPath) throw new CliUsageError("--application-repository is required for application-linked activities.", USAGE.activities)
  const workflow = createCoachOperationsWorkflow(repos.candidates, repos.operations, createFileApplicationRepository(appPath), repos.associations); const candidateId = required(args, "candidate-id", USAGE[resource])
  if (action === "list") { const result = resource === "notes" ? await workflow.listNotes(candidateId) : resource === "goals" ? await workflow.listGoals(candidateId) : await workflow.listActivities(candidateId); return result.ok ? output(result.value) : workflowError(result.error) }
  if (resource === "notes") {
    const text = await sensitiveText(args, USAGE.notes, "note"); const id = required(args, "note-id", USAGE.notes)
    const result = action === "create" ? await workflow.createNote({ id, candidateId, text, createdAt: required(args, "created-at", USAGE.notes) }) : await workflow.updateNote(id, candidateId, { text, updatedAt: required(args, "updated-at", USAGE.notes) })
    return result.ok ? output({ id: result.value.id, candidateId: result.value.candidateId, createdAt: result.value.createdAt, updatedAt: result.value.updatedAt }) : workflowError(result.error)
  }
  if (resource === "goals") {
    const id = required(args, "goal-id", USAGE.goals)
    if (action === "create") { const description = args["description-file"] !== undefined || args["description-stdin"] !== undefined ? await sensitiveText(args, USAGE.goals, "description") : undefined; const result = await workflow.createGoal({ id, candidateId, title: required(args, "title", USAGE.goals), ...(description !== undefined ? { description } : {}), ...(typeof args["due-at"] === "string" ? { dueAt: args["due-at"] } : {}), createdAt: required(args, "created-at", USAGE.goals) }); return result.ok ? output({ id: result.value.id, candidateId: result.value.candidateId, status: result.value.status }) : workflowError(result.error) }
    const result = await workflow.transitionGoal(id, candidateId, { status: required(args, "status", USAGE.goals) as never, updatedAt: required(args, "updated-at", USAGE.goals) }); return result.ok ? output({ id: result.value.id, status: result.value.status, completedAt: result.value.completedAt }) : workflowError(result.error)
  }
  const id = required(args, "activity-id", USAGE.activities)
  if (action === "create") { const result = await workflow.createActivity({ id, candidateId, kind: required(args, "kind", USAGE.activities) as never, ...(typeof args["planned-at"] === "string" ? { plannedAt: args["planned-at"] } : {}), ...(typeof args["application-id"] === "string" ? { applicationId: args["application-id"] } : {}), createdAt: required(args, "created-at", USAGE.activities) }); return result.ok ? output({ id: result.value.id, candidateId: result.value.candidateId, status: result.value.status }) : workflowError(result.error) }
  const result = await workflow.transitionActivity(id, candidateId, { status: required(args, "status", USAGE.activities) as never, updatedAt: required(args, "updated-at", USAGE.activities) }); return result.ok ? output({ id: result.value.id, status: result.value.status, completedAt: result.value.completedAt }) : workflowError(result.error)
}

export async function coachCommand(argv: string[]): Promise<number> {
  const resource = argv[0]
  if (!resource) throw new CliUsageError("A coach resource is required.", USAGE.root)
  if (argv[1] === "--help") return coachHelp()
  if (resource === "candidates") return candidatesCommand(argv.slice(1))
  if (resource === "overview") return overviewCommand(argv.slice(1), false)
  if (resource === "operational-overview") return overviewCommand(argv.slice(1), true)
  if (resource === "follow-ups") return followUpsCommand(argv.slice(1))
  if (resource === "notes" || resource === "goals" || resource === "activities") return operationsCommand(argv.slice(1), resource)
  throw new CliUsageError(`Unknown coach resource: ${resource}.`, USAGE.root)
}

export function coachHelp(): number {
  console.log([USAGE.root, USAGE.candidates, USAGE.overview, USAGE.operationalOverview, USAGE.followUps, USAGE.notes, USAGE.goals, USAGE.activities].join("\n")); return 0
}