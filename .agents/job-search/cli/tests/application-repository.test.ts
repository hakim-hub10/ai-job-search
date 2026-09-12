import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import {
  addApplicationNote,
  analyzeJobs,
  createApplication,
  createFileApplicationRepository,
  normalizeCandidateProfile,
  normalizeJob,
  updateApplicationStatus,
  type ApplicationRecord,
  type NormalizedJob,
} from "../src/index"

const directories: string[] = []
const firstTime = "2026-09-01T10:00:00.000Z"
const secondTime = "2026-09-02T10:00:00.000Z"

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function repositoryPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ai-job-search-applications-"))
  directories.push(directory)
  return join(directory, "nested", "applications.json")
}

function candidate() {
  return normalizeCandidateProfile({
    headline: "Operations coordinator",
    targetRoles: ["Operations Coordinator", "Nurse", "Logistics Coordinator"],
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

function record(id: string, overrides: Partial<NormalizedJob> & Pick<NormalizedJob, "id" | "title"> = { id, title: "Operations Coordinator" }, createdAt = firstTime): ApplicationRecord {
  const ranked = analyzeJobs(candidate(), [job(overrides)]).rankedJobs[0]
  const result = createApplication({ id, rankedJob: ranked, createdAt })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

describe("JSON application repository", () => {
  it("treats missing storage as empty, creates records, loads them, and returns detached copies", async () => {
    const path = await repositoryPath()
    const repository = createFileApplicationRepository(path)
    const application = record("application-1")

    expect(await repository.list()).toEqual({ ok: true, value: [] })
    expect(await repository.getById("missing")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } })
    expect(await repository.create(application)).toEqual({ ok: true, value: application })
    const loaded = await repository.getById("application-1")
    expect(loaded).toEqual({ ok: true, value: application })
    if (!loaded.ok) throw new Error("expected application")
    loaded.value.jobSnapshot.title = "Mutated caller copy"
    expect(await repository.getById("application-1")).toEqual({ ok: true, value: application })
    expect(await readFile(path, "utf8")).toContain('"schemaVersion": 1')
  })

  it("persists immutable status and note updates with complete snapshots and optional URLs", async () => {
    const repository = createFileApplicationRepository(await repositoryPath())
    const original = record("application-2", {
      id: "nurse-job",
      title: "Nurse",
      source: "healthcare",
      sourceId: "nurse-source",
      url: null,
      applyUrl: null,
      skills: ["Patient care"],
    })
    expect((await repository.create(original)).ok).toBe(true)
    const applied = updateApplicationStatus(original, { status: "applied", timestamp: secondTime, note: "Submitted" })
    if (!applied.ok) throw new Error(applied.error.message)
    const noted = addApplicationNote(applied.value, { text: "Await response", createdAt: "2026-09-03T10:00:00.000Z" })
    if (!noted.ok) throw new Error(noted.error.message)

    expect(await repository.save(noted.value)).toEqual({ ok: true, value: noted.value })
    expect(await repository.getById("application-2")).toEqual({ ok: true, value: noted.value })
    expect(original.status).toBe("saved")
    expect(noted.value.jobSnapshot).toMatchObject({ source: "healthcare", sourceId: "nurse-source", url: null, applyUrl: null })
    expect(noted.value.analysisSnapshot.scoringResult.confidence).toBeDefined()
    expect(noted.value.statusHistory).toHaveLength(2)
    expect(noted.value.notes).toEqual([{ text: "Await response", createdAt: "2026-09-03T10:00:00.000Z" }])
    expect("candidateProfile" in noted.value).toBe(false)
  })

  it("uses strict create/save identity semantics and deterministic list ordering", async () => {
    const repository = createFileApplicationRepository(await repositoryPath())
    const older = record("b-id", { id: "logistics", title: "Logistics Coordinator", source: "logistics" }, firstTime)
    const newerA = record("a-id", { id: "retail", title: "Retail Manager", source: "retail" }, secondTime)
    const newerC = record("c-id", { id: "finance", title: "Financial Analyst", source: "finance" }, secondTime)

    expect((await repository.create(older)).ok).toBe(true)
    expect((await repository.create(newerC)).ok).toBe(true)
    expect((await repository.create(newerA)).ok).toBe(true)
    expect(await repository.create(older)).toMatchObject({ ok: false, error: { code: "DUPLICATE_ID" } })
    expect(await repository.save(record("missing"))).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } })
    const listed = await repository.list()
    expect(listed.ok).toBe(true)
    if (!listed.ok) throw new Error(listed.error.message)
    expect(listed.value.map((item) => item.id)).toEqual(["a-id", "c-id", "b-id"])
  })

  it("reports corruption and unsupported schema without rewriting storage", async () => {
    const path = await repositoryPath()
    const repository = createFileApplicationRepository(path)
    await mkdir(join(path, ".."), { recursive: true })
    await writeFile(path, "{ invalid", "utf8")
    expect(await repository.list()).toMatchObject({ ok: false, error: { code: "CORRUPT_STORAGE" } })
    expect(await readFile(path, "utf8")).toBe("{ invalid")

    await writeFile(path, JSON.stringify({ schemaVersion: 2, applications: [] }), "utf8")
    expect(await repository.list()).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_SCHEMA_VERSION" } })
    await writeFile(path, JSON.stringify({ schemaVersion: 1, applications: [{}] }), "utf8")
    expect(await repository.list()).toMatchObject({ ok: false, error: { code: "CORRUPT_STORAGE" } })
    await writeFile(path, JSON.stringify({ schemaVersion: 1, applications: [record("same"), record("same")] }), "utf8")
    expect(await repository.list()).toMatchObject({ ok: false, error: { code: "CORRUPT_STORAGE" } })
  })

  it("removes an application by id, leaves others untouched, and reports missing records", async () => {
    const repository = createFileApplicationRepository(await repositoryPath())
    const keep = record("keep")
    const toRemove = record("remove-me")
    expect((await repository.create(keep)).ok).toBe(true)
    expect((await repository.create(toRemove)).ok).toBe(true)
    expect(await repository.remove("remove-me")).toEqual({ ok: true, value: undefined })
    expect(await repository.getById("remove-me")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } })
    expect(await repository.getById("keep")).toEqual({ ok: true, value: keep })
    expect(await repository.remove("remove-me")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } })
  })

  it("uses atomic replacement and reports practical read and write failures", async () => {
    const path = await repositoryPath()
    const repository = createFileApplicationRepository(path)
    const original = record("atomic")
    expect((await repository.create(original)).ok).toBe(true)
    const updated = updateApplicationStatus(original, { status: "preparing", timestamp: secondTime })
    if (!updated.ok) throw new Error(updated.error.message)
    expect((await repository.save(updated.value)).ok).toBe(true)
    expect(await repository.getById("atomic")).toEqual({ ok: true, value: updated.value })
    expect(await readFile(path, "utf8")).not.toContain(".tmp")

    const readFailurePath = await repositoryPath()
    await mkdir(readFailurePath, { recursive: true })
    expect(await createFileApplicationRepository(readFailurePath).list()).toMatchObject({ ok: false, error: { code: "READ_FAILURE" } })

    const writeFailurePath = await repositoryPath()
    const blockedParent = dirname(writeFailurePath)
    await mkdir(blockedParent, { recursive: true })
    await mkdir(join(blockedParent, ".applications.json.tmp"))
    expect(await createFileApplicationRepository(writeFailurePath).create(record("write-failure"))).toMatchObject({ ok: false, error: { code: "WRITE_FAILURE" } })
  })
})
