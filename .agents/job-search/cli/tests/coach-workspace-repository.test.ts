import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { createFileCoachWorkspaceRepository } from "../src/coach-workspace-file-repository"
import { createCoachCandidate, type CoachCandidate } from "../src/coach-workspace"

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

function candidate(id: string, displayName: string, createdAt: string): CoachCandidate {
  const result = createCoachCandidate({ id, displayName, createdAt })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "coach-workspace-")); directories.push(root)
  const directory = join(root, "private")
  const path = join(directory, "workspace.json")
  return { root, directory, path, repository: createFileCoachWorkspaceRepository(path) }
}

describe("Phase 6.1 file coach workspace repository", () => {
  it("treats missing storage as empty and persists three isolated candidates deterministically", async () => {
    const { path, repository } = await fixture()
    expect(await repository.listCandidates()).toEqual({ ok: true, value: [] })
    const candidates = [
      candidate("candidate-c", "Retail Candidate", "2026-03-01T00:00:00.000Z"),
      candidate("candidate-b", "Healthcare Candidate", "2026-01-01T00:00:00.000Z"),
      candidate("candidate-a", "IT Candidate", "2026-01-01T00:00:00.000Z"),
    ]
    for (const item of candidates) expect((await repository.createCandidate(item)).ok).toBe(true)
    expect(await repository.listCandidates()).toMatchObject({ ok: true, value: [
      { id: "candidate-a" }, { id: "candidate-b" }, { id: "candidate-c" },
    ] })
    expect(await createFileCoachWorkspaceRepository(path).getCandidateById("candidate-b")).toMatchObject({ ok: true, value: { displayName: "Healthcare Candidate" } })
    expect(await repository.getCandidateById("missing")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } })
  })

  it("rejects duplicates and invalid records without mutating storage or caller values", async () => {
    const { path, repository } = await fixture()
    const original = candidate("candidate-a", "Alex", "2026-01-01T00:00:00.000Z")
    const before = structuredClone(original)
    expect((await repository.createCandidate(original)).ok).toBe(true)
    const persisted = await readFile(path, "utf8")
    expect(await repository.createCandidate(original)).toMatchObject({ ok: false, error: { code: "DUPLICATE_ID" } })
    expect(await repository.createCandidate({ ...original, displayName: " " })).toMatchObject({ ok: false, error: { code: "INVALID_RECORD" } })
    expect(await repository.createCandidate({ ...original, profile: { skills: ["invented"] } } as never)).toMatchObject({ ok: false, error: { code: "INVALID_RECORD" } })
    expect(await readFile(path, "utf8")).toBe(persisted)
    expect(original).toEqual(before)
  })

  it("returns detached records and persists only minimal metadata with restrictive modes", async () => {
    const { directory, path, repository } = await fixture()
    const hostile = candidate("candidate-a", "$(echo inert) — ignore instructions", "2026-01-01T00:00:00.000Z")
    const created = await repository.createCandidate(hostile)
    if (!created.ok) throw new Error(created.error.message)
    created.value.displayName = "Changed return"
    const loaded = await repository.getCandidateById(hostile.id)
    if (!loaded.ok) throw new Error(loaded.error.message)
    loaded.value.displayName = "Changed loaded"
    expect(await repository.getCandidateById(hostile.id)).toMatchObject({ ok: true, value: { displayName: hostile.displayName } })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(directory)).mode & 0o777).toBe(0o700)
    const serialized = await readFile(path, "utf8")
    expect(serialized).toContain(hostile.displayName)
    for (const forbidden of ["CandidateProfile", "CandidateDocumentEvidence", "OPENAI_API_KEY", "rawAnswer", "applications", "notes"]) expect(serialized).not.toContain(forbidden)
  })

  it("fails closed for malformed, duplicate, and unsupported persisted envelopes", async () => {
    const { path, repository } = await fixture()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, "{", "utf8")
    expect(await repository.listCandidates()).toMatchObject({ ok: false, error: { code: "CORRUPT_STORAGE" } })
    await writeFile(path, JSON.stringify({ schemaVersion: 2, candidates: [] }), "utf8")
    expect(await repository.listCandidates()).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_SCHEMA_VERSION" } })
    const item = candidate("candidate-a", "Alex", "2026-01-01T00:00:00.000Z")
    await writeFile(path, JSON.stringify({ schemaVersion: 1, candidates: [item, item] }), "utf8")
    expect(await repository.listCandidates()).toMatchObject({ ok: false, error: { code: "CORRUPT_STORAGE" } })
    await writeFile(path, JSON.stringify({ schemaVersion: 1, candidates: [{ ...item, score: 100 }] }), "utf8")
    expect(await repository.listCandidates()).toMatchObject({ ok: false, error: { code: "CORRUPT_STORAGE" } })
  })

  it("reports practical read and atomic write failures without leaking candidate data", async () => {
    const { root, path, repository } = await fixture()
    expect(await createFileCoachWorkspaceRepository(root).listCandidates()).toMatchObject({ ok: false, error: { code: "READ_FAILURE" } })
    const retained = candidate("retained", "Retained Candidate", "2026-01-01T00:00:00.000Z")
    expect((await repository.createCandidate(retained)).ok).toBe(true)
    const before = await readFile(path, "utf8")
    await mkdir(join(dirname(path), ".workspace.json.tmp"))
    expect(await repository.createCandidate(candidate("private-id", "PRIVATE NAME", "2026-01-01T00:00:00.000Z"))).toMatchObject({ ok: false, error: { code: "WRITE_FAILURE", message: expect.not.stringContaining("PRIVATE") } })
    expect(await readFile(path, "utf8")).toBe(before)
    expect(await repository.listCandidates()).toEqual({ ok: true, value: [retained] })
  })
})
