import { describe, expect, it } from "bun:test"
import type { ApplicationRepository } from "../src/application-repository"
import type { ApplicationRecord } from "../src/applications"
import type { CandidateApplicationAssociation } from "../src/coach-application-association"
import type { CandidateApplicationAssociationRepository } from "../src/coach-application-association-repository"
import type { CoachCandidate } from "../src/coach-workspace"
import type { CoachWorkspaceRepository } from "../src/coach-workspace-repository"
import type { CoachOperationsRepository } from "../src/coach-operations-repository"
import type { CoachNote } from "../src/coach-note"
import type { CoachGoal } from "../src/coach-goal"
import type { CoachActivity } from "../src/coach-activity"
import { createCoachOperationsWorkflow, createCoachCandidate, createCoachNote, createCoachGoal, createCoachActivity } from "../src/index"

const candidate = (id: string): CoachCandidate => ({ id, displayName: id, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" })
const application = (id: string): ApplicationRecord => ({ id, status: "applied", statusHistory: [], notes: [] } as unknown as ApplicationRecord)
function candidates(values: CoachCandidate[]): CoachWorkspaceRepository { return { async createCandidate(value) { return { ok: true, value } }, async getCandidateById(id) { const value = values.find((item) => item.id === id); return value ? { ok: true, value: structuredClone(value) } : { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }, async listCandidates() { return { ok: true, value: structuredClone(values) } } } }
function applications(values: ApplicationRecord[]): ApplicationRepository { return { async create(value) { return { ok: true, value } }, async save(value) { return { ok: true, value } }, async getById(id) { const value = values.find((item) => item.id === id); return value ? { ok: true, value: structuredClone(value) } : { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }, async list() { return { ok: true, value: structuredClone(values) } }, async remove() { return { ok: true, value: undefined } } } }
function associations(values: CandidateApplicationAssociation[]): CandidateApplicationAssociationRepository { return { async create(value) { values.push(value); return { ok: true, value } }, async getByApplicationId(id) { const value = values.find((item) => item.applicationId === id); return value ? { ok: true, value: structuredClone(value) } : { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }, async listByCandidateId(id) { return { ok: true, value: structuredClone(values.filter((item) => item.candidateId === id)) } }, async deleteByApplicationId() { return { ok: true, value: undefined } } } }
function operations(): CoachOperationsRepository {
  const notes: CoachNote[] = []; const goals: CoachGoal[] = []; const activities: CoachActivity[] = []
  return { async createNote(value) { notes.push(structuredClone(value)); return { ok: true, value } }, async getNoteById(id) { const value = notes.find((item) => item?.id === id); return value ? { ok: true, value: structuredClone(value) } : { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }, async listNotesByCandidateId(id) { return { ok: true, value: structuredClone(notes.filter((item) => item?.candidateId === id)) } }, async saveNote(value) { return { ok: true, value } }, async createGoal(value) { goals.push(structuredClone(value)); return { ok: true, value } }, async getGoalById(id) { const value = goals.find((item) => item?.id === id); return value ? { ok: true, value: structuredClone(value) } : { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }, async listGoalsByCandidateId(id) { return { ok: true, value: structuredClone(goals.filter((item) => item?.candidateId === id)) } }, async saveGoal(value) { return { ok: true, value } }, async createActivity(value) { activities.push(structuredClone(value)); return { ok: true, value } }, async getActivityById(id) { const value = activities.find((item) => item?.id === id); return value ? { ok: true, value: structuredClone(value) } : { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }, async listActivitiesByCandidateId(id) { return { ok: true, value: structuredClone(activities.filter((item) => item?.candidateId === id)) } }, async saveActivity(value) { return { ok: true, value } } }
}

describe("Phase 7.1 coach operations workflow", () => {
  it("verifies candidates, isolates reads, and preserves application authority", async () => {
    const workflow = createCoachOperationsWorkflow(candidates([candidate("candidate-a"), candidate("candidate-b")]), operations(), applications([application("application-1")]), associations([{ candidateId: "candidate-a", applicationId: "application-1", createdAt: "2026-01-01T00:00:00.000Z" }]))
    expect(await workflow.createNote({ id: "note-1", candidateId: "candidate-a", text: "Coach-only note", createdAt: "2026-01-01T00:00:00.000Z" })).toMatchObject({ ok: true })
    expect(await workflow.listNotes("candidate-b")).toEqual({ ok: true, value: [] })
    expect(await workflow.createActivity({ id: "activity-1", candidateId: "candidate-a", kind: "applyForJob", applicationId: "application-1", createdAt: "2026-01-01T00:00:00.000Z" })).toMatchObject({ ok: true, value: { status: "planned", applicationId: "application-1" } })
    expect(await workflow.createActivity({ id: "activity-2", candidateId: "candidate-b", kind: "applyForJob", applicationId: "application-1", createdAt: "2026-01-01T00:00:00.000Z" })).toMatchObject({ ok: false, error: { kind: "application_candidate_mismatch" } })
    expect(await workflow.createNote({ id: "note-2", candidateId: "missing", text: "No", createdAt: "2026-01-01T00:00:00.000Z" })).toMatchObject({ ok: false, error: { kind: "candidate_repository", error: { code: "NOT_FOUND" } } })
  })
})