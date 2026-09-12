import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  appendManagedApplicationNote,
  formatNoteAppendConfirmation,
  formatStatusUpdateConfirmation,
  updateManagedApplicationStatus,
} from "../src/cli-application-management"
import {
  analyzeJobs,
  createApplication,
  createFileApplicationRepository,
  normalizeCandidateProfile,
  normalizeJob,
  type ApplicationRecord,
  type ApplicationRepository,
} from "../src/index"

const createdAt = "2026-01-01T00:00:00.000Z"
const appliedAt = "2026-02-01T00:00:00.000Z"
const notedAt = "2026-03-01T00:00:00.000Z"
const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

function record(id = "application-1"): ApplicationRecord {
  const profile = normalizeCandidateProfile({ headline: "Coordinator", targetRoles: ["Coordinator"], locationPreferences: [], workMode: "onsite", remotePreference: false, preferredEmploymentType: ["full-time"], skills: { technical: ["Scheduling"], soft: [] }, yearsOfExperience: 2 })
  const job = normalizeJob({ id: "job-1", source: "fixture", sourceId: "source-1", title: "Coordinator", company: "Example", location: "Malmö", url: null, applyUrl: null, remote: "onsite", employmentType: "full-time", seniority: null, skills: ["Scheduling"], description: null })
  const created = createApplication({ id, rankedJob: analyzeJobs(profile, [job]).rankedJobs[0], createdAt, initialNote: { text: "Earlier note", createdAt } })
  if (!created.ok) throw new Error(created.error.message)
  return created.value
}

async function storedRepository() {
  const directory = await mkdtemp(join(tmpdir(), "h3-management-")); directories.push(directory)
  const path = join(directory, "applications.json")
  const repository = createFileApplicationRepository(path)
  const initial = record()
  const saved = await repository.create(initial)
  if (!saved.ok) throw new Error(saved.error.message)
  return { path, repository, initial }
}

describe("H3 application management CLI boundary", () => {
  it("persists immutable status updates with append-only history, including same-status events", async () => {
    const fixture = await storedRepository()
    const before = structuredClone(fixture.initial)
    const input = { applicationId: "application-1", status: "applied" as const, timestamp: appliedAt }
    const updated = await updateManagedApplicationStatus(fixture.repository, input)
    expect(updated).toMatchObject({ ok: true, value: { status: "applied", updatedAt: appliedAt } })
    if (!updated.ok) throw new Error("Expected status update")
    expect(updated.value.statusHistory).toEqual([
      { status: "saved", timestamp: createdAt },
      { status: "applied", timestamp: appliedAt },
    ])
    expect(fixture.initial).toEqual(before)
    const reloaded = await createFileApplicationRepository(fixture.path).getById("application-1")
    expect(reloaded).toEqual({ ok: true, value: updated.value })
    const repeated = await updateManagedApplicationStatus(fixture.repository, input)
    expect(repeated.ok && repeated.value.statusHistory).toHaveLength(3)
    expect(repeated.ok && repeated.value.statusHistory.at(-1)).toEqual({ status: "applied", timestamp: appliedAt })
    const confirmation = formatStatusUpdateConfirmation(input)
    expect(confirmation).toBe("Application application-1 status updated to applied at 2026-02-01T00:00:00.000Z.")
    expect(formatStatusUpdateConfirmation(input)).toBe(confirmation)
  })

  it("preserves authoritative domain/repository failures, including save failure", async () => {
    const fixture = await storedRepository()
    expect(await updateManagedApplicationStatus(fixture.repository, { applicationId: "application-1", status: "invalid" as never, timestamp: appliedAt })).toMatchObject({ ok: false, error: { kind: "domain", error: { code: "INVALID_APPLICATION_STATUS" } } })
    expect(await updateManagedApplicationStatus(fixture.repository, { applicationId: "application-1", status: "applied", timestamp: "bad" })).toMatchObject({ ok: false, error: { kind: "domain", error: { code: "INVALID_TIMESTAMP" } } })
    expect(await updateManagedApplicationStatus(fixture.repository, { applicationId: "application-1", status: "applied", timestamp: "2025-01-01T00:00:00.000Z" })).toMatchObject({ ok: false, error: { kind: "domain", error: { code: "TIMESTAMP_OUT_OF_ORDER" } } })
    expect(await updateManagedApplicationStatus(fixture.repository, { applicationId: "missing", status: "applied", timestamp: appliedAt })).toMatchObject({ ok: false, error: { kind: "repository", error: { code: "NOT_FOUND" } } })

    const existing = record()
    const failing: ApplicationRepository = {
      create: async () => ({ ok: true, value: existing }),
      save: async () => ({ ok: false, error: { code: "WRITE_FAILURE", message: "safe failure" } }),
      getById: async () => ({ ok: true, value: structuredClone(existing) }),
      list: async () => ({ ok: true, value: [structuredClone(existing)] }),
      remove: async () => ({ ok: true, value: undefined }),
    }
    expect(await updateManagedApplicationStatus(failing, { applicationId: existing.id, status: "applied", timestamp: appliedAt })).toMatchObject({ ok: false, error: { kind: "repository", error: { code: "WRITE_FAILURE" } } })
  })

  it("persists exact append-only note text while confirmations and errors do not expose it", async () => {
    const fixture = await storedRepository()
    const privateText = "  PRIVATE NOTE CONTENT\nkept exactly\n"
    const input = { applicationId: "application-1", text: privateText, timestamp: notedAt }
    const noted = await appendManagedApplicationNote(fixture.repository, input)
    expect(noted).toMatchObject({ ok: true, value: { updatedAt: notedAt } })
    if (!noted.ok) throw new Error("Expected note append")
    expect(noted.value.notes).toEqual([
      { text: "Earlier note", createdAt },
      { text: privateText, createdAt: notedAt },
    ])
    const reloaded = await createFileApplicationRepository(fixture.path).getById("application-1")
    expect(reloaded).toEqual({ ok: true, value: noted.value })
    expect(await appendManagedApplicationNote(fixture.repository, { applicationId: "application-1", text: " \n ", timestamp: notedAt })).toMatchObject({ ok: false, error: { kind: "domain", error: { code: "EMPTY_NOTE" } } })
    const confirmation = formatNoteAppendConfirmation(input)
    expect(confirmation).toBe("Application application-1 note added at 2026-03-01T00:00:00.000Z.")
    expect(confirmation).not.toContain(privateText)
    expect(formatNoteAppendConfirmation(input)).toBe(confirmation)
  })
})
