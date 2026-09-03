import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { coachCommand, coachHelp } from "../src/cli-coach"
import { CliInputError, CliUsageError } from "../src/cli-errors"
import { analyzeJobs, createApplication, createFileApplicationRepository, normalizeCandidateProfile, normalizeJob } from "../src/index"

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })
async function fixture() { const directory = await mkdtemp(join(tmpdir(), "coach-cli-")); directories.push(directory); return directory }
async function applicationFixture(directory: string) {
  const profile = normalizeCandidateProfile({ headline: "Coordinator", targetRoles: ["Coordinator"], locationPreferences: [], workMode: "onsite", remotePreference: false, preferredEmploymentType: ["full-time"], skills: { technical: ["Scheduling"], soft: [] }, yearsOfExperience: 2 })
  const job = normalizeJob({ id: "job-1", source: "fixture", sourceId: "source-1", title: "Coordinator", company: "Example", location: "Malmö", url: null, applyUrl: null, remote: "onsite", employmentType: "full-time", seniority: null, skills: ["Scheduling"], description: null })
  const created = createApplication({ id: "application-1", rankedJob: analyzeJobs(profile, [job]).rankedJobs[0], createdAt: "2026-01-01T00:00:00.000Z", initialNote: { text: "private application note", createdAt: "2026-01-01T00:00:00.000Z" } })
  if (!created.ok) throw new Error(created.error.message)
  const path = join(directory, "applications.json"); const repository = createFileApplicationRepository(path); const saved = await repository.create(created.value)
  if (!saved.ok) throw new Error(saved.error.message)
  return path
}

describe("Phase 7.3 coach CLI", () => {
  it("provides help and candidate create/list/show dispatch", async () => {
    expect(coachHelp()).toBe(0)
    const directory = await fixture()
    expect(await coachCommand(["candidates", "create", "--coach-dir", directory, "--candidate-id", "candidate-a", "--name", "Alex", "--created-at", "2026-01-01T00:00:00.000Z"])).toBe(0)
    expect(await coachCommand(["candidates", "list", "--coach-dir", directory])).toBe(0)
    expect(await coachCommand(["candidates", "show", "--coach-dir", directory, "--candidate-id", "candidate-a"])).toBe(0)
  })

  it("rejects unknown nested commands, unknown options, and duplicate options", async () => {
    const directory = await fixture()
    await expect(coachCommand(["unknown"])).rejects.toBeInstanceOf(CliUsageError)
    await expect(coachCommand(["notes", "list", "--coach-dir", directory, "--unknown", "x"])).rejects.toBeInstanceOf(CliUsageError)
    await expect(coachCommand(["candidates", "list", "--coach-dir", directory, "--coach-dir", directory])).rejects.toThrow("may only be provided once")
  })

  it("requires explicit file or stdin for sensitive note text and never stores application data", async () => {
    const directory = await fixture(); const notePath = join(directory, "note.txt")
    await expect(coachCommand(["notes", "create", "--coach-dir", directory, "--candidate-id", "candidate-a", "--note", "secret", "--note-id", "note-1", "--created-at", "2026-01-01T00:00:00.000Z"])).rejects.toBeInstanceOf(CliUsageError)
    await expect(coachCommand(["notes", "create", "--coach-dir", directory, "--candidate-id", "candidate-a", "--note-file", notePath, "--note-stdin", "--note-id", "note-1", "--created-at", "2026-01-01T00:00:00.000Z"])).rejects.toBeInstanceOf(CliInputError)
    await expect(readFile(join(directory, "operations.json"), "utf8")).rejects.toBeDefined()
  })

  it("creates an association through the existing workflow with safe metadata", async () => {
    const directory = await fixture(); const applicationPath = await applicationFixture(directory)
    await coachCommand(["candidates", "create", "--coach-dir", directory, "--candidate-id", "candidate-a", "--name", "Alex", "--created-at", "2026-01-01T00:00:00.000Z"])
    const lines: string[] = []; const originalLog = console.log; console.log = (...values: unknown[]) => lines.push(values.join(" "))
    try { expect(await coachCommand(["associations", "create", "--coach-dir", directory, "--application-repository", applicationPath, "--candidate-id", "candidate-a", "--application-id", "application-1", "--created-at", "2026-01-02T00:00:00.000Z"])).toBe(0) } finally { console.log = originalLog }
    expect(lines.join("\n")).toContain('"candidateId": "candidate-a"')
    expect(lines.join("\n")).not.toContain("private application note")
    await expect(coachCommand(["associations", "unknown", "--coach-dir", directory])).rejects.toBeInstanceOf(CliUsageError)
    await expect(coachCommand(["associations", "create", "--coach-dir", directory, "--application-repository", applicationPath, "--candidate-id", "candidate-a", "--application-id", "application-1", "--created-at", "bad"])).rejects.toBeInstanceOf(CliInputError)
  })

  it("renders candidate activity reports as JSON, CSV, and Markdown without wrapper prose", async () => {
    const directory = await fixture(); const applicationPath = await applicationFixture(directory)
    await coachCommand(["candidates", "create", "--coach-dir", directory, "--candidate-id", "candidate-a", "--name", "Alex", "--created-at", "2026-01-01T00:00:00.000Z"])
    await coachCommand(["associations", "create", "--coach-dir", directory, "--application-repository", applicationPath, "--candidate-id", "candidate-a", "--application-id", "application-1", "--created-at", "2026-01-02T00:00:00.000Z"])
    const originalWrite = process.stdout.write; let output = ""
    process.stdout.write = ((chunk: string | Uint8Array) => { output += chunk.toString(); return true }) as typeof process.stdout.write
    try {
      expect(await coachCommand(["report", "--coach-dir", directory, "--application-repository", applicationPath, "--candidate-id", "candidate-a", "--start-at", "2026-01-01T00:00:00.000Z", "--end-at", "2026-02-01T00:00:00.000Z"])).toBe(0)
    } finally { process.stdout.write = originalWrite }
    const json = JSON.parse(output)
    expect(json).toMatchObject({ candidateId: "candidate-a", period: { startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-02-01T00:00:00.000Z" }, events: expect.any(Array) })
    expect(output).not.toContain("private application note")
    for (const [format, marker] of [["csv", "candidateId,periodStartAt,periodEndAt,eventKind,timestamp"], ["markdown", "# Candidate Activity Report"]] as const) {
      output = ""
      process.stdout.write = ((chunk: string | Uint8Array) => { output += chunk.toString(); return true }) as typeof process.stdout.write
      try { expect(await coachCommand(["report", "--coach-dir", directory, "--application-repository", applicationPath, "--candidate-id", "candidate-a", "--start-at", "2026-01-01T00:00:00.000Z", "--end-at", "2026-02-01T00:00:00.000Z", "--format", format])).toBe(0) } finally { process.stdout.write = originalWrite }
      expect(output.startsWith(marker)).toBe(true)
      expect(output).not.toContain("private application note")
    }
  })

  it("requires a valid explicit report period and rejects unsupported formats", async () => {
    const directory = await fixture(); const applicationPath = await applicationFixture(directory)
    await coachCommand(["candidates", "create", "--coach-dir", directory, "--candidate-id", "candidate-a", "--name", "Alex", "--created-at", "2026-01-01T00:00:00.000Z"])
    await expect(coachCommand(["report", "--coach-dir", directory, "--application-repository", applicationPath, "--candidate-id", "candidate-a", "--start-at", "2026-02-01T00:00:00.000Z", "--end-at", "2026-01-01T00:00:00.000Z"])).rejects.toMatchObject({ code: "INVALID_PERIOD" })
    await expect(coachCommand(["report", "--coach-dir", directory, "--application-repository", applicationPath, "--candidate-id", "candidate-a", "--start-at", "2026-01-01T00:00:00.000Z", "--end-at", "2026-02-01T00:00:00.000Z", "--format", "xml"])).rejects.toBeInstanceOf(CliUsageError)
    await expect(coachCommand(["report", "--coach-dir", directory, "--application-repository", applicationPath, "--candidate-id", "candidate-a", "--start-at", "2026-01-01T00:00:00.000Z", "--end-at", "2026-02-01T00:00:00.000Z", "--output", "report.json"])).rejects.toBeInstanceOf(CliUsageError)
  })
})