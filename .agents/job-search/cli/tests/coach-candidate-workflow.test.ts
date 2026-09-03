import { describe, expect, it } from "bun:test"
import { createCoachCandidateWorkflow } from "../src/index"
import type { CoachCandidate } from "../src/coach-workspace"
import type { CoachWorkspaceRepository } from "../src/coach-workspace-repository"

function repository(): CoachWorkspaceRepository {
  const values: CoachCandidate[] = []
  return {
    async createCandidate(value) { if (values.some((item) => item.id === value.id)) return { ok: false, error: { code: "DUPLICATE_ID", message: "duplicate" } }; values.push(structuredClone(value)); return { ok: true, value: structuredClone(value) } },
    async getCandidateById(id) { const value = values.find((item) => item.id === id); return value ? { ok: true, value: structuredClone(value) } : { ok: false, error: { code: "NOT_FOUND", message: "missing" } } },
    async listCandidates() { return { ok: true, value: structuredClone(values) } },
  }
}

describe("Phase 7.3 coach candidate workflow", () => {
  it("creates, lists, and gets detached candidates with authoritative errors", async () => {
    const workflow = createCoachCandidateWorkflow(repository())
    const input = { id: "candidate-a", displayName: "Alex", createdAt: "2026-01-01T00:00:00.000Z" }
    const created = await workflow.createCandidate(input)
    expect(created).toMatchObject({ ok: true, value: { id: "candidate-a", updatedAt: input.createdAt } })
    expect(await workflow.createCandidate(input)).toMatchObject({ ok: false, error: { kind: "candidate_repository", error: { code: "DUPLICATE_ID" } } })
    expect(await workflow.listCandidates()).toMatchObject({ ok: true, value: [{ id: "candidate-a" }] })
    const loaded = await workflow.getCandidate("candidate-a")
    expect(loaded).toMatchObject({ ok: true, value: { displayName: "Alex" } })
    expect(await workflow.getCandidate("missing")).toMatchObject({ ok: false, error: { kind: "candidate_repository", error: { code: "NOT_FOUND" } } })
    input.displayName = "changed"
    if (created.ok) expect(created.value.displayName).toBe("Alex")
  })
})