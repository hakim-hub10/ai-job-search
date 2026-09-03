import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createFileCandidateApplicationAssociationRepository } from "../src/coach-application-association-file-repository"
import { createCandidateApplicationAssociation, type CandidateApplicationAssociation } from "../src/coach-application-association"

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

function association(candidateId: string, applicationId: string, createdAt: string): CandidateApplicationAssociation {
  const result = createCandidateApplicationAssociation({ candidateId, applicationId, createdAt })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "coach-associations-")); directories.push(root)
  const directory = join(root, "private")
  const path = join(directory, "associations.json")
  return { root, directory, path, repository: createFileCandidateApplicationAssociationRepository(path) }
}

describe("Phase 6.2 candidate application association file repository", () => {
  it("persists isolated associations in deterministic order and reloads them", async () => {
    const { path, repository } = await fixture()
    expect(await repository.listByCandidateId("candidate-a")).toEqual({ ok: true, value: [] })
    const items = [
      association("candidate-b", "application-3", "2026-03-01T00:00:00.000Z"),
      association("candidate-a", "application-2", "2026-02-01T00:00:00.000Z"),
      association("candidate-a", "application-1", "2026-01-01T00:00:00.000Z"),
    ]
    for (const item of items) expect((await repository.create(item)).ok).toBe(true)
    expect(await repository.listByCandidateId("candidate-a")).toEqual({ ok: true, value: [items[2], items[1]] })
    expect(await repository.listByCandidateId("candidate-b")).toEqual({ ok: true, value: [items[0]] })
    expect(await createFileCandidateApplicationAssociationRepository(path).getByApplicationId("application-2"))
      .toEqual({ ok: true, value: items[1] })
    expect(await repository.getByApplicationId("missing")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } })
  })

  it("enforces one candidate owner per application without mutating storage or inputs", async () => {
    const { path, repository } = await fixture()
    const original = association("candidate-a", "application-1", "2026-01-01T00:00:00.000Z")
    const before = structuredClone(original)
    expect((await repository.create(original)).ok).toBe(true)
    const persisted = await readFile(path, "utf8")
    expect(await repository.create(association("candidate-b", "application-1", "2026-02-01T00:00:00.000Z")))
      .toMatchObject({ ok: false, error: { code: "DUPLICATE_ASSOCIATION" } })
    expect(await repository.create({ ...original, profile: { secret: true } } as never))
      .toMatchObject({ ok: false, error: { code: "INVALID_RECORD" } })
    expect(await readFile(path, "utf8")).toBe(persisted)
    expect(original).toEqual(before)
  })

  it("returns detached references and writes only minimal metadata with restrictive modes", async () => {
    const { directory, path, repository } = await fixture()
    const item = association("candidate-a", "application-1", "2026-01-01T00:00:00.000Z")
    const created = await repository.create(item)
    if (!created.ok) throw new Error(created.error.message)
    created.value.candidateId = "changed"
    const loaded = await repository.getByApplicationId(item.applicationId)
    if (!loaded.ok) throw new Error(loaded.error.message)
    loaded.value.candidateId = "changed-again"
    expect(await repository.getByApplicationId(item.applicationId)).toEqual({ ok: true, value: item })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(directory)).mode & 0o777).toBe(0o700)
    const serialized = await readFile(path, "utf8")
    for (const forbidden of ["displayName", "CandidateProfile", "CandidateDocumentEvidence", "jobSnapshot", "notes", "rawAnswer", "OPENAI_API_KEY"]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it("fails closed for malformed, extra-field, duplicate, and unsupported storage", async () => {
    const { path, repository } = await fixture()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, "{", "utf8")
    expect(await repository.listByCandidateId("candidate-a")).toMatchObject({ ok: false, error: { code: "CORRUPT_STORAGE" } })
    await writeFile(path, JSON.stringify({ schemaVersion: 2, associations: [] }), "utf8")
    expect(await repository.listByCandidateId("candidate-a")).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_SCHEMA_VERSION" } })
    const item = association("candidate-a", "application-1", "2026-01-01T00:00:00.000Z")
    await writeFile(path, JSON.stringify({ schemaVersion: 1, associations: [item, item] }), "utf8")
    expect(await repository.listByCandidateId("candidate-a")).toMatchObject({ ok: false, error: { code: "CORRUPT_STORAGE" } })
    await writeFile(path, JSON.stringify({ schemaVersion: 1, associations: [{ ...item, evidence: "forbidden" }] }), "utf8")
    expect(await repository.listByCandidateId("candidate-a")).toMatchObject({ ok: false, error: { code: "CORRUPT_STORAGE" } })
  })

  it("reports read and atomic write failures without leaking reference values", async () => {
    const { root, path, repository } = await fixture()
    expect(await createFileCandidateApplicationAssociationRepository(root).listByCandidateId("private-candidate"))
      .toMatchObject({ ok: false, error: { code: "READ_FAILURE" } })
    const retained = association("retained", "retained-application", "2026-01-01T00:00:00.000Z")
    expect((await repository.create(retained)).ok).toBe(true)
    const before = await readFile(path, "utf8")
    await mkdir(join(dirname(path), ".associations.json.tmp"))
    const failed = await repository.create(association("PRIVATE CANDIDATE", "PRIVATE APPLICATION", "2026-02-01T00:00:00.000Z"))
    expect(failed).toMatchObject({ ok: false, error: { code: "WRITE_FAILURE" } })
    expect(JSON.stringify(failed)).not.toContain("PRIVATE")
    expect(await readFile(path, "utf8")).toBe(before)
  })
})
