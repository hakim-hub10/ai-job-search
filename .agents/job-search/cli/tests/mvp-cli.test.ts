import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { analyzeJobs, createApplication, createFileApplicationRepository, normalizeCandidateProfile, normalizeJob } from "../src/index"

const cliPath = resolve(import.meta.dir, "../src/cli.ts")
async function invoke(args: string[], options: { stdin?: string; apiKey?: string } = {}) {
  const proc = Bun.spawn({ cmd: [process.execPath, cliPath, ...args], stdout: "pipe", stderr: "pipe", stdin: options.stdin === undefined ? undefined : new Blob([options.stdin]), env: { ...process.env, OPENAI_API_KEY: options.apiKey ?? "" } })
  return { code: await proc.exited, stdout: await new Response(proc.stdout).text(), stderr: await new Response(proc.stderr).text() }
}

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

async function interviewFixture() {
  const directory = await mkdtemp(join(tmpdir(), "career-agent-interview-cli-")); directories.push(directory)
  const repositoryPath = join(directory, "applications.json")
  const evidencePath = join(directory, "evidence.json")
  const answerPath = join(directory, "answer.txt")
  const profile = normalizeCandidateProfile({ headline: "Coordinator", targetRoles: ["Coordinator"], locationPreferences: ["Aarhus"], workMode: "onsite", remotePreference: false, preferredEmploymentType: ["full-time"], skills: { technical: ["Scheduling"], soft: ["Communication"] }, yearsOfExperience: 3 })
  const job = normalizeJob({ source: "fixture", sourceId: "job-1", title: "Clinic Coordinator", company: "Example Clinic", location: "Aarhus", url: "https://example.test/job", applyUrl: null, remote: "onsite", employmentType: "full-time", seniority: "mid", skills: ["Scheduling", "Inventory"], description: "A normal fixture." })
  const application = createApplication({ id: "application-1", rankedJob: analyzeJobs(profile, [job]).rankedJobs[0], createdAt: "2026-01-01T00:00:00.000Z" })
  if (!application.ok) throw new Error(application.error.message)
  const repository = createFileApplicationRepository(repositoryPath)
  const saved = await repository.create(application.value)
  if (!saved.ok) throw new Error(saved.error.message)
  await writeFile(evidencePath, JSON.stringify({ evidence: [{ id: "experience", kind: "experience", content: "PRIVATE EVIDENCE coordinated schedules by 35%.", relatedRequirements: [{ category: "skill", value: "Scheduling" }] }] }))
  await writeFile(answerPath, "PRIVATE ANSWER coordinated schedules by 35%.")
  return { directory, repositoryPath, evidencePath, answerPath }
}

function interviewArgs(fixture: Awaited<ReturnType<typeof interviewFixture>>) {
  return ["interview", "--repository", fixture.repositoryPath, "--application-id", "application-1", "--evidence", fixture.evidencePath]
}

describe("MVP CLI command boundary", () => {
  it("keeps legacy and explicit search source selection behavior", async () => {
    const legacy = await invoke(["--source", "does-not-exist"])
    const explicit = await invoke(["search", "--source", "does-not-exist"])
    expect(legacy.code).toBe(1)
    expect(explicit.code).toBe(1)
    expect(JSON.parse(legacy.stderr)).toMatchObject({ code: "UNKNOWN_SOURCE" })
    expect(JSON.parse(explicit.stderr)).toMatchObject({ code: "UNKNOWN_SOURCE" })
  })

  it("requires explicit profile, evidence, repository, query, and selection before any search", async () => {
    await expect(invoke(["run"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("--profile is required") })
    await expect(invoke(["run", "--profile", "missing.json"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("--evidence is required") })
    await expect(invoke(["run", "--profile", "missing.json", "--evidence", "missing.json"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("--repository is required") })
  })

  it("requires explicit generator selection, consent, and credentials without network access", async () => {
    await expect(invoke(["run", "--profile", "x", "--evidence", "x", "--repository", "x", "--query", "x", "--select", "0", "--generator", "openai"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("requires --allow-remote-generation") })
    await expect(invoke(["run", "--profile", "x", "--evidence", "x", "--repository", "x", "--query", "x", "--select", "0", "--generator", "other"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("Unsupported generator") })
  })

  it("runs interview preparation without reading an answer or activating AI", async () => {
    const fixture = await interviewFixture()
    const result = await invoke(interviewArgs(fixture), { apiKey: "key-presence-alone-must-do-nothing" })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("Question ID:")
    expect(result.stdout).toContain("Question:")
    expect(result.stdout).not.toContain("Remote interview generation enabled")
    expect(result.stdout).not.toContain("PRIVATE EVIDENCE")
  })

  it("evaluates answer-file with repeatable citations without outputting raw answer or evidence", async () => {
    const fixture = await interviewFixture()
    const result = await invoke([...interviewArgs(fixture), "--answer-file", fixture.answerPath, "--cite-evidence", "experience", "--cite-evidence", "experience"])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("DUPLICATE_EVIDENCE_ID")
    expect(result.stderr).not.toContain("PRIVATE ANSWER")
    expect(result.stderr).not.toContain("PRIVATE EVIDENCE")
    const success = await invoke([...interviewArgs(fixture), "--answer-file", fixture.answerPath, "--cite-evidence", "experience"])
    expect(success.code).toBe(0)
    expect(success.stdout).toContain("Cited evidence IDs: experience")
    expect(success.stdout).toContain("Semantic support: notDetermined")
    expect(success.stdout).not.toContain("PRIVATE ANSWER")
    expect(success.stdout).not.toContain("PRIVATE EVIDENCE")
  })

  it("reads stdin only when explicitly requested and rejects competing or empty answer inputs", async () => {
    const fixture = await interviewFixture()
    const fromStdin = await invoke([...interviewArgs(fixture), "--answer-stdin", "--cite-evidence", "experience"], { stdin: "A supported private stdin answer." })
    expect(fromStdin).toMatchObject({ code: 0 })
    expect(fromStdin.stdout).not.toContain("private stdin answer")
    await expect(invoke([...interviewArgs(fixture), "--answer-file", fixture.answerPath, "--answer-stdin"], { stdin: "ignored" })).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("exactly one") })
    await expect(invoke([...interviewArgs(fixture), "--answer-stdin"], { stdin: "   \n" })).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("must not be empty") })
  })

  it("returns safe failures for answer files, application lookup, question, language, and interview type", async () => {
    const fixture = await interviewFixture()
    await expect(invoke([...interviewArgs(fixture), "--answer-file", join(fixture.directory, "missing.txt")])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("could not be read") })
    const missingApplication = interviewArgs(fixture); missingApplication[missingApplication.indexOf("application-1")] = "missing"
    await expect(invoke(missingApplication)).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("Application record was not found") })
    await expect(invoke([...interviewArgs(fixture), "--question-id", "missing-question"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("UNKNOWN_QUESTION_ID") })
    await expect(invoke([...interviewArgs(fixture), "--language", "da"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("either en or sv") })
    await expect(invoke([...interviewArgs(fixture), "--interview-type", "panel"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("Unsupported interview type") })
  })

  it("enforces interview-specific provider, consent, answer, and environment-key boundaries before network", async () => {
    const fixture = await interviewFixture(); const base = interviewArgs(fixture)
    await expect(invoke([...base, "--answer-file", fixture.answerPath, "--interview-generator", "openai"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("requires --allow-remote-interview-generation") })
    await expect(invoke([...base, "--answer-file", fixture.answerPath, "--allow-remote-interview-generation"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("requires --interview-generator openai") })
    await expect(invoke([...base, "--answer-file", fixture.answerPath, "--interview-generator", "other"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("Unsupported interview generator") })
    await expect(invoke([...base, "--interview-generator", "openai", "--allow-remote-interview-generation"], { apiKey: "configured" })).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("requires --answer-file or --answer-stdin") })
    await expect(invoke([...base, "--answer-file", fixture.answerPath, "--interview-generator", "openai", "--allow-remote-interview-generation"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("OPENAI_API_KEY is not configured") })
  })

  it("rejects a raw-answer flag and preserves existing search/run dispatch", async () => {
    const fixture = await interviewFixture()
    await expect(invoke([...interviewArgs(fixture), "--answer", "PRIVATE CLI ANSWER"])).resolves.toMatchObject({ code: 1, stderr: expect.not.stringContaining("PRIVATE CLI ANSWER") })
    await expect(invoke(["search", "--source", "does-not-exist"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("UNKNOWN_SOURCE") })
    await expect(invoke(["run"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("--profile is required") })
  })

  it("shows the H2 command tree and routes analyze without changing legacy commands", async () => {
    const help = await invoke(["--help"], { apiKey: "key-presence-alone-must-do-nothing" })
    expect(help.code).toBe(0)
    for (const route of ["search", "analyze", "run", "applications list", "applications show", "interview", "interview questions"]) {
      expect(help.stdout).toContain(`career-agent ${route}`)
    }
    expect(help.stdout).not.toContain("key-presence-alone-must-do-nothing")
    await expect(invoke(["analyze"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("--profile is required") })
    await expect(invoke(["analyze", "--profile", "missing.json"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("PROFILE_READ_FAILURE") })
    await expect(invoke(["search", "--source", "does-not-exist"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("UNKNOWN_SOURCE") })
    await expect(invoke(["run"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("--profile is required") })
  })

  it("routes application list/show reads and fails safely for invalid nested commands and IDs", async () => {
    const fixture = await interviewFixture()
    const listed = await invoke(["applications", "list", "--repository", fixture.repositoryPath])
    expect(listed).toMatchObject({ code: 0 })
    expect(listed.stdout).toContain("application-1 | Clinic Coordinator | Example Clinic | saved")
    expect(listed.stdout).not.toContain("PRIVATE")
    const shown = await invoke(["applications", "show", "--repository", fixture.repositoryPath, "--application-id", "application-1"])
    expect(shown).toMatchObject({ code: 0 })
    expect(shown.stdout).toContain("Application ID: application-1")
    expect(shown.stdout).toContain("Confirmed gaps:")
    expect(shown.stdout).not.toContain("PRIVATE")
    await expect(invoke(["applications", "show", "--repository", fixture.repositoryPath, "--application-id", "missing"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("NOT_FOUND") })
    await expect(invoke(["applications", "remove"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("applications list") })
    await expect(invoke(["applications", "list"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("--repository is required") })
  })

  it("routes complete interview question discovery without answers, persistence, or provider activation", async () => {
    const fixture = await interviewFixture()
    const before = await readFile(fixture.repositoryPath, "utf8")
    const result = await invoke(["interview", "questions", "--repository", fixture.repositoryPath, "--application-id", "application-1", "--evidence", fixture.evidencePath, "--language", "sv"], { apiKey: "configured-but-inert" })
    expect(result).toMatchObject({ code: 0 })
    expect(result.stdout).toContain("Language: sv")
    expect(result.stdout.match(/Question ID:/g)?.length).toBeGreaterThan(1)
    expect(result.stdout).not.toContain("PRIVATE EVIDENCE")
    expect(result.stdout).not.toContain("configured-but-inert")
    expect(result.stdout).not.toContain("Remote interview generation enabled")
    expect(await readFile(fixture.repositoryPath, "utf8")).toBe(before)
    const bare = await invoke(interviewArgs(fixture), { apiKey: "configured-but-inert" })
    expect(bare).toMatchObject({ code: 0 })
    expect(bare.stdout.match(/Question ID:/g)).toHaveLength(1)
    await expect(invoke(["interview", "questions"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("--repository is required") })
  })

  it("updates application status with explicit timestamps and persists append-only history", async () => {
    const fixture = await interviewFixture()
    const timestamp = "2026-02-01T00:00:00.000Z"
    const result = await invoke(["applications", "status", "--repository", fixture.repositoryPath, "--application-id", "application-1", "--status", "applied", "--timestamp", timestamp], { apiKey: "configured-but-inert" })
    expect(result).toEqual({ code: 0, stdout: `Application application-1 status updated to applied at ${timestamp}.\n`, stderr: "" })
    const persisted = await createFileApplicationRepository(fixture.repositoryPath).getById("application-1")
    expect(persisted).toMatchObject({ ok: true, value: { status: "applied", updatedAt: timestamp, statusHistory: [{ status: "saved" }, { status: "applied", timestamp }] } })
    await expect(invoke(["applications", "status", "--repository", fixture.repositoryPath, "--application-id", "application-1", "--status", "invalid", "--timestamp", timestamp])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("INVALID_APPLICATION_STATUS") })
    await expect(invoke(["applications", "status", "--repository", fixture.repositoryPath, "--application-id", "application-1"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("--status is required") })
  })

  it("appends private notes from an explicit file or stdin without echoing their contents", async () => {
    const fixture = await interviewFixture()
    const notePath = join(fixture.directory, "note.txt")
    const fileNote = "  PRIVATE FILE NOTE\nkept exactly\n"
    const stdinNote = "PRIVATE STDIN NOTE\n"
    await writeFile(notePath, fileNote, "utf8")
    const fromFile = await invoke(["applications", "note", "--repository", fixture.repositoryPath, "--application-id", "application-1", "--note-file", notePath, "--timestamp", "2026-02-01T00:00:00.000Z"], { apiKey: "configured-but-inert" })
    expect(fromFile).toEqual({ code: 0, stdout: "Application application-1 note added at 2026-02-01T00:00:00.000Z.\n", stderr: "" })
    expect(fromFile.stdout).not.toContain(fileNote)
    const fromStdin = await invoke(["applications", "note", "--repository", fixture.repositoryPath, "--application-id", "application-1", "--note-stdin", "--timestamp", "2026-03-01T00:00:00.000Z"], { stdin: stdinNote, apiKey: "configured-but-inert" })
    expect(fromStdin).toEqual({ code: 0, stdout: "Application application-1 note added at 2026-03-01T00:00:00.000Z.\n", stderr: "" })
    expect(fromStdin.stdout).not.toContain(stdinNote)
    const persisted = await createFileApplicationRepository(fixture.repositoryPath).getById("application-1")
    expect(persisted.ok && persisted.value.notes).toEqual([{ text: fileNote, createdAt: "2026-02-01T00:00:00.000Z" }, { text: stdinNote, createdAt: "2026-03-01T00:00:00.000Z" }])
  })

  it("rejects unsafe note inputs without exposing note content and advertises H3 routes", async () => {
    const fixture = await interviewFixture()
    const notePath = join(fixture.directory, "note.txt")
    await writeFile(notePath, "PRIVATE COMPETING NOTE", "utf8")
    await expect(invoke(["applications", "note", "--repository", fixture.repositoryPath, "--application-id", "application-1"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("exactly one") })
    const competing = await invoke(["applications", "note", "--repository", fixture.repositoryPath, "--application-id", "application-1", "--note-file", notePath, "--note-stdin"], { stdin: "PRIVATE STDIN" })
    expect(competing.stderr.includes("PRIVATE")).toBe(false)
    expect(competing).toMatchObject({ code: 1, stderr: expect.stringContaining("exactly one") })
    const inline = await invoke(["applications", "note", "--repository", fixture.repositoryPath, "--application-id", "application-1", "--note", "PRIVATE INLINE NOTE"])
    expect(inline.stderr.includes("PRIVATE INLINE NOTE")).toBe(false)
    expect(inline).toMatchObject({ code: 1, stderr: expect.stringContaining("Inline application notes are not accepted") })
    const missingFile = await invoke(["applications", "note", "--repository", fixture.repositoryPath, "--application-id", "application-1", "--note-file", join(fixture.directory, "PRIVATE-missing.txt")])
    expect(missingFile.stderr.includes("PRIVATE-missing.txt")).toBe(false)
    expect(missingFile).toMatchObject({ code: 1, stderr: expect.stringContaining("NOTE_FILE_READ_ERROR") })
    const whitespace = await invoke(["applications", "note", "--repository", fixture.repositoryPath, "--application-id", "application-1", "--note-stdin", "--timestamp", "2026-02-01T00:00:00.000Z"], { stdin: "  \n " })
    expect(whitespace.stderr.includes("  \n ")).toBe(false)
    expect(whitespace).toMatchObject({ code: 1, stderr: expect.stringContaining("EMPTY_NOTE") })
    const help = await invoke(["--help"])
    expect(help.stdout).toContain("career-agent applications status")
    expect(help.stdout).toContain("career-agent applications note")
    await expect(invoke(["applications", "remove"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("status, or note") })
  })
})
