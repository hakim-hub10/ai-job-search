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
let directory: string
let path: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "preparation-repository-")); path = join(directory, "preparations.json") })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
const envelope = (preparations: unknown[]) => JSON.stringify({ schemaVersion: 1, preparations })

describe("immutable interview preparation persistence", () => {
  it("treats missing storage as empty, not found, and never creates files during reads", async () => {
    const repo = createFileInterviewPreparationRepository(path)
    expect(await repo.listByApplicationId("A")).toEqual({ ok: true, value: [] })
    expect(await repo.getById("missing")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } })
    expect(await readdir(directory)).toEqual([])
  })
  it("round-trips exact plan, evidence metadata, requirement context and ownership", async () => {
    const value = fixture()
    expect(await createFileInterviewPreparationRepository(path).create(value)).toEqual({ ok: true, value })
    expect(await createFileInterviewPreparationRepository(path).getById(value.id)).toEqual({ ok: true, value })
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ schemaVersion: 1, preparations: [value] })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await readdir(directory)).toEqual(["preparations.json"])
  })
  it("preserves multiple records with deterministic application isolation and explicit candidate ownership", async () => {
    const repo = createFileInterviewPreparationRepository(path)
    const first = fixture("a"), second = fixture("z"), other = fixture("b", "B", "candidate-B")
    for (const value of [second, other, first]) expect((await repo.create(value)).ok).toBe(true)
    expect(await repo.listByApplicationId("A")).toEqual({ ok: true, value: [first, second] })
    expect(await repo.listByApplicationId("B")).toEqual({ ok: true, value: [other] })
    expect(await repo.listByApplicationId("C")).toEqual({ ok: true, value: [] })
    expect(await repo.getById("missing")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } })
  })
  it("rejects duplicate IDs without replacing content or transferring ownership", async () => {
    const repo = createFileInterviewPreparationRepository(path)
    await repo.create(fixture())
    const before = await readFile(path, "utf8")
    expect(await repo.create(fixture("prep-1", "B", "candidate-B"))).toMatchObject({ ok: false, error: { code: "DUPLICATE_ID" } })
    expect(await readFile(path, "utf8")).toBe(before)
    expect(Object.keys(repo).sort()).toEqual(["create", "getById", "listByApplicationId"])
  })
  it("snapshots input before I/O and detaches returned objects", async () => {
    const repo = createFileInterviewPreparationRepository(path)
    const value = fixture(), before = structuredClone(value)
    const pending = repo.create(value)
    value.evidenceSnapshot[0].content = "CHANGED"
    const saved = await pending
    if (!saved.ok) throw new Error("Expected save")
    saved.value.plan.questions[0].prompt = "CHANGED"
    const listed = await repo.listByApplicationId("A")
    if (!listed.ok) throw new Error("Expected list")
    listed.value[0].candidateId = "CHANGED"
    expect(await repo.getById(before.id)).toEqual({ ok: true, value: before })
  })
  it("resolves historical state A after live evidence is edited and reordered, without a current profile lookup", async () => {
    const liveEvidence = structuredClone(stateA)
    const value = fixture("history", "A", "candidate-A", liveEvidence)
    const original = structuredClone(value)
    const repo = createFileInterviewPreparationRepository(path)
    await repo.create(value)
    liveEvidence.reverse()
    liveEvidence[0].content = "Changed state B"
    liveEvidence.forEach((item, index) => { item.id = `experience:${index}` })
    const historical = await createFileInterviewPreparationRepository(path).getById("history")
    if (!historical.ok) throw new Error("Expected history")
    expect(historical.value).toEqual(original)
    const question = historical.value.plan.questions.find((item) => item.evidenceIds.includes("experience:0"))!
    const evidence = historical.value.evidenceSnapshot.find((item) => item.id === question.evidenceIds[0])!
    expect(evidence.content).toBe("Resolved support requests.")
    expect(evidence.context?.employer).toBe("Original employer")
    const answer = prepareInterviewAnswer(historical.value.plan, { evidence: historical.value.evidenceSnapshot }, {
      questionId: question.id, format: "freeText", text: "PRIVATE_RAW_RESPONSE", citedEvidenceIds: ["experience:0"],
    })
    expect(answer.ok).toBe(true)
    expect(await readFile(path, "utf8")).not.toContain("PRIVATE_RAW_RESPONSE")
  })
  it("keeps candidate-only requirement relationships out of job requirement context", async () => {
    const value = fixture()
    const question = value.plan.questions.find((item) => item.evidenceIds.includes("experience:1"))!
    expect(question.requirementKeys).toContain("skill:event planning")
    expect(value.requirementContext.some((item) => item.requirement.identity.key === "skill:event planning")).toBe(false)
    expect((await createFileInterviewPreparationRepository(path).create(value)).ok).toBe(true)
  })
  it.each(["", "{", "null", "[]", '{"schemaVersion":1,"preparations":{}}', '{"schemaVersion":1,"preparations":[],"extra":true}'])("rejects malformed storage %s", async (contents) => {
    await writeFile(path, contents)
    const repo = createFileInterviewPreparationRepository(path)
    for (const result of [await repo.getById("x"), await repo.listByApplicationId("A"), await repo.create(fixture())]) {
      expect(result).toMatchObject({ ok: false, error: { code: "CORRUPT_STORAGE" } })
      expect(JSON.stringify(result)).not.toContain(directory)
    }
    expect(await readFile(path, "utf8")).toBe(contents)
  })
  it("rejects unsupported schemas and duplicate stored IDs", async () => {
    await writeFile(path, '{"schemaVersion":2,"preparations":[]}')
    expect(await createFileInterviewPreparationRepository(path).listByApplicationId("A")).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_SCHEMA_VERSION" } })
    await writeFile(path, envelope([fixture(), fixture()]))
    expect(await createFileInterviewPreparationRepository(path).getById("prep-1")).toMatchObject({ ok: false, error: { code: "CORRUPT_STORAGE" } })
  })
  // Deliberately corrupt typed fixtures to simulate untrusted JSON boundaries.
  const invalid: [string, (v: any) => void][] = [
    ["id", v => { v.id = "" }], ["candidate", v => { v.candidateId = "" }],
    ["ownership", v => { v.plan.applicationId = "B" }],
    ["language", v => { v.plan.language = "de" }], ["type", v => { v.plan.interviewType = "technical" }],
    ["job", v => { v.plan.job.company = 5 }],
    ["plan", v => { v.plan = null }], ["question", v => { v.plan.questions[0].rationale = 5 }],
    ["duplicate question", v => { v.plan.questions.push(v.plan.questions[0]) }],
    ["empty questions", v => { v.plan.questions = [] }],
    ["evidence ref", v => { v.plan.questions[0].evidenceIds = ["unknown"] }],
    ["STAR question", v => { v.plan.starPrompts[0].questionId = "unknown" }],
    ["STAR evidence", v => { v.plan.starPrompts[0].evidenceIds = ["unknown"] }],
    ["STAR metadata", v => { v.plan.starPrompts[0].warnings = [5] }],
    ["job requirement ref", v => { v.plan.questions[0].requirementKeys = ["skill:unknown"] }],
    ["candidate requirement ref", v => { v.plan.questions.find((q: any) => q.category === "behavioral").requirementKeys = ["skill:unknown"] }],
    ["gap ref", v => { v.plan.questions[0].gapKeys = ["skill:unknown"] }],
    ["unknown status is not a gap", v => { v.requirementContext.find((r: any) => r.status === "missing").status = "unknown" }],
    ["canonical requirement", v => { v.requirementContext[0].requirement.identity.normalized = "wrong" }],
    ["requirement evidence", v => { v.requirementContext[0].evidenceIds = ["unknown"] }],
    ["evidence body", v => { v.evidenceSnapshot[0].content = 9 }],
    ["evidence context", v => { v.evidenceSnapshot[0].context.employer = 9 }],
    ["evidence relationship", v => { v.evidenceSnapshot[0].relatedRequirements[0].category = "unknown" }],
    ["duplicate evidence", v => { v.evidenceSnapshot.push(v.evidenceSnapshot[0]) }],
    ["warning", v => { v.plan.warnings = [{code:"UNKNOWN",message:""}] }],
    ["warning evidence", v => { v.plan.warnings = [{code:"NO_SUPPORTED_STAR_RESULT",message:"",evidenceId:"unknown"}] }],
    ["warning requirement", v => { v.plan.warnings = [{code:"UNKNOWN_REQUIREMENT_CONTEXT",message:"",requirementKey:"skill:unknown"}] }],
    ["raw root answer", v => { v.answer = "PRIVATE" }],
    ["raw nested answer", v => { v.plan.questions[0].answer = "PRIVATE" }],
    ["extra evidence field", v => { v.evidenceSnapshot[0].rawAnswer = "PRIVATE" }],
    ["extra requirement field", v => { v.requirementContext[0].private = "PRIVATE" }],
    ["sparse evidence", v => { v.evidenceSnapshot = new Array(1) }],
  ]
  it.each(invalid)("rejects invalid record on create and read: %s", async (_name, corrupt) => {
    const value = fixture()
    corrupt(value)
    const repo = createFileInterviewPreparationRepository(path)
    expect(await repo.create(value)).toMatchObject({ ok: false, error: { code: "INVALID_RECORD" } })
    expect(await readdir(directory)).toEqual([])
    await writeFile(path, envelope([value]))
    expect(await repo.getById("prep-1")).toMatchObject({ ok: false, error: { code: "CORRUPT_STORAGE" } })
  })
  it("returns safe read failures", async () => {
    await mkdir(path)
    expect(await createFileInterviewPreparationRepository(path).getById("id")).toEqual({ ok: false, error: { code: "READ_FAILURE", message: "Interview preparation storage could not be read." } })
  })
  it("preserves existing storage on write failure without leaking paths", async () => {
    const repo = createFileInterviewPreparationRepository(path)
    await repo.create(fixture())
    const before = await readFile(path, "utf8")
    await mkdir(join(directory, ".preparations.json.tmp"))
    expect(await repo.create(fixture("next"))).toEqual({ ok: false, error: { code: "WRITE_FAILURE", message: "Interview preparation storage could not be written." } })
    expect(await readFile(path, "utf8")).toBe(before)
  })
  it("imports no provider, live-profile repository, session operation or generation flow", async () => {
    for (const name of ["interview-preparation-repository.ts", "interview-preparation-file-repository.ts", "interview-preparation-storage-validation.ts"]) {
      const source = await readFile(new URL(`../src/${name}`, import.meta.url), "utf8")
      expect(source).not.toMatch(/fetch\s*\(|axios|openai|providers\/|interview-ai|candidate-profile-file|startInterviewSession|submitInterviewAnswer|createInterviewPreparationPlan|createInterviewSessionFeedback|console\./i)
    }
  })
})
