import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { validateCoachActivity, type CoachActivity } from "./coach-activity"
import { validateCoachGoal, type CoachGoal } from "./coach-goal"
import { validateCoachNote, type CoachNote } from "./coach-note"
import type { CoachOperationsRepository, CoachOperationsRepositoryErrorCode, CoachOperationsRepositoryResult } from "./coach-operations-repository"

const SCHEMA_VERSION = 1
interface CoachOperationsEnvelope { schemaVersion: typeof SCHEMA_VERSION; notes: CoachNote[]; goals: CoachGoal[]; activities: CoachActivity[] }
function failure<T>(code: CoachOperationsRepositoryErrorCode, message: string): CoachOperationsRepositoryResult<T> { return { ok: false, error: { code, message } } }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).sort().join(",") === keys.sort().join(",") }
function validNote(value: unknown): value is CoachNote { return validateCoachNote(value).ok }
function validGoal(value: unknown): value is CoachGoal { return validateCoachGoal(value).ok }
function validActivity(value: unknown): value is CoachActivity { return validateCoachActivity(value).ok }
function compareNotes(a: CoachNote, b: CoachNote): number { return b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id) }
function compareGoals(a: CoachGoal, b: CoachGoal): number { return (a.dueAt ?? "9999-12-31T23:59:59.999Z").localeCompare(b.dueAt ?? "9999-12-31T23:59:59.999Z") || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id) }
function compareActivities(a: CoachActivity, b: CoachActivity): number { return (a.plannedAt ?? a.createdAt).localeCompare(b.plannedAt ?? b.createdAt) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id) }
function validateEnvelope(value: unknown): CoachOperationsRepositoryResult<CoachOperationsEnvelope> {
  if (!isObject(value) || !exactKeys(value, ["activities", "goals", "notes", "schemaVersion"]) || value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.notes) || !Array.isArray(value.goals) || !Array.isArray(value.activities)) {
    if (isObject(value) && value.schemaVersion !== undefined && value.schemaVersion !== SCHEMA_VERSION) return failure("UNSUPPORTED_SCHEMA_VERSION", "Coach operations storage schema version is not supported.")
    return failure("CORRUPT_STORAGE", "Coach operations storage has an invalid envelope.")
  }
  if (!value.notes.every(validNote) || !value.goals.every(validGoal) || !value.activities.every(validActivity)) return failure("CORRUPT_STORAGE", "Coach operations storage contains a malformed record.")
  const ids = new Set<string>()
  for (const record of [...value.notes, ...value.goals, ...value.activities]) {
    if (ids.has(record.id)) return failure("CORRUPT_STORAGE", "Coach operations storage contains duplicate IDs.")
    ids.add(record.id)
  }
  return { ok: true, value: { schemaVersion: SCHEMA_VERSION, notes: structuredClone(value.notes).sort(compareNotes), goals: structuredClone(value.goals).sort(compareGoals), activities: structuredClone(value.activities).sort(compareActivities) } }
}
function errorCode(error: unknown): string | undefined { return isObject(error) && typeof error.code === "string" ? error.code : undefined }

export function createFileCoachOperationsRepository(filePath: string): CoachOperationsRepository {
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.tmp`)
  async function load(): Promise<CoachOperationsRepositoryResult<CoachOperationsEnvelope>> {
    let text: string
    try { text = await readFile(filePath, "utf8") } catch (error) { return errorCode(error) === "ENOENT" ? { ok: true, value: { schemaVersion: SCHEMA_VERSION, notes: [], goals: [], activities: [] } } : failure("READ_FAILURE", "Coach operations storage could not be read.") }
    if (text.trim().length === 0) return failure("CORRUPT_STORAGE", "Coach operations storage is empty.")
    try { return validateEnvelope(JSON.parse(text)) } catch { return failure("CORRUPT_STORAGE", "Coach operations storage contains malformed JSON.") }
  }
  async function write(value: CoachOperationsEnvelope): Promise<CoachOperationsRepositoryResult<void>> {
    const checked = validateEnvelope(value)
    if (!checked.ok) return checked
    try {
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
      await writeFile(tempPath, `${JSON.stringify(checked.value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
      const handle = await open(tempPath, "r")
      try { await handle.sync() } finally { await handle.close() }
      await rename(tempPath, filePath)
      return { ok: true, value: undefined }
    } catch { await rm(tempPath, { force: true }).catch(() => undefined); return failure("WRITE_FAILURE", "Coach operations storage could not be written.") }
  }
  async function create<T extends CoachNote | CoachGoal | CoachActivity>(record: T, kind: "notes" | "goals" | "activities"): Promise<CoachOperationsRepositoryResult<T>> {
    const checked = kind === "notes" ? validNote(record) : kind === "goals" ? validGoal(record) : validActivity(record)
    if (!checked) return failure("INVALID_RECORD", "Coach operations record is malformed.")
    const loaded = await load()
    if (!loaded.ok) return loaded
    if ([...loaded.value.notes, ...loaded.value.goals, ...loaded.value.activities].some((item) => item.id === record.id)) return failure("DUPLICATE_ID", "A coach operations record with this ID already exists.")
    const next = { ...loaded.value, [kind]: [...loaded.value[kind], structuredClone(record)] } as CoachOperationsEnvelope
    const written = await write(next)
    return written.ok ? { ok: true, value: structuredClone(record) } : written
  }
  async function get<T extends CoachNote | CoachGoal | CoachActivity>(id: string, kind: "notes" | "goals" | "activities"): Promise<CoachOperationsRepositoryResult<T>> {
    const loaded = await load(); if (!loaded.ok) return loaded
    const record = loaded.value[kind].find((item) => item.id === id)
    return record ? { ok: true, value: structuredClone(record) as T } : failure("NOT_FOUND", "Coach operations record was not found.")
  }
  async function list<T extends CoachNote | CoachGoal | CoachActivity>(candidateId: string, kind: "notes" | "goals" | "activities"): Promise<CoachOperationsRepositoryResult<T[]>> {
    const loaded = await load(); if (!loaded.ok) return loaded
    return { ok: true, value: structuredClone(loaded.value[kind].filter((item) => item.candidateId === candidateId)) as T[] }
  }
  async function save<T extends CoachNote | CoachGoal | CoachActivity>(record: T, kind: "notes" | "goals" | "activities"): Promise<CoachOperationsRepositoryResult<T>> {
    const checked = kind === "notes" ? validNote(record) : kind === "goals" ? validGoal(record) : validActivity(record)
    if (!checked) return failure("INVALID_RECORD", "Coach operations record is malformed.")
    const loaded = await load(); if (!loaded.ok) return loaded
    const index = loaded.value[kind].findIndex((item) => item.id === record.id)
    if (index < 0) return failure("NOT_FOUND", "Coach operations record was not found.")
    const records = [...loaded.value[kind]]; records[index] = structuredClone(record)
    const written = await write({ ...loaded.value, [kind]: records } as CoachOperationsEnvelope)
    return written.ok ? { ok: true, value: structuredClone(record) } : written
  }
  return {
    createNote: (record) => create(record, "notes"), getNoteById: (id) => get(id, "notes"), listNotesByCandidateId: (id) => list(id, "notes"), saveNote: (record) => save(record, "notes"),
    createGoal: (record) => create(record, "goals"), getGoalById: (id) => get(id, "goals"), listGoalsByCandidateId: (id) => list(id, "goals"), saveGoal: (record) => save(record, "goals"),
    createActivity: (record) => create(record, "activities"), getActivityById: (id) => get(id, "activities"), listActivitiesByCandidateId: (id) => list(id, "activities"), saveActivity: (record) => save(record, "activities"),
  }
}