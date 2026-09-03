import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { createFileCandidateFollowUpRepository, createCandidateFollowUp } from "../src/index"

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "coach-follow-ups-")); directories.push(root)
  const path = join(root, "private", "follow-ups.json")
  return { root, path, repository: createFileCandidateFollowUpRepository(path) }
}

function followUp(id: string, candidateId = "candidate-a") {
  const result = createCandidateFollowUp({ id, candidateId, dueAt: "2026-01-03T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

describe("Phase 6.3 candidate follow-up file repository", () => {
  it("persists isolated records in deterministic order with restrictive modes", async () => {
    const { path, repository } = await fixture()
    expect(await repository.listByCandidateId("candidate-a")).toEqual({ ok: true, value: [] })
    expect((await repository.create(followUp("b"))).ok).toBe(true)
    expect((await repository.create(followUp("a", "candidate-b"))).ok).toBe(true)
    const loaded = await repository.getById("b")
    expect(loaded).toMatchObject({ ok: true, value: { candidateId: "candidate-a" } })
    if (loaded.ok) loaded.value.candidateId = "changed"
    expect(await repository.listByCandidateId("candidate-a")).toMatchObject({ ok: true, value: [{ id: "b" }] })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(dirname(path))).mode & 0o777).toBe(0o700)
    expect(await readFile(path, "utf8")).not.toContain("statusHistory")
  })

  it("rejects duplicates and fails closed for malformed storage", async () => {
    const { path, repository } = await fixture()
    const item = followUp("duplicate")
    expect((await repository.create(item)).ok).toBe(true)
    expect(await repository.create(item)).toMatchObject({ ok: false, error: { code: "DUPLICATE_ID" } })
    await writeFile(path, "{", "utf8")
    expect(await repository.listByCandidateId("candidate-a")).toMatchObject({ ok: false, error: { code: "CORRUPT_STORAGE" } })
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify({ schemaVersion: 2, followUps: [] }), "utf8")
    expect(await repository.listByCandidateId("candidate-a")).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_SCHEMA_VERSION" } })
  })
})