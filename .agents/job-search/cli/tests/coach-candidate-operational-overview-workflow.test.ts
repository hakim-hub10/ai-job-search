import { describe, expect, it } from "bun:test"
import type { ApplicationRepository } from "../src/application-repository"
import type { ApplicationRecord } from "../src/applications"
import type { CandidateApplicationAssociationRepository, CandidateApplicationAssociationRepositoryErrorCode } from "../src/coach-application-association-repository"
import type { CandidateFollowUpRepository } from "../src/coach-candidate-follow-up-repository"
import type { CoachOperationsRepository } from "../src/coach-operations-repository"
import { createCoachCandidateOperationalOverviewWorkflow } from "../src/index"
import type { CoachCandidate } from "../src/coach-workspace"
import type { CoachWorkspaceRepository } from "../src/coach-workspace-repository"
import type { CoachNote } from "../src/coach-note"
import type { CoachGoal } from "../src/coach-goal"
import type { CoachActivity } from "../src/coach-activity"

const candidate = (id: string): CoachCandidate => ({ id, displayName: id, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" })
const candidateRepository = (value: CoachCandidate): CoachWorkspaceRepository => ({ async createCandidate(item) { return { ok: true, value: item } }, async getCandidateById(id) { return id === value.id ? { ok: true, value: structuredClone(value) } : { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }, async listCandidates() { return { ok: true, value: [structuredClone(value)] } } })
const emptyApplications: ApplicationRepository = { async create(value) { return { ok: true, value } }, async save(value) { return { ok: true, value } }, async getById() { return { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }, async list() { return { ok: true, value: [] } }, async remove() { return { ok: true, value: undefined } } }
function associations(code?: CandidateApplicationAssociationRepositoryErrorCode): CandidateApplicationAssociationRepository {
  return { async create(value) { return { ok: true, value } }, async getByApplicationId() { return { ok: false, error: { code: code ?? "NOT_FOUND", message: "missing" } } }, async listByCandidateId() { return { ok: true, value: [] } }, async deleteByApplicationId() { return { ok: true, value: undefined } } }
}
const emptyFollowUps: CandidateFollowUpRepository = { async create(value) { return { ok: true, value } }, async getById() { return { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }, async listByCandidateId() { return { ok: true, value: [] } }, async save(value) { return { ok: true, value } } }
function operations(overrides: Partial<CoachOperationsRepository> = {}): CoachOperationsRepository {
  const note: CoachNote = { id: "note", candidateId: "candidate-a", text: "secret", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
  const goal: CoachGoal = { id: "goal", candidateId: "candidate-a", title: "Goal", status: "planned", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
  const activity: CoachActivity = { id: "activity", candidateId: "candidate-a", kind: "coachingMeeting", status: "planned", plannedAt: "2026-01-03T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
  return { async createNote(value) { return { ok: true, value } }, async getNoteById() { return { ok: true, value: note } }, async listNotesByCandidateId() { return overrides.listNotesByCandidateId ? overrides.listNotesByCandidateId("candidate-a") : { ok: true, value: [note] } }, async saveNote(value) { return { ok: true, value } }, async createGoal(value) { return { ok: true, value } }, async getGoalById() { return { ok: true, value: goal } }, async listGoalsByCandidateId() { return overrides.listGoalsByCandidateId ? overrides.listGoalsByCandidateId("candidate-a") : { ok: true, value: [goal] } }, async saveGoal(value) { return { ok: true, value } }, async createActivity(value) { return { ok: true, value } }, async getActivityById() { return { ok: true, value: activity } }, async listActivitiesByCandidateId() { return overrides.listActivitiesByCandidateId ? overrides.listActivitiesByCandidateId("candidate-a") : { ok: true, value: [activity] } }, async saveActivity(value) { return { ok: true, value } } }
}

describe("Phase 7.2 operational overview workflow", () => {
  it("composes candidate-scoped operations with the existing Phase 6 overview", async () => {
    const workflow = createCoachCandidateOperationalOverviewWorkflow(candidateRepository(candidate("candidate-a")), emptyApplications, associations(), emptyFollowUps, operations())
    const result = await workflow.getCandidateOperationalOverview("candidate-a", "2026-01-04T00:00:00.000Z")
    expect(result).toMatchObject({ ok: true, value: { candidate: { id: "candidate-a" }, notes: [{ id: "note" }], goals: [{ id: "goal", status: "planned" }], activities: [{ id: "activity" }], nextPlannedActivity: { id: "activity" } } })
    if (result.ok) expect(JSON.stringify(result.value)).not.toContain("secret")
  })

  it("propagates operations repository failures and rejects missing candidates", async () => {
    const failure: CoachOperationsRepository = operations({ listGoalsByCandidateId: async () => ({ ok: false, error: { code: "CORRUPT_STORAGE", message: "corrupt" } }) })
    const workflow = createCoachCandidateOperationalOverviewWorkflow(candidateRepository(candidate("candidate-a")), emptyApplications, associations(), emptyFollowUps, failure)
    expect(await workflow.getCandidateOperationalOverview("candidate-a", "2026-01-04T00:00:00.000Z")).toMatchObject({ ok: false, error: { kind: "operations_repository", error: { code: "CORRUPT_STORAGE" } } })
    expect(await workflow.getCandidateOperationalOverview("missing", "2026-01-04T00:00:00.000Z")).toMatchObject({ ok: false, error: { kind: "candidate_repository", error: { code: "NOT_FOUND" } } })
  })

  it("rejects cross-candidate linked activities and preserves association failures", async () => {
    const activity: CoachActivity = { id: "activity", candidateId: "candidate-a", kind: "coachingMeeting", status: "planned", applicationId: "application-1", plannedAt: "2026-01-03T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
    const crossCandidate = {
      ...associations(),
      async getByApplicationId() { return { ok: true as const, value: { candidateId: "candidate-b", applicationId: "application-1", createdAt: "2026-01-01T00:00:00.000Z" } } },
    }
    const workflow = createCoachCandidateOperationalOverviewWorkflow(candidateRepository(candidate("candidate-a")), { ...emptyApplications, async getById() { return { ok: true as const, value: {} as ApplicationRecord } } }, crossCandidate, emptyFollowUps, { ...operations(), async listActivitiesByCandidateId() { return { ok: true as const, value: [activity] } } })
    expect(await workflow.getCandidateOperationalOverview("candidate-a", "2026-01-04T00:00:00.000Z")).toMatchObject({ ok: false, error: { kind: "activity_application_mismatch" } })
    const validApplicationRepository: ApplicationRepository = { ...emptyApplications, async getById() { return { ok: true as const, value: {} as ApplicationRecord } } }
    const failing = createCoachCandidateOperationalOverviewWorkflow(candidateRepository(candidate("candidate-a")), validApplicationRepository, associations("CORRUPT_STORAGE"), emptyFollowUps, { ...operations(), async listActivitiesByCandidateId() { return { ok: true as const, value: [activity] } } })
    expect(await failing.getCandidateOperationalOverview("candidate-a", "2026-01-04T00:00:00.000Z")).toMatchObject({ ok: false, error: { kind: "association_repository", error: { code: "CORRUPT_STORAGE" } } })
  })
})