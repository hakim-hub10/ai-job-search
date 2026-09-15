import { describe, expect, it } from "bun:test"
import {
  analyzeJobs,
  createApplicationWorkflow,
  normalizeCandidateProfile,
  normalizeJob,
  type ApplicationRecord,
  type ApplicationRepository,
  type ApplicationRepositoryError,
  type ApplicationRepositoryResult,
  type NormalizedJob,
} from "../src/index"

const createdAt = "2026-10-01T10:00:00.000Z"
const appliedAt = "2026-10-02T10:00:00.000Z"
const notedAt = "2026-10-03T10:00:00.000Z"

function candidate() {
  return normalizeCandidateProfile({
    headline: "Operations coordinator",
    targetRoles: ["Operations Coordinator", "Nurse", "Logistics Coordinator", "Retail Manager"],
    locationPreferences: ["Aarhus"],
    workMode: "onsite",
    remotePreference: false,
    preferredEmploymentType: ["full-time"],
    skills: { technical: ["Scheduling", "Inventory"], soft: ["Communication"] },
    yearsOfExperience: 3,
  })
}

function job(overrides: Partial<NormalizedJob> & Pick<NormalizedJob, "id" | "title">): NormalizedJob {
  return normalizeJob({
    source: "jobindex",
    sourceId: `${overrides.id}-source`,
    company: "Example employer",
    location: "Aarhus",
    url: `https://example.test/${overrides.id}`,
    applyUrl: `https://example.test/${overrides.id}/apply`,
    remote: "onsite",
    employmentType: "full-time",
    seniority: "mid",
    description: "Communication is important.",
    skills: ["Scheduling", "Inventory"],
    ...overrides,
  })
}

function ranked(overrides: Partial<NormalizedJob> & Pick<NormalizedJob, "id" | "title">) {
  return analyzeJobs(candidate(), [job(overrides)]).rankedJobs[0]
}

function repository(initial: ApplicationRecord[] = []) {
  const records = new Map(initial.map((record) => [record.id, structuredClone(record)]))
  let listError: ApplicationRepositoryError | undefined
  let saveError: ApplicationRepositoryError | undefined
  const implementation: ApplicationRepository = {
    async create(record) {
      if (records.has(record.id)) return { ok: false, error: { code: "DUPLICATE_ID", message: "duplicate ID" } }
      records.set(record.id, structuredClone(record))
      return { ok: true, value: structuredClone(record) }
    },
    async save(record) {
      if (saveError) return { ok: false, error: saveError }
      if (!records.has(record.id)) return { ok: false, error: { code: "NOT_FOUND", message: "missing" } }
      records.set(record.id, structuredClone(record))
      return { ok: true, value: structuredClone(record) }
    },
    async getById(id) {
      const record = records.get(id)
      return record
        ? { ok: true, value: structuredClone(record) }
        : { ok: false, error: { code: "NOT_FOUND", message: "missing" } }
    },
    async list() {
      if (listError) return { ok: false, error: listError }
      return { ok: true, value: [...records.values()].map((record) => structuredClone(record)) }
    },
    async remove(id) {
      if (!records.has(id)) return { ok: false, error: { code: "NOT_FOUND", message: "missing" } }
      records.delete(id)
      return { ok: true, value: undefined }
    },
  }
  return {
    repository: implementation,
    records,
    failList(error: ApplicationRepositoryError) { listError = error },
    failSave(error: ApplicationRepositoryError) { saveError = error },
  }
}

function startInput(id = "application-1", rankedJob = ranked({ id: "operations", title: "Operations Coordinator" })) {
  return { id, rankedJob, createdAt }
}

describe("application workflow", () => {
  it("starts and persists an application while preserving ranked-job provenance and analysis", async () => {
    const store = repository()
    const workflow = createApplicationWorkflow(store.repository)
    const input = startInput()
    const before = JSON.stringify(input.rankedJob)
    const result = await workflow.startApplication(input)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected application")
    expect(result.value).toMatchObject({
      id: "application-1",
      createdAt,
      jobSnapshot: { id: "operations", source: "jobindex", sourceId: "operations-source", url: "https://example.test/operations", applyUrl: "https://example.test/operations/apply" },
      analysisSnapshot: { rank: input.rankedJob.rank, matchingResult: input.rankedJob.matchingResult, scoringResult: input.rankedJob.scoringBreakdown, skillGapResult: input.rankedJob.skillGapResult, explanation: input.rankedJob.explanation },
    })
    expect(store.records.get("application-1")).toEqual(result.value)
    expect(JSON.stringify(input.rankedJob)).toBe(before)
    expect("candidateProfile" in result.value).toBe(false)
  })

  it("surfaces duplicate advisory without persistence and permits explicit intentional repeats", async () => {
    const store = repository()
    const workflow = createApplicationWorkflow(store.repository)
    const first = await workflow.startApplication(startInput("first"))
    expect(first.ok).toBe(true)

    const advisory = await workflow.startApplication(startInput("second"))
    expect(advisory).toMatchObject({ ok: false, error: { kind: "duplicate_advisory", duplicates: [{ applicationId: "first" }] } })
    expect(store.records.size).toBe(1)

    const repeated = await workflow.startApplication({ ...startInput("second"), allowDuplicate: true })
    expect(repeated.ok).toBe(true)
    expect(store.records.size).toBe(2)

    const duplicateId = await workflow.startApplication({
      ...startInput("first", ranked({ id: "different", title: "Nurse", source: "healthcare" })),
      allowDuplicate: true,
    })
    expect(duplicateId).toMatchObject({ ok: false, error: { kind: "repository", error: { code: "DUPLICATE_ID" } } })
  })

  it("propagates creation and repository-list validation failures without replacing their errors", async () => {
    const store = repository()
    const workflow = createApplicationWorkflow(store.repository)
    expect(await workflow.startApplication({ ...startInput(), id: " " })).toMatchObject({ ok: false, error: { kind: "domain", error: { code: "INVALID_APPLICATION_ID" } } })

    store.failList({ code: "CORRUPT_STORAGE", message: "corrupt fixture" })
    expect(await workflow.startApplication(startInput())).toMatchObject({ ok: false, error: { kind: "repository", error: { code: "CORRUPT_STORAGE" } } })
  })

  it("updates persisted status immutably and propagates domain, missing-record, and save errors", async () => {
    const store = repository()
    const workflow = createApplicationWorkflow(store.repository)
    const started = await workflow.startApplication(startInput())
    if (!started.ok) throw new Error("expected application")
    const original = structuredClone(started.value)

    const updated = await workflow.updateApplicationStatusAndSave({ applicationId: "application-1", status: "applied", timestamp: appliedAt, note: "Submitted" })
    expect(updated.ok).toBe(true)
    if (!updated.ok) throw new Error("expected update")
    expect(original.status).toBe("saved")
    expect(updated.value.statusHistory).toEqual([{ status: "saved", timestamp: createdAt }, { status: "applied", timestamp: appliedAt, note: "Submitted" }])
    expect(store.records.get("application-1")).toEqual(updated.value)
    expect(await workflow.updateApplicationStatusAndSave({ applicationId: "application-1", status: "invalid" as never, timestamp: notedAt })).toMatchObject({ ok: false, error: { kind: "domain", error: { code: "INVALID_APPLICATION_STATUS" } } })
    expect(await workflow.updateApplicationStatusAndSave({ applicationId: "application-1", status: "interview", timestamp: "bad" })).toMatchObject({ ok: false, error: { kind: "domain", error: { code: "INVALID_TIMESTAMP" } } })
    expect(await workflow.updateApplicationStatusAndSave({ applicationId: "application-1", status: "interview", timestamp: createdAt })).toMatchObject({ ok: false, error: { kind: "domain", error: { code: "TIMESTAMP_OUT_OF_ORDER" } } })
    expect(await workflow.updateApplicationStatusAndSave({ applicationId: "missing", status: "applied", timestamp: appliedAt })).toMatchObject({ ok: false, error: { kind: "repository", error: { code: "NOT_FOUND" } } })

    store.failSave({ code: "WRITE_FAILURE", message: "write fixture" })
    expect(await workflow.updateApplicationStatusAndSave({ applicationId: "application-1", status: "interview", timestamp: notedAt })).toMatchObject({ ok: false, error: { kind: "repository", error: { code: "WRITE_FAILURE" } } })
  })

  it("adds notes through persistence and retains domain-neutral selected-application context", async () => {
    const store = repository()
    const workflow = createApplicationWorkflow(store.repository)
    const healthcare = await workflow.startApplication(startInput("healthcare", ranked({ id: "nurse", title: "Nurse", source: "healthcare", skills: ["Patient care"] })))
    const logistics = await workflow.startApplication(startInput("logistics", ranked({ id: "logistics", title: "Logistics Coordinator", source: "logistics", skills: ["Route planning"] })))
    expect(healthcare.ok && logistics.ok).toBe(true)

    const noted = await workflow.addApplicationNoteAndSave({ applicationId: "healthcare", text: "Await response", createdAt: notedAt })
    expect(noted).toMatchObject({ ok: true, value: { notes: [{ text: "Await response", createdAt: notedAt }], updatedAt: notedAt } })
    expect(await workflow.addApplicationNoteAndSave({ applicationId: "healthcare", text: " ", createdAt: notedAt })).toMatchObject({ ok: false, error: { kind: "domain", error: { code: "EMPTY_NOTE" } } })
    const selected = await store.repository.getById("healthcare")
    expect(selected.ok && selected.value).toMatchObject({ id: "healthcare", jobSnapshot: { source: "healthcare", title: "Nurse" }, notes: [{ text: "Await response", createdAt: notedAt }] })
  })

  it("is deterministic for identical controlled inputs on independent repositories", async () => {
    const firstStore = repository()
    const secondStore = repository()
    const input = startInput("deterministic", ranked({ id: "retail", title: "Retail Manager", source: "retail" }))
    const first = await createApplicationWorkflow(firstStore.repository).startApplication(input)
    const second = await createApplicationWorkflow(secondStore.repository).startApplication(input)
    expect(first).toEqual(second)
  })

  describe("re-analysis loads, replaces only the analysis snapshot, and saves - through the same load/save persistence path as status updates", () => {
    const reanalyzedAt = "2026-10-05T10:00:00.000Z"

    it("persists the freshly computed analysis while preserving jobSnapshot, status, and notes", async () => {
      const store = repository()
      const workflow = createApplicationWorkflow(store.repository)
      const started = await workflow.startApplication(startInput())
      if (!started.ok) throw new Error("expected application")
      await workflow.addApplicationNoteAndSave({ applicationId: "application-1", text: "Keep me", createdAt: appliedAt })

      const improvedCandidate = { ...candidate(), skills: { technical: [...candidate().skills.technical, "Route planning"], soft: candidate().skills.soft } }
      const freshRankedJob = analyzeJobs(improvedCandidate, [job({ id: "operations", title: "Operations Coordinator" })]).rankedJobs[0]
      const result = await workflow.reanalyzeApplicationAndSave({ applicationId: "application-1", rankedJob: freshRankedJob, timestamp: reanalyzedAt, candidateProfileUpdatedAt: "2026-10-04T10:00:00.000Z" })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error("expected re-analysis")
      expect(result.value.jobSnapshot).toEqual(started.value.jobSnapshot)
      expect(result.value.notes).toEqual([{ text: "Keep me", createdAt: appliedAt }])
      expect(result.value.status).toBe("saved")
      expect(result.value.analysisSnapshot).toMatchObject({ analyzedAt: reanalyzedAt, candidateProfileUpdatedAt: "2026-10-04T10:00:00.000Z" })
      expect(result.value.analysisSnapshot).not.toEqual(started.value.analysisSnapshot)
      expect(store.records.get("application-1")).toEqual(result.value)
    })

    it("propagates domain and missing-record errors without persisting anything", async () => {
      const store = repository()
      const workflow = createApplicationWorkflow(store.repository)
      const started = await workflow.startApplication(startInput())
      if (!started.ok) throw new Error("expected application")
      const before = structuredClone(store.records.get("application-1"))

      const freshRankedJob = ranked({ id: "operations", title: "Operations Coordinator" })
      expect(await workflow.reanalyzeApplicationAndSave({ applicationId: "application-1", rankedJob: freshRankedJob, timestamp: "bad" })).toMatchObject({ ok: false, error: { kind: "domain", error: { code: "INVALID_TIMESTAMP" } } })
      expect(await workflow.reanalyzeApplicationAndSave({ applicationId: "application-1", rankedJob: freshRankedJob, timestamp: "2026-09-30T10:00:00.000Z" })).toMatchObject({ ok: false, error: { kind: "domain", error: { code: "TIMESTAMP_OUT_OF_ORDER" } } })
      expect(await workflow.reanalyzeApplicationAndSave({ applicationId: "missing", rankedJob: freshRankedJob, timestamp: reanalyzedAt })).toMatchObject({ ok: false, error: { kind: "repository", error: { code: "NOT_FOUND" } } })
      expect(store.records.get("application-1")).toEqual(before)
    })
  })
})
