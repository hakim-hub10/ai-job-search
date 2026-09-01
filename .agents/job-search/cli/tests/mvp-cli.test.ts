import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
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
})
