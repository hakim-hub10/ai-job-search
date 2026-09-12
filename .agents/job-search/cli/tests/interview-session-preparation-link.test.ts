import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createFileInterviewPreparationRepository } from "../src/interview-preparation-file-repository"
import type { InterviewPreparationRecord } from "../src/interview-preparation-repository"
import { analyzeJobs, normalizeCandidateProfile, normalizeJob, createApplication, createInterviewPreparationPlan, buildApplicationDocumentFoundation, prepareInterviewAnswer } from "../src/index"
import type { CandidateDocumentEvidence } from "../src/application-documents"

const stateA: CandidateDocumentEvidence[] = [
  { id: "experience:0", kind: "experience", content: "Resolved support requests.", context: { employer: "Original employer", role: "Support" }, relatedRequirements: [{ category: "skill", value: "Support" }] },
  { id: "experience:1", kind: "project", content: "Organized a community event.", relatedRequirements: [{ category: "skill", value: "Event planning" }] },
  { id: "motivation", kind: "motivation", content: "I enjoy helping colleagues.", relatedRequirements: [{ category: "other", value: "Personal interest" }] },
]
function fixture(id = "prep-1", applicationId = "A", candidateId = "candidate-A", evidence = structuredClone(stateA)): InterviewPreparationRecord {
  const profile = normalizeCandidateProfile({ headline: "Support", targetRoles: [], locationPreferences: [], workMode: "open", remotePreference: false, preferredEmploymentType: ["open"], skills: { technical: ["Support"], soft: [] }, yearsOfExperience: 2 })
  const job = normalizeJob({ source: "test", sourceId: "job", title: "Support technician", company: "Example", skills: ["Support", "Linux"] })
  const app = createApplication({ id: applicationId, rankedJob: analyzeJobs(profile, [job]).rankedJobs[0], createdAt: "2026-09-08T10:00:00.000Z" })
  if (!app.ok) throw new Error("Invalid application fixture")
  const plan = createInterviewPreparationPlan(app.value, { evidence }, { language: "sv", interviewType: "hiringManager" })
  const foundation = buildApplicationDocumentFoundation(app.value, { evidence })
  if (!plan.ok || !foundation.ok) throw new Error("Invalid plan fixture")
  return { id, applicationId, candidateId, plan: plan.value, evidenceSnapshot: evidence, requirementContext: foundation.value.requirements }
}

import { startInterviewSession } from "../src/interview-session"
import { createFileInterviewSessionRepository } from "../src/interview-session-file-repository"
import { createFileInterviewSessionPreparationLinkRepository } from "../src/interview-session-preparation-link-file-repository"
import { resolveInterviewSessionPreparation } from "../src/interview-session-preparation"
import type { InterviewSessionPreparationDependencies } from "../src/interview-session-preparation-link-repository"
let directory: string
let path: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "interview-links-")); path = join(directory, "links.json") })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
const link = { sessionId: "session", applicationId: "A", preparationRecordId: "prep-1" }
function context() {
  const preparation = fixture()
  const started = startInterviewSession(preparation.plan, { sessionId: "session" })
  if (!started.ok) throw new Error("Invalid session fixture")
  const sessions = new Map([["session", started.value]])
  const preparations = new Map([[preparation.id, preparation]])
  const deps: InterviewSessionPreparationDependencies = {
    sessionRepository: { async getById(id) { const value = sessions.get(id); return value ? { ok: true, value } : { ok: false, error: { code: "NOT_FOUND", message: "PRIVATE" } } } },
    preparationRepository: { async getById(id) { const value = preparations.get(id); return value ? { ok: true, value } : { ok: false, error: { code: "NOT_FOUND", message: "PRIVATE" } } } },
  }
  const repository = createFileInterviewSessionPreparationLinkRepository(path, deps)
  const resolve = () => resolveInterviewSessionPreparation({ applicationId: "A", sessionId: "session" }, { ...deps, linkRepository: repository })
  return { preparation, sessions, preparations, deps, repository, resolve }
}

describe("explicit session preparation linkage", () => {
  it("keeps legacy schema 1 readable and unlinked without writing or inferring any link", async () => {
    const c = context()
    const sessionPath = join(directory, "sessions.json")
    const session = c.sessions.get("session")!
    const contents = JSON.stringify({ schemaVersion: 1, sessions: [session] })
    await writeFile(sessionPath, contents)
    const sessionRepository = createFileInterviewSessionRepository(sessionPath)
    expect(await sessionRepository.getById("session")).toEqual({ ok: true, value: session })
    c.deps.preparationRepository.getById = async () => { throw new Error("No preparation lookup is allowed without a link") }
    expect(await resolveInterviewSessionPreparation({ applicationId: "A", sessionId: "session" }, { ...c.deps, sessionRepository, linkRepository: c.repository })).toMatchObject({ ok: false, error: { code: "UNLINKED_SESSION" } })
    expect(await readFile(sessionPath, "utf8")).toBe(contents)
    expect(await readdir(directory)).toEqual(["sessions.json"])
  })
  it("persists and resolves an explicit link to the exact preparation", async () => {
    const c = context()
    expect(await c.repository.create(link)).toEqual({ ok: true, value: link })
    const reopened = createFileInterviewSessionPreparationLinkRepository(path, c.deps)
    expect(await reopened.getBySessionId("session")).toEqual({ ok: true, value: link })
    expect(await c.resolve()).toEqual({ ok: true, value: c.preparation })
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ schemaVersion: 1, links: [link] })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(Object.keys(c.repository).sort()).toEqual(["create", "deleteBySessionId", "getBySessionId"])
  })
  it("deletes a link by session id and is idempotent when no link exists", async () => {
    const c = context()
    expect(await c.repository.create(link)).toEqual({ ok: true, value: link })
    expect(await c.repository.deleteBySessionId("session")).toEqual({ ok: true, value: undefined })
    expect(await c.repository.getBySessionId("session")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } })
    expect(await c.repository.deleteBySessionId("session")).toEqual({ ok: true, value: undefined })
  })
  it("chooses only the explicit ID even when another preparation has identical question IDs", async () => {
    const c = context()
    const other = structuredClone(c.preparation)
    other.id = "aaa-other"
    other.plan.questions[0].prompt = "Different wording with identical question IDs"
    c.preparations.set(other.id, other)
    expect(await c.resolve()).toMatchObject({ ok: false, error: { code: "UNLINKED_SESSION" } })
    await c.repository.create({ ...link, preparationRecordId: other.id })
    expect(await c.resolve()).toEqual({ ok: true, value: other })
  })
  it.each(["same", "different"])("rejects duplicate/reassignment to %s preparation", async (mode) => {
    const c = context()
    await c.repository.create(link)
    const before = await readFile(path, "utf8")
    expect(await c.repository.create({ ...link, preparationRecordId: mode === "same" ? link.preparationRecordId : "new" })).toMatchObject({ ok: false, error: { code: "DUPLICATE_LINK" } })
    expect(await readFile(path, "utf8")).toBe(before)
  })
  it.each(["application", "language", "interviewType", "order"])("rejects incompatible %s on create and resolution", async (kind) => {
    const c = context()
    const session = c.sessions.get("session")!
    if (kind === "application") session.applicationId = "B"
    if (kind === "language") session.language = "en"
    if (kind === "interviewType") session.interviewType = "situational"
    if (kind === "order") session.planQuestionIds.reverse()
    expect(await c.repository.create(link)).toMatchObject({ ok: false, error: { code: "INVALID_LINK" } })
    expect(await readdir(directory)).toEqual([])
    await writeFile(path, JSON.stringify({ schemaVersion: 1, links: [link] }))
    expect(await c.resolve()).toMatchObject({ ok: false, error: { code: "INVALID_LINK" } })
  })
  it("rejects cross-application preparation and cannot override authoritative ownership", async () => {
    const c = context()
    const foreign = fixture("prep-1", "B", "candidate-B")
    c.preparations.set("prep-1", foreign)
    expect(await c.repository.create(link)).toMatchObject({ ok: false, error: { code: "INVALID_LINK" } })
  })
  it.each(["session", "preparation"])("rejects missing %s", async (kind) => {
    const c = context()
    if (kind === "session") c.sessions.clear()
    else c.preparations.clear()
    expect(await c.repository.create(link)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } })
    await writeFile(path, JSON.stringify({ schemaVersion: 1, links: [link] }))
    expect(await c.resolve()).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } })
  })
  it("rejects incorrect record IDs returned by dependency repositories", async () => {
    const c = context()
    c.preparation.id = "wrong"
    expect(await c.repository.create(link)).toMatchObject({ ok: false, error: { code: "INVALID_LINK" } })
    c.preparation.id = link.preparationRecordId
    c.sessions.get("session")!.id = "wrong"
    expect(await c.repository.create(link)).toMatchObject({ ok: false, error: { code: "INVALID_LINK" } })
  })
  it("rejects malformed preparation and session data before accepting a link", async () => {
    const c = context()
    c.preparation.plan.questions[0].evidenceIds = ["absent"]
    expect(await c.repository.create(link)).toMatchObject({ ok: false, error: { code: "INVALID_LINK" } })
    c.preparations.set("prep-1", fixture())
    c.sessions.get("session")!.currentQuestionIndex = 99
    expect(await c.repository.create(link)).toMatchObject({ ok: false, error: { code: "INVALID_LINK" } })
  })
  it("revalidates a session changed incompatibly after linkage", async () => {
    const c = context()
    await c.repository.create(link)
    c.sessions.get("session")!.language = "en"
    expect(await c.resolve()).toMatchObject({ ok: false, error: { code: "INVALID_LINK" } })
  })
  it("resolves unchanged immutable preparation after live evidence edits", async () => {
    const c = context()
    const live = structuredClone(c.preparation.evidenceSnapshot)
    const preparationRepository = createFileInterviewPreparationRepository(join(directory, "preparations.json"))
    await preparationRepository.create(c.preparation)
    const deps = { ...c.deps, preparationRepository }
    const repository = createFileInterviewSessionPreparationLinkRepository(path, deps)
    await repository.create(link)
    live.reverse()
    live[0].content = "New profile contents"
    const before = JSON.stringify(c.preparation)
    const resolved = await resolveInterviewSessionPreparation({ applicationId: "A", sessionId: "session" }, { ...deps, linkRepository: repository })
    expect(resolved).toEqual({ ok: true, value: c.preparation })
    expect(JSON.stringify(c.preparation)).toBe(before)
    if (resolved.ok) resolved.value.evidenceSnapshot[0].content = "Changed returned copy"
    expect(await preparationRepository.getById("prep-1")).toEqual({ ok: true, value: c.preparation })
  })
  it("snapshots link input and returns detached link values", async () => {
    const c = context()
    const input = { ...link }
    const pending = c.repository.create(input)
    input.applicationId = "changed"
    const saved = await pending
    if (!saved.ok) throw new Error("Expected link")
    saved.value.preparationRecordId = "changed"
    expect(await c.repository.getBySessionId("session")).toEqual({ ok: true, value: link })
  })
  it.each([null, {}, { ...link, sessionId: "" }, { ...link, applicationId: 7 }, { ...link, preparationRecordId: " " }, { ...link, answer: "PRIVATE" }])("rejects malformed link %j", async (value) => {
    const c = context()
    expect(await c.repository.create(value as never)).toMatchObject({ ok: false, error: { code: "INVALID_LINK" } })
    await writeFile(path, JSON.stringify({ schemaVersion: 1, links: [value] }))
    expect(await c.repository.getBySessionId("session")).toMatchObject({ ok: false, error: { code: "CORRUPT_STORAGE" } })
  })
  it.each(["", "{", "null", "[]", '{"schemaVersion":1,"links":{}}', JSON.stringify({ schemaVersion: 1, links: [link, link] })])("rejects corrupt storage %s", async (contents) => {
    const c = context()
    await writeFile(path, contents)
    expect(await c.resolve()).toMatchObject({ ok: false, error: { code: "CORRUPT_STORAGE" } })
    expect(await c.repository.create(link)).toMatchObject({ ok: false, error: { code: "CORRUPT_STORAGE" } })
    expect(await readFile(path, "utf8")).toBe(contents)
  })
  it("rejects unsupported schema without rewriting storage", async () => {
    const c = context()
    await writeFile(path, '{"schemaVersion":2,"links":[]}')
    expect(await c.resolve()).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_SCHEMA_VERSION" } })
  })
  it("returns safe read/write failures", async () => {
    const c = context()
    await mkdir(path)
    expect(await c.repository.getBySessionId("session")).toMatchObject({ ok: false, error: { code: "READ_FAILURE" } })
    await rm(path, { recursive: true })
    await mkdir(join(directory, ".links.json.tmp"))
    const result = await c.repository.create(link)
    expect(result).toMatchObject({ ok: false, error: { code: "WRITE_FAILURE" } })
    expect(JSON.stringify(result)).not.toContain(directory)
  })
  it("sanitizes thrown/returned dependency errors", async () => {
    const c = context()
    c.deps.preparationRepository.getById = async () => { throw new Error("PRIVATE /path") }
    expect(await c.repository.create(link)).toEqual({ ok: false, error: { code: "READ_FAILURE", message: "Interview linkage context could not be read." } })
    c.deps.sessionRepository.getById = async () => ({ ok: false, error: { code: "CORRUPT_STORAGE", message: "PRIVATE" } })
    expect(await c.resolve()).toMatchObject({ ok: false, error: { code: "INVALID_LINK" } })
  })
  it("rejects a forged cross-scope link from a dependency", async () => {
    const c = context()
    const result = await resolveInterviewSessionPreparation({ applicationId: "A", sessionId: "session" }, { ...c.deps, linkRepository: { async getBySessionId() { return { ok: true, value: { ...link, applicationId: "B" } } } } })
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_LINK" } })
  })
  it("does not store raw answers or call providers, generators, list lookups or profile repositories", async () => {
    const c = context()
    const before = JSON.stringify({ session: c.sessions.get("session"), preparation: c.preparation })
    await c.repository.create(link)
    await c.resolve()
    expect(JSON.stringify({ session: c.sessions.get("session"), preparation: c.preparation })).toBe(before)
    expect(Object.keys(JSON.parse(await readFile(path, "utf8")).links[0]).sort()).toEqual(["applicationId", "preparationRecordId", "sessionId"])
    for (const name of ["interview-session-preparation.ts", "interview-session-preparation-link-repository.ts", "interview-session-preparation-link-file-repository.ts"]) {
      const source = await readFile(new URL(`../src/${name}`, import.meta.url), "utf8")
      expect(source).not.toMatch(/fetch\s*\(|axios|openai|providers\/|candidate-profile|\.list|createInterviewPreparationPlan|startInterviewSession|submitInterviewAnswer|console\./i)
    }
  })
})
