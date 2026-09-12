import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, writeFile, mkdir, readdir, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createFileInterviewSessionRepository } from "../src/interview-session-file-repository"
import { startInterviewSession, skipCurrentInterviewQuestion, submitInterviewAnswer, type InterviewSession } from "../src/interview-session"
import type { InterviewPreparationPlan } from "../src/interview-preparation"

const plan: InterviewPreparationPlan = {
  applicationId: "A", language: "sv", interviewType: "behavioral",
  job: { jobId: "job", source: "test", sourceId: null, jobTitle: "Test", company: null },
  questions: ["q1", "q2"].map((id) => ({ id, category: "general", prompt: "Berätta", rationale: "Test", requirementKeys: [], evidenceIds: [], gapKeys: [] })),
  starPrompts: [], warnings: [],
}
function initial(id = "session-1", applicationId = "A"): InterviewSession {
  const result = startInterviewSession({ ...plan, applicationId }, { sessionId: id })
  if (!result.ok) throw new Error("Invalid fixture")
  return result.value
}
function answered(): InterviewSession {
  const result = submitInterviewAnswer(initial(), plan, { evidence: [] }, { questionId: "q1", format: "freeText", text: "PRIVATE_RAW_RESPONSE I enjoy helping colleagues solve problems." })
  if (!result.ok) throw new Error("Invalid answer fixture")
  return result.value
}
let directory: string
let path: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "interview-repository-")); path = join(directory, "sessions.json") })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
const envelope = (sessions: unknown[]) => JSON.stringify({ schemaVersion: 1, sessions })

describe("interview session persistence", () => {
  it("reads missing storage as empty without creating a file", async () => {
    const repository = createFileInterviewSessionRepository(path)
    expect(await repository.listByApplicationId("A")).toEqual({ ok: true, value: [] })
    expect(await repository.getById("missing")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } })
    expect(await readdir(directory)).toEqual([])
  })
  it("saves and round-trips the exact domain model through a new repository", async () => {
    const value = initial()
    expect(await createFileInterviewSessionRepository(path).save(value)).toEqual({ ok: true, value })
    expect(await createFileInterviewSessionRepository(path).getById(value.id)).toEqual({ ok: true, value })
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ schemaVersion: 1, sessions: [value] })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await readdir(directory)).toEqual(["sessions.json"])
  })
  it("isolates applications and sorts by ID without claiming chronological order", async () => {
    const repository = createFileInterviewSessionRepository(path)
    for (const value of [initial("session-2"), initial("session-3", "B"), initial()]) expect((await repository.save(value)).ok).toBe(true)
    expect(await repository.listByApplicationId("A")).toEqual({ ok: true, value: [initial(), initial("session-2")] })
    expect(await repository.listByApplicationId("B")).toEqual({ ok: true, value: [initial("session-3", "B")] })
    expect(await repository.listByApplicationId("C")).toEqual({ ok: true, value: [] })
    expect(await repository.getById("absent")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } })
  })
  it("deletes every session for one application, is idempotent, and leaves other applications untouched", async () => {
    const repository = createFileInterviewSessionRepository(path)
    for (const value of [initial("session-1", "A"), initial("session-2", "A"), initial("session-3", "B")]) expect((await repository.save(value)).ok).toBe(true)
    expect(await repository.deleteByApplicationId("A")).toEqual({ ok: true, value: 2 })
    expect(await repository.listByApplicationId("A")).toEqual({ ok: true, value: [] })
    expect(await repository.listByApplicationId("B")).toEqual({ ok: true, value: [initial("session-3", "B")] })
    expect(await repository.deleteByApplicationId("A")).toEqual({ ok: true, value: 0 })
  })
  it("rejects moving an existing session to a different application", async () => {
    const repository = createFileInterviewSessionRepository(path)
    await repository.save(initial())
    const before = await readFile(path, "utf8")
    expect(await repository.save(initial("session-1", "B"))).toMatchObject({ ok: false, error: { code: "INVALID_RECORD" } })
    expect(await readFile(path, "utf8")).toBe(before)
  })
  it("persists evolved submitted and skipped turns without advancing or mutating them", async () => {
    const repository = createFileInterviewSessionRepository(path)
    const value = answered()
    const before = structuredClone(value)
    await repository.save(initial())
    expect(await repository.save(value)).toEqual({ ok: true, value: before })
    expect(value).toEqual(before)
    const completed = skipCurrentInterviewQuestion(value, plan)
    if (!completed.ok) throw new Error("Expected completion")
    expect(await repository.save(completed.value)).toEqual({ ok: true, value: completed.value })
    expect(await repository.listByApplicationId("A")).toEqual({ ok: true, value: [completed.value] })
    expect(await readFile(path, "utf8")).not.toContain("PRIVATE_RAW_RESPONSE")
    expect(await createFileInterviewSessionRepository(path).getById(value.id)).toEqual({ ok: true, value: completed.value })
  })
  it("round-trips STAR answers and nested domain warnings without retaining STAR text", async () => {
    const result = submitInterviewAnswer(initial(), plan, { evidence: [] }, {
      questionId: "q1", format: "star", star: { situation: "PRIVATE_STAR_CONTEXT", action: "I improved throughput by 35%." },
    })
    if (!result.ok) throw new Error("Expected STAR result")
    expect(result.value.turns[0].status).toBe("submitted")
    const repository = createFileInterviewSessionRepository(path)
    expect(await repository.save(result.value)).toEqual({ ok: true, value: result.value })
    expect(await repository.getById(result.value.id)).toEqual({ ok: true, value: result.value })
    expect(await readFile(path, "utf8")).not.toContain("PRIVATE_STAR_CONTEXT")
  })
  it("rejects sparse question arrays before serializing them to invalid JSON data", async () => {
    const value = initial()
    value.planQuestionIds = new Array(1)
    expect(await createFileInterviewSessionRepository(path).save(value)).toMatchObject({ ok: false, error: { code: "INVALID_RECORD" } })
    expect(await readdir(directory)).toEqual([])
  })
  it("snapshots before asynchronous I/O and returns detached records", async () => {
    const repository = createFileInterviewSessionRepository(path)
    const value = initial()
    const pending = repository.save(value)
    value.applicationId = "changed"
    const saved = await pending
    if (!saved.ok) throw new Error("Expected save")
    saved.value.planQuestionIds.push("changed")
    expect(await repository.getById("session-1")).toEqual({ ok: true, value: initial() })
  })
  it.each(["", "{", "null", "[]", '{"schemaVersion":1,"sessions":{}}', envelope([initial(), initial()])])("rejects corrupt storage: %s", async (contents) => {
    await writeFile(path, contents)
    const repository = createFileInterviewSessionRepository(path)
    for (const result of [await repository.getById("session-1"), await repository.listByApplicationId("A"), await repository.save(initial())]) {
      expect(result).toMatchObject({ ok: false, error: { code: "CORRUPT_STORAGE" } })
      expect(JSON.stringify(result)).not.toContain(directory)
    }
    expect(await readFile(path, "utf8")).toBe(contents)
  })
  it("rejects unsupported schema versions", async () => {
    await writeFile(path, '{"schemaVersion":2,"sessions":[]}')
    expect(await createFileInterviewSessionRepository(path).listByApplicationId("A")).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_SCHEMA_VERSION" } })
  })
  const invalid: [string, (value: any) => void][] = [
    ["empty id", (v) => { v.id = "" }],
    ["empty owner", (v) => { v.applicationId = "" }],
    ["language", (v) => { v.language = "de" }],
    ["type", (v) => { v.interviewType = "invalid" }],
    ["status", (v) => { v.status = "completed" }],
    ["index", (v) => { v.currentQuestionIndex = 9 }],
    ["duplicate questions", (v) => { v.planQuestionIds = ["q1", "q1"] }],
    ["question order", (v) => { v.turns[0].questionId = "q2" }],
    ["answer format", (v) => { v.turns[0].answerFormat = "unknown" }],
    ["preparation owner", (v) => { v.turns[0].preparation.applicationId = "B" }],
    ["preparation language", (v) => { v.turns[0].preparation.language = "en" }],
    ["missing nested checks", (v) => { delete v.turns[0].preparation.structuralChecks }],
    ["invalid nested boolean", (v) => { v.turns[0].preparation.structuralChecks.hasAnswerContent = "true" }],
    ["invalid warning", (v) => { v.turns[0].preparation.warnings = [null] }],
    ["unknown warning code", (v) => { v.turns[0].preparation.warnings = [{ code: "UNKNOWN", message: "" }] }],
    ["invalid evidence", (v) => { v.turns[0].preparation.citedEvidence = [{ evidenceId: "e", status: "unknown" }] }],
    ["invalid prompt", (v) => { v.turns[0].preparation.improvementPrompts = [{ code: "UNKNOWN", message: "" }] }],
    ["raw answer at root", (v) => { v.text = "PRIVATE" }],
    ["raw answer in turn", (v) => { v.turns[0].text = "PRIVATE" }],
    ["raw answer in preparation", (v) => { v.turns[0].preparation.answer = "PRIVATE" }],
    ["raw answer in warning", (v) => { v.turns[0].preparation.warnings = [{ code: "EMPTY_ANSWER", message: "", text: "PRIVATE" }] }],
    ["skip with preparation", (v) => { v.turns[0].status = "skipped" }],
  ]
  it.each(invalid)("rejects malformed session on read and save: %s", async (_name, change) => {
    const value = answered()
    change(value)
    const repository = createFileInterviewSessionRepository(path)
    expect(await repository.save(value)).toMatchObject({ ok: false, error: { code: "INVALID_RECORD" } })
    expect(await readdir(directory)).toEqual([])
    await writeFile(path, envelope([value]))
    expect(await repository.getById(value.id)).toMatchObject({ ok: false, error: { code: "CORRUPT_STORAGE" } })
  })
  it("returns safe read failures", async () => {
    await mkdir(path)
    expect(await createFileInterviewSessionRepository(path).getById("id")).toEqual({ ok: false, error: { code: "READ_FAILURE", message: "Interview session storage could not be read." } })
  })
  it("returns safe write failures and preserves the previous store", async () => {
    const repository = createFileInterviewSessionRepository(path)
    await repository.save(initial())
    const before = await readFile(path, "utf8")
    await mkdir(join(directory, ".sessions.json.tmp"))
    expect(await repository.save(answered())).toEqual({ ok: false, error: { code: "WRITE_FAILURE", message: "Interview session storage could not be written." } })
    expect(await readFile(path, "utf8")).toBe(before)
  })
  it("has no provider or network dependency in the persistence modules", async () => {
    for (const file of ["interview-session-repository.ts", "interview-session-file-repository.ts", "interview-session-storage-validation.ts"]) {
      const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8")
      expect(source).not.toMatch(/fetch\s*\(|axios|openai|interview-ai|providers\/|child_process|generateInterview|submitInterviewAnswer|skipCurrentInterviewQuestion/i)
    }
  })
})
