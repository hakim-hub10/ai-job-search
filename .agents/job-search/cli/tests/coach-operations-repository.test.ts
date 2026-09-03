import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { createCoachActivity, createCoachGoal, createCoachNote, createFileCoachOperationsRepository } from "../src/index"

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })
async function fixture() { const root = await mkdtemp(join(tmpdir(), "coach-operations-")); directories.push(root); const path = join(root, "private", "operations.json"); return { root, path, repository: createFileCoachOperationsRepository(path) } }
const note = createCoachNote({ id: "note-1", candidateId: "candidate-a", text: "Keep note separate", createdAt: "2026-01-01T00:00:00.000Z" })
const goal = createCoachGoal({ id: "goal-1", candidateId: "candidate-a", title: "Apply", createdAt: "2026-01-01T00:00:00.000Z" })
const activity = createCoachActivity({ id: "activity-1", candidateId: "candidate-b", kind: "coachingMeeting", createdAt: "2026-01-02T00:00:00.000Z" })

describe("Phase 7.1 coach operations repository", () => {
  it("persists separate typed collections, reloads detached records, and isolates candidates", async () => {
    const { path, repository } = await fixture()
    if (!note.ok || !goal.ok || !activity.ok) throw new Error("invalid fixture")
    expect((await repository.createNote(note.value)).ok).toBe(true)
    expect((await repository.createGoal(goal.value)).ok).toBe(true)
    expect((await repository.createActivity(activity.value)).ok).toBe(true)
    const reloaded = createFileCoachOperationsRepository(path)
    expect(await reloaded.listNotesByCandidateId("candidate-a")).toMatchObject({ ok: true, value: [{ id: "note-1" }] })
    expect(await reloaded.listGoalsByCandidateId("candidate-b")).toEqual({ ok: true, value: [] })
    const loaded = await reloaded.getNoteById("note-1"); if (loaded.ok) loaded.value.text = "changed"
    expect(await reloaded.getNoteById("note-1")).toMatchObject({ ok: true, value: { text: "Keep note separate" } })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(dirname(path))).mode & 0o777).toBe(0o700)
    const serialized = await readFile(path, "utf8")
    expect(serialized).toContain('"notes"'); expect(serialized).toContain('"goals"'); expect(serialized).toContain('"activities"')
    expect(serialized).not.toContain("statusHistory"); expect(serialized).not.toContain("progress")
    expect(await reloaded.createNote(note.value)).toMatchObject({ ok: false, error: { code: "DUPLICATE_ID" } })
  })

  it("fails closed for corruption, extra fields, and unsupported versions", async () => {
    const { path, repository } = await fixture(); await mkdir(dirname(path), { recursive: true })
    await writeFile(path, "{", "utf8")
    expect(await repository.listNotesByCandidateId("candidate-a")).toMatchObject({ ok: false, error: { code: "CORRUPT_STORAGE" } })
    await writeFile(path, JSON.stringify({ schemaVersion: 2, notes: [], goals: [], activities: [] }), "utf8")
    expect(await repository.listGoalsByCandidateId("candidate-a")).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_SCHEMA_VERSION" } })
    if (!note.ok) throw new Error(note.error.message)
    await writeFile(path, JSON.stringify({ schemaVersion: 1, notes: [{ ...note.value, applicationId: "forbidden" }], goals: [], activities: [] }), "utf8")
    expect(await repository.listNotesByCandidateId("candidate-a")).toMatchObject({ ok: false, error: { code: "CORRUPT_STORAGE" } })
  })

  it("keeps read and atomic write failures distinguishable", async () => {
    const { root, path, repository } = await fixture()
    expect(await createFileCoachOperationsRepository(root).listNotesByCandidateId("candidate-a")).toMatchObject({ ok: false, error: { code: "READ_FAILURE" } })
    if (!note.ok) throw new Error(note.error.message)
    expect((await repository.createNote(note.value)).ok).toBe(true)
    await mkdir(join(dirname(path), ".operations.json.tmp"))
    expect(await repository.createGoal(goal.ok ? goal.value : { id: "goal", candidateId: "candidate-a", title: "Goal", createdAt: "2026-01-01T00:00:00.000Z", status: "planned", updatedAt: "2026-01-01T00:00:00.000Z" })).toMatchObject({ ok: false, error: { code: "WRITE_FAILURE" } })
  })
})