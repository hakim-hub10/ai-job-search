import { describe, expect, it } from "bun:test"
import type { ApplicationRepository } from "../src/application-repository"
import type { ApplicationRecord } from "../src/applications"
import type { CandidateApplicationAssociation } from "../src/coach-application-association"
import type { CandidateApplicationAssociationRepository } from "../src/coach-application-association-repository"
import { createCoachApplicationWorkflow } from "../src/coach-application-workflow"
import { createCoachCandidate, type CoachCandidate } from "../src/coach-workspace"
import type { CoachWorkspaceRepository } from "../src/coach-workspace-repository"

function candidate(id: string): CoachCandidate {
  const result = createCoachCandidate({ id, displayName: `${id} display`, createdAt: "2026-01-01T00:00:00.000Z" })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function application(id: string, status = "saved", notes: unknown[] = []): ApplicationRecord {
  return { id, status, notes, marker: `authoritative-${id}` } as unknown as ApplicationRecord
}

function candidateRepository(initial: CoachCandidate[]): CoachWorkspaceRepository {
  const values = structuredClone(initial)
  return {
    async createCandidate(value) { values.push(structuredClone(value)); return { ok: true, value: structuredClone(value) } },
    async getCandidateById(id) {
      const value = values.find((item) => item.id === id)
      return value
        ? { ok: true, value: structuredClone(value) }
        : { ok: false, error: { code: "NOT_FOUND", message: "Coach candidate record was not found." } }
    },
    async listCandidates() { return { ok: true, value: structuredClone(values) } },
  }
}

function applicationRepository(initial: ApplicationRecord[]): ApplicationRepository {
  const values = structuredClone(initial)
  return {
    async create(value) { values.push(structuredClone(value)); return { ok: true, value: structuredClone(value) } },
    async save(value) {
      const index = values.findIndex((item) => item.id === value.id)
      if (index < 0) return { ok: false, error: { code: "NOT_FOUND", message: "Application record was not found." } }
      values[index] = structuredClone(value)
      return { ok: true, value: structuredClone(value) }
    },
    async getById(id) {
      const value = values.find((item) => item.id === id)
      return value
        ? { ok: true, value: structuredClone(value) }
        : { ok: false, error: { code: "NOT_FOUND", message: "Application record was not found." } }
    },
    async list() { return { ok: true, value: structuredClone(values) } },
    async remove(id) {
      const index = values.findIndex((item) => item.id === id)
      if (index < 0) return { ok: false, error: { code: "NOT_FOUND", message: "Application record was not found." } }
      values.splice(index, 1)
      return { ok: true, value: undefined }
    },
  }
}

function associationRepository(initial: CandidateApplicationAssociation[] = []): CandidateApplicationAssociationRepository {
  const values = structuredClone(initial)
  return {
    async create(value) {
      if (values.some((item) => item.applicationId === value.applicationId)) {
        return { ok: false, error: { code: "DUPLICATE_ASSOCIATION", message: "This application already has a candidate association." } }
      }
      values.push(structuredClone(value))
      return { ok: true, value: structuredClone(value) }
    },
    async getByApplicationId(id) {
      const value = values.find((item) => item.applicationId === id)
      return value
        ? { ok: true, value: structuredClone(value) }
        : { ok: false, error: { code: "NOT_FOUND", message: "Candidate application association was not found." } }
    },
    async listByCandidateId(id) {
      return { ok: true, value: structuredClone(values.filter((item) => item.candidateId === id)) }
    },
    async deleteByApplicationId(applicationId) {
      const index = values.findIndex((item) => item.applicationId === applicationId)
      if (index >= 0) values.splice(index, 1)
      return { ok: true, value: undefined }
    },
  }
}

const createdAt = "2026-02-01T00:00:00.000Z"

describe("Phase 6.2 coach application workflow", () => {
  it("associates an existing candidate and application without mutating either authority", async () => {
    const candidateValue = candidate("candidate-a")
    const applicationValue = application("application-1", "interview", [{ text: "private" }])
    const candidateBefore = structuredClone(candidateValue)
    const applicationBefore = structuredClone(applicationValue)
    const workflow = createCoachApplicationWorkflow(
      candidateRepository([candidateValue]),
      applicationRepository([applicationValue]),
      associationRepository(),
    )
    expect(await workflow.associateApplication({ candidateId: candidateValue.id, applicationId: applicationValue.id, createdAt }))
      .toEqual({ ok: true, value: { candidateId: "candidate-a", applicationId: "application-1", createdAt } })
    expect(candidateValue).toEqual(candidateBefore)
    expect(applicationValue).toEqual(applicationBefore)
  })

  it("rejects missing candidate and application references before persistence", async () => {
    const associations = associationRepository()
    const workflow = createCoachApplicationWorkflow(candidateRepository([candidate("candidate-a")]), applicationRepository([application("application-1")]), associations)
    expect(await workflow.associateApplication({ candidateId: "missing", applicationId: "application-1", createdAt }))
      .toMatchObject({ ok: false, error: { kind: "candidate_repository", error: { code: "NOT_FOUND" } } })
    expect(await workflow.associateApplication({ candidateId: "candidate-a", applicationId: "missing", createdAt }))
      .toMatchObject({ ok: false, error: { kind: "application_repository", error: { code: "NOT_FOUND" } } })
    expect(await associations.listByCandidateId("candidate-a")).toEqual({ ok: true, value: [] })
  })

  it("distinguishes exact duplicates from attempted cross-candidate reassignment", async () => {
    const existing = { candidateId: "candidate-a", applicationId: "application-1", createdAt }
    const workflow = createCoachApplicationWorkflow(
      candidateRepository([candidate("candidate-a"), candidate("candidate-b")]),
      applicationRepository([application("application-1")]),
      associationRepository([existing]),
    )
    expect(await workflow.associateApplication(existing)).toMatchObject({
      ok: false,
      error: { kind: "ownership_conflict", error: { code: "ALREADY_ASSOCIATED_WITH_CANDIDATE" } },
    })
    expect(await workflow.associateApplication({ ...existing, candidateId: "candidate-b" })).toMatchObject({
      ok: false,
      error: { kind: "ownership_conflict", error: { code: "ASSOCIATED_WITH_ANOTHER_CANDIDATE" } },
    })
  })

  it("lists authoritative applications for one candidate without leaking another candidate's records", async () => {
    const application1 = application("application-1", "applied")
    const application2 = application("application-2", "offer")
    const application3 = application("application-3", "rejected")
    const workflow = createCoachApplicationWorkflow(
      candidateRepository([candidate("candidate-a"), candidate("candidate-b"), candidate("candidate-c")]),
      applicationRepository([application1, application2, application3]),
      associationRepository([
        { candidateId: "candidate-a", applicationId: "application-1", createdAt: "2026-01-01T00:00:00.000Z" },
        { candidateId: "candidate-a", applicationId: "application-2", createdAt: "2026-02-01T00:00:00.000Z" },
        { candidateId: "candidate-b", applicationId: "application-3", createdAt: "2026-03-01T00:00:00.000Z" },
      ]),
    )
    expect(await workflow.listCandidateApplications("candidate-a")).toEqual({ ok: true, value: [application1, application2] })
    expect(await workflow.listCandidateApplications("candidate-b")).toEqual({ ok: true, value: [application3] })
    expect(await workflow.listCandidateApplications("candidate-c")).toEqual({ ok: true, value: [] })
  })

  it("resolves ownership while failing explicitly for orphaned references and invalid lookup IDs", async () => {
    const association = { candidateId: "candidate-a", applicationId: "application-1", createdAt }
    const candidates = candidateRepository([candidate("candidate-a")])
    const associations = associationRepository([association])
    const workflow = createCoachApplicationWorkflow(candidates, applicationRepository([application("application-1")]), associations)
    expect(await workflow.getApplicationCandidate("application-1")).toMatchObject({ ok: true, value: { id: "candidate-a" } })
    expect(await workflow.getApplicationCandidate(" ")).toMatchObject({ ok: false, error: { kind: "association_domain", error: { code: "INVALID_APPLICATION_ID" } } })

    const orphaned = createCoachApplicationWorkflow(candidates, applicationRepository([]), associations)
    expect(await orphaned.getApplicationCandidate("application-1"))
      .toMatchObject({ ok: false, error: { kind: "application_repository", error: { code: "NOT_FOUND" } } })
    expect(await orphaned.listCandidateApplications("candidate-a"))
      .toMatchObject({ ok: false, error: { kind: "application_repository", error: { code: "NOT_FOUND" } } })
  })
})
