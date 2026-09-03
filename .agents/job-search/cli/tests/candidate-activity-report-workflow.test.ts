import { describe, expect, it } from "bun:test"
import type { ApplicationRepository } from "../src/application-repository"
import type { ApplicationRecord } from "../src/applications"
import type { CandidateApplicationAssociation } from "../src/coach-application-association"
import type { CandidateApplicationAssociationRepository } from "../src/coach-application-association-repository"
import type { CoachActivity } from "../src/coach-activity"
import type { CandidateFollowUp } from "../src/coach-candidate-follow-up"
import type { CandidateFollowUpRepository } from "../src/coach-candidate-follow-up-repository"
import type { CoachOperationsRepository } from "../src/coach-operations-repository"
import { createCandidateActivityReportWorkflow, createCoachCandidate } from "../src/index"
import type { CoachWorkspaceRepository } from "../src/coach-workspace-repository"

const candidate = createCoachCandidate({ id: "candidate-a", displayName: "Alex", createdAt: "2026-01-01T00:00:00.000Z" })
if (!candidate.ok) throw new Error(candidate.error.message)
const application = { id: "application-1", status: "applied", createdAt: "2026-01-02T00:00:00.000Z", statusHistory: [{ status: "applied", timestamp: "2026-01-02T00:00:00.000Z" }] } as unknown as ApplicationRecord
const association: CandidateApplicationAssociation = { candidateId: "candidate-a", applicationId: "application-1", createdAt: "2026-01-01T00:00:00.000Z" }
const followUp: CandidateFollowUp = { id: "follow-up-1", candidateId: "candidate-a", applicationId: "application-1", dueAt: "2026-01-10T00:00:00.000Z", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z", completedAt: "2026-01-04T00:00:00.000Z" }
const activity: CoachActivity = { id: "activity-1", candidateId: "candidate-a", kind: "applyForJob", status: "completed", plannedAt: "2026-01-03T00:00:00.000Z", completedAt: "2026-01-04T00:00:00.000Z", applicationId: "application-1", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-04T00:00:00.000Z" }

const candidates: CoachWorkspaceRepository = { async createCandidate(value) { return { ok: true, value } }, async getCandidateById(id) { return id === "candidate-a" ? { ok: true, value: structuredClone(candidate.value) } : { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }, async listCandidates() { return { ok: true, value: [structuredClone(candidate.value)] } } }
const applications: ApplicationRepository = { async create(value) { return { ok: true, value } }, async save(value) { return { ok: true, value } }, async getById(id) { return id === application.id ? { ok: true, value: structuredClone(application) } : { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }, async list() { return { ok: true, value: [structuredClone(application)] } } }
const associations: CandidateApplicationAssociationRepository = { async create(value) { return { ok: true, value } }, async getByApplicationId(id) { return id === association.applicationId ? { ok: true, value: structuredClone(association) } : { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }, async listByCandidateId(id) { return id === association.candidateId ? { ok: true, value: [structuredClone(association)] } : { ok: true, value: [] } } }
const followUps: CandidateFollowUpRepository = { async create(value) { return { ok: true, value } }, async getById(id) { return id === followUp.id ? { ok: true, value: structuredClone(followUp) } : { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }, async listByCandidateId(id) { return id === followUp.candidateId ? { ok: true, value: [structuredClone(followUp)] } : { ok: true, value: [] } }, async save(value) { return { ok: true, value } } }
const operations: CoachOperationsRepository = { async createNote(value) { return { ok: true, value } }, async getNoteById() { return { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }, async listNotesByCandidateId() { return { ok: true, value: [] } }, async saveNote(value) { return { ok: true, value } }, async createGoal(value) { return { ok: true, value } }, async getGoalById() { return { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }, async listGoalsByCandidateId() { return { ok: true, value: [] } }, async saveGoal(value) { return { ok: true, value } }, async createActivity(value) { return { ok: true, value } }, async getActivityById() { return { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }, async listActivitiesByCandidateId() { return { ok: true, value: [structuredClone(activity)] } }, async saveActivity(value) { return { ok: true, value } } }

describe("Phase 8.1 candidate activity report workflow", () => {
  it("loads candidate-scoped authoritative sources and validates linked ownership", async () => {
    const workflow = createCandidateActivityReportWorkflow(candidates, applications, associations, followUps, operations)
    const result = await workflow.getCandidateActivityReport("candidate-a", { startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-01-10T00:00:00.000Z" })
    expect(result).toMatchObject({ ok: true, value: { candidateId: "candidate-a", summary: { applicationCreated: 1, followUpCompleted: 1, coachActivityCompleted: 1 } } })
    expect(await workflow.getCandidateActivityReport("missing", { startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-01-10T00:00:00.000Z" })).toMatchObject({ ok: false, error: { kind: "candidate_repository", error: { code: "NOT_FOUND" } } })
  })

  it("fails closed for orphaned and cross-candidate references and preserves repository failures", async () => {
    const orphaned = { ...associations, async getByApplicationId() { return { ok: false as const, error: { code: "NOT_FOUND" as const, message: "missing" } } } }
    const workflow = createCandidateActivityReportWorkflow(candidates, applications, orphaned, followUps, operations)
    expect(await workflow.getCandidateActivityReport("candidate-a", { startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-01-10T00:00:00.000Z" })).toMatchObject({ ok: false, error: { kind: "follow_up_application_mismatch" } })
    const crossCandidate = { ...associations, async getByApplicationId() { return { ok: true as const, value: { ...association, candidateId: "candidate-b" } } } }
    expect(await createCandidateActivityReportWorkflow(candidates, applications, crossCandidate, { ...followUps, async listByCandidateId() { return { ok: true as const, value: [] } } }, operations).getCandidateActivityReport("candidate-a", { startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-01-10T00:00:00.000Z" })).toMatchObject({ ok: false, error: { kind: "activity_application_mismatch" } })
    const corrupt = { ...associations, async listByCandidateId() { return { ok: false as const, error: { code: "CORRUPT_STORAGE" as const, message: "corrupt" } } } }
    expect(await createCandidateActivityReportWorkflow(candidates, applications, corrupt, followUps, operations).getCandidateActivityReport("candidate-a", { startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-01-10T00:00:00.000Z" })).toMatchObject({ ok: false, error: { kind: "association_repository", error: { code: "CORRUPT_STORAGE" } } })
  })
})