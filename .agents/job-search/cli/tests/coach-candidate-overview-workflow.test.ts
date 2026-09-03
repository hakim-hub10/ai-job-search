import { describe, expect, it } from "bun:test"
import type { ApplicationRepository } from "../src/application-repository"
import type { ApplicationRecord } from "../src/applications"
import type { CandidateApplicationAssociation } from "../src/coach-application-association"
import type { CandidateApplicationAssociationRepository } from "../src/coach-application-association-repository"
import type { CandidateFollowUp } from "../src/coach-candidate-follow-up"
import type { CandidateFollowUpRepository } from "../src/coach-candidate-follow-up-repository"
import { createCoachCandidateOverviewWorkflow } from "../src/index"
import type { CoachCandidate } from "../src/coach-workspace"
import type { CoachWorkspaceRepository } from "../src/coach-workspace-repository"

const candidate = (id: string): CoachCandidate => ({ id, displayName: id, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" })
const application = (id: string, status = "applied"): ApplicationRecord => ({ id, status, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", statusHistory: [{ status, timestamp: "2026-01-02T00:00:00.000Z" }], notes: [] } as unknown as ApplicationRecord)

function candidates(values: CoachCandidate[]): CoachWorkspaceRepository {
  return { async createCandidate(value) { return { ok: true, value } }, async getCandidateById(id) { const value = values.find((item) => item.id === id); return value ? { ok: true, value: structuredClone(value) } : { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }, async listCandidates() { return { ok: true, value: structuredClone(values) } } }
}

function applications(values: ApplicationRecord[]): ApplicationRepository {
  return { async create(value) { return { ok: true, value } }, async save(value) { return { ok: true, value } }, async getById(id) { const value = values.find((item) => item.id === id); return value ? { ok: true, value: structuredClone(value) } : { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }, async list() { return { ok: true, value: structuredClone(values) } } }
}

function associations(values: CandidateApplicationAssociation[]): CandidateApplicationAssociationRepository {
  return { async create(value) { return { ok: true, value } }, async getByApplicationId(id) { const value = values.find((item) => item.applicationId === id); return value ? { ok: true, value: structuredClone(value) } : { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }, async listByCandidateId(id) { return { ok: true, value: structuredClone(values.filter((item) => item.candidateId === id)) } } }
}

function followUps(values: CandidateFollowUp[]): CandidateFollowUpRepository {
  return { async create(value) { return { ok: true, value } }, async getById(id) { const value = values.find((item) => item.id === id); return value ? { ok: true, value: structuredClone(value) } : { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }, async listByCandidateId(id) { return { ok: true, value: structuredClone(values.filter((item) => item.candidateId === id)) } }, async save(value) { return { ok: true, value } } }
}

describe("Phase 6.4 candidate overview workflow", () => {
  it("composes authoritative repositories without cross-candidate leakage", async () => {
    const workflow = createCoachCandidateOverviewWorkflow(
      candidates([candidate("candidate-a"), candidate("candidate-b")]),
      applications([application("application-a", "interview"), application("application-b", "offer")]),
      associations([{ candidateId: "candidate-a", applicationId: "application-a", createdAt: "2026-01-01T00:00:00.000Z" }, { candidateId: "candidate-b", applicationId: "application-b", createdAt: "2026-01-01T00:00:00.000Z" }]),
      followUps([]),
    )
    expect(await workflow.getCandidateOverview("candidate-a", "2026-01-03T00:00:00.000Z")).toMatchObject({ ok: true, value: { candidate: { id: "candidate-a" }, applications: [{ applicationId: "application-a", status: "interview" }] } })
    expect(await workflow.getCandidateOverview("candidate-b", "2026-01-03T00:00:00.000Z")).toMatchObject({ ok: true, value: { applications: [{ applicationId: "application-b", status: "offer" }] } })
  })

  it("fails explicitly for orphaned associations and mismatched application follow-ups", async () => {
    const orphaned = createCoachCandidateOverviewWorkflow(candidates([candidate("candidate-a")]), applications([]), associations([{ candidateId: "candidate-a", applicationId: "missing", createdAt: "2026-01-01T00:00:00.000Z" }]), followUps([]))
    expect(await orphaned.getCandidateOverview("candidate-a", "2026-01-03T00:00:00.000Z")).toMatchObject({ ok: false, error: { kind: "orphaned_application_reference", applicationId: "missing" } })

    const mismatched = createCoachCandidateOverviewWorkflow(candidates([candidate("candidate-a"), candidate("candidate-b")]), applications([application("application-a")]), associations([{ candidateId: "candidate-b", applicationId: "application-a", createdAt: "2026-01-01T00:00:00.000Z" }]), followUps([{ id: "follow-up", candidateId: "candidate-a", applicationId: "application-a", dueAt: "2026-01-03T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]))
    expect(await mismatched.getCandidateOverview("candidate-a", "2026-01-03T00:00:00.000Z")).toMatchObject({ ok: false, error: { kind: "follow_up_application_mismatch", applicationId: "application-a" } })
  })
})