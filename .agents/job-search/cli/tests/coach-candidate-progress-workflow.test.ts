import { describe, expect, it } from "bun:test"
import type { ApplicationRepository } from "../src/application-repository"
import type { ApplicationRecord } from "../src/applications"
import type { CandidateApplicationAssociation } from "../src/coach-application-association"
import type { CandidateApplicationAssociationRepository } from "../src/coach-application-association-repository"
import { createCoachCandidateProgressWorkflow } from "../src/index"
import { createCoachCandidate, type CoachCandidate } from "../src/coach-workspace"
import type { CoachWorkspaceRepository } from "../src/coach-workspace-repository"
import type { CandidateFollowUp } from "../src/coach-candidate-follow-up"
import type { CandidateFollowUpRepository } from "../src/coach-candidate-follow-up-repository"

function candidate(id: string): CoachCandidate {
  const result = createCoachCandidate({ id, displayName: id, createdAt: "2026-01-01T00:00:00.000Z" })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function application(id: string, status = "applied"): ApplicationRecord {
  return { id, status, statusHistory: [{ status, timestamp: "2026-01-02T00:00:00.000Z" }], notes: [] } as unknown as ApplicationRecord
}

function candidateRepository(values: CoachCandidate[]): CoachWorkspaceRepository {
  return { async createCandidate(value) { return { ok: true, value } }, async getCandidateById(id) { const value = values.find((item) => item.id === id); return value ? { ok: true, value: structuredClone(value) } : { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }, async listCandidates() { return { ok: true, value: structuredClone(values) } } }
}

function applicationRepository(values: ApplicationRecord[]): ApplicationRepository {
  return { async create(value) { return { ok: true, value } }, async save(value) { return { ok: true, value } }, async getById(id) { const value = values.find((item) => item.id === id); return value ? { ok: true, value: structuredClone(value) } : { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }, async list() { return { ok: true, value: structuredClone(values) } } }
}

function associationRepository(values: CandidateApplicationAssociation[]): CandidateApplicationAssociationRepository {
  return { async create(value) { values.push(structuredClone(value)); return { ok: true, value: structuredClone(value) } }, async getByApplicationId(id) { const value = values.find((item) => item.applicationId === id); return value ? { ok: true, value: structuredClone(value) } : { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }, async listByCandidateId(id) { return { ok: true, value: structuredClone(values.filter((item) => item.candidateId === id)) } } }
}

function followUpRepository(values: CandidateFollowUp[] = []): CandidateFollowUpRepository {
  return { async create(value) { values.push(structuredClone(value)); return { ok: true, value: structuredClone(value) } }, async getById(id) { const value = values.find((item) => item.id === id); return value ? { ok: true, value: structuredClone(value) } : { ok: false, error: { code: "NOT_FOUND", message: "missing" } } }, async listByCandidateId(id) { return { ok: true, value: structuredClone(values.filter((item) => item.candidateId === id)) } }, async save(value) { const index = values.findIndex((item) => item.id === value.id); if (index < 0) return { ok: false, error: { code: "NOT_FOUND", message: "missing" } }; values[index] = structuredClone(value); return { ok: true, value: structuredClone(value) } } }
}

describe("Phase 6.3 candidate progress workflow", () => {
  it("derives progress from authoritative applications and keeps candidate data isolated", async () => {
    const workflow = createCoachCandidateProgressWorkflow(
      candidateRepository([candidate("candidate-a"), candidate("candidate-b")]),
      applicationRepository([application("application-a", "interview"), application("application-b", "offer")]),
      associationRepository([{ candidateId: "candidate-a", applicationId: "application-a", createdAt: "2026-01-01T00:00:00.000Z" }, { candidateId: "candidate-b", applicationId: "application-b", createdAt: "2026-01-01T00:00:00.000Z" }]),
      followUpRepository(),
    )
    const result = await workflow.getCandidateProgress("candidate-a", "2026-01-03T00:00:00.000Z")
    expect(result).toMatchObject({ ok: true, value: { candidateId: "candidate-a", applicationCount: 1, statusCounts: { interview: 1, offer: 0 } } })
    expect(await workflow.getCandidateProgress("candidate-b", "2026-01-03T00:00:00.000Z")).toMatchObject({ ok: true, value: { applicationCount: 1, statusCounts: { interview: 0, offer: 1 } } })
  })

  it("requires an existing association for application-specific follow-ups", async () => {
    const workflow = createCoachCandidateProgressWorkflow(candidateRepository([candidate("candidate-a"), candidate("candidate-b")]), applicationRepository([application("application-a")]), associationRepository([{ candidateId: "candidate-a", applicationId: "application-a", createdAt: "2026-01-01T00:00:00.000Z" }]), followUpRepository())
    const input = { id: "follow-up-1", candidateId: "candidate-a", applicationId: "application-a", dueAt: "2026-01-03T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
    expect(await workflow.createCandidateFollowUp(input)).toMatchObject({ ok: true, value: { applicationId: "application-a" } })
    expect(await workflow.createCandidateFollowUp({ ...input, id: "cross", candidateId: "candidate-b" })).toMatchObject({ ok: false, error: { kind: "application_candidate_mismatch" } })
  })
})