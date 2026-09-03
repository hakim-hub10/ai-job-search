import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  analyzeJobs,
  createApplication,
  createCandidateApplicationAssociation,
  createCandidateFollowUp,
  createCoachActivity,
  createCoachCandidate,
  createCoachCandidateOperationalOverviewWorkflow,
  createCoachCandidateProgressWorkflow,
  createCoachGoal,
  createCoachNote,
  createCoachOperationsWorkflow,
  createFileApplicationRepository,
  createFileCandidateApplicationAssociationRepository,
  createFileCandidateFollowUpRepository,
  createFileCoachOperationsRepository,
  createFileCoachWorkspaceRepository,
  normalizeCandidateProfile,
  normalizeJob,
} from "../src/index"
import type { NormalizedJob } from "../src/types"

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

function job(overrides: Partial<NormalizedJob> & Pick<NormalizedJob, "id" | "title">): NormalizedJob {
  return normalizeJob({ id: overrides.id, title: overrides.title, source: "fixture", sourceId: `${overrides.id}-source`, company: "Example", location: "Malmö", url: null, applyUrl: null, remote: "onsite", employmentType: "full-time", seniority: null, skills: ["Scheduling"], description: "Coordinate schedules." })
}

describe("Phase 7 synthetic acceptance", () => {
  it("completes the offline coach journey through persisted repositories", async () => {
    const root = await mkdtemp(join(tmpdir(), "coach-phase7-")); directories.push(root)
    const paths = { candidates: join(root, "candidates.json"), associations: join(root, "associations.json"), followUps: join(root, "follow-ups.json"), operations: join(root, "operations.json"), applications: join(root, "applications.json") }
    const candidates = createFileCoachWorkspaceRepository(paths.candidates)
    const associations = createFileCandidateApplicationAssociationRepository(paths.associations)
    const followUps = createFileCandidateFollowUpRepository(paths.followUps)
    const operations = createFileCoachOperationsRepository(paths.operations)
    const applications = createFileApplicationRepository(paths.applications)
    const createdCandidate = createCoachCandidate({ id: "candidate-a", displayName: "Alex", createdAt: "2026-01-01T00:00:00.000Z" })
    if (!createdCandidate.ok) throw new Error(createdCandidate.error.message)
    expect((await candidates.createCandidate(createdCandidate.value)).ok).toBe(true)
    const profile = normalizeCandidateProfile({ headline: "Coordinator", targetRoles: ["Coordinator"], locationPreferences: ["Malmö"], workMode: "onsite", remotePreference: false, preferredEmploymentType: ["full-time"], skills: { technical: ["Scheduling"], soft: ["Communication"] }, yearsOfExperience: 2 })
    const application = createApplication({ id: "application-1", rankedJob: analyzeJobs(profile, [job({ id: "job-1", title: "Coordinator" })]).rankedJobs[0], createdAt: "2026-01-01T00:00:00.000Z" })
    if (!application.ok) throw new Error(application.error.message)
    expect((await applications.create(application.value)).ok).toBe(true)
    const association = createCandidateApplicationAssociation({ candidateId: "candidate-a", applicationId: "application-1", createdAt: "2026-01-01T00:00:00.000Z" })
    if (!association.ok) throw new Error(association.error.message)
    expect((await associations.create(association.value)).ok).toBe(true)

    const progress = createCoachCandidateProgressWorkflow(candidates, applications, associations, followUps)
    const followUp = createCandidateFollowUp({ id: "follow-up-1", candidateId: "candidate-a", applicationId: "application-1", dueAt: "2026-01-03T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" })
    if (!followUp.ok) throw new Error(followUp.error.message)
    expect((await progress.createCandidateFollowUp(followUp.value)).ok).toBe(true)
    const operationsWorkflow = createCoachOperationsWorkflow(candidates, operations, applications, associations)
    const note = createCoachNote({ id: "note-1", candidateId: "candidate-a", text: "Private coach note", createdAt: "2026-01-01T00:00:00.000Z" })
    if (!note.ok) throw new Error(note.error.message)
    expect((await operationsWorkflow.createNote(note.value)).ok).toBe(true)
    const goal = createCoachGoal({ id: "goal-1", candidateId: "candidate-a", title: "Apply to relevant jobs", createdAt: "2026-01-01T00:00:00.000Z" })
    if (!goal.ok) throw new Error(goal.error.message)
    expect((await operationsWorkflow.createGoal(goal.value)).ok).toBe(true)
    const activity = createCoachActivity({ id: "activity-1", candidateId: "candidate-a", kind: "applyForJob", applicationId: "application-1", createdAt: "2026-01-01T00:00:00.000Z" })
    if (!activity.ok) throw new Error(activity.error.message)
    expect((await operationsWorkflow.createActivity(activity.value)).ok).toBe(true)
    expect((await operationsWorkflow.transitionGoal("goal-1", "candidate-a", { status: "completed", updatedAt: "2026-01-02T00:00:00.000Z" })).ok).toBe(true)
    expect((await operationsWorkflow.transitionActivity("activity-1", "candidate-a", { status: "completed", updatedAt: "2026-01-02T00:00:00.000Z" })).ok).toBe(true)
    expect((await progress.completeCandidateFollowUp({ candidateId: "candidate-a", followUpId: "follow-up-1", completedAt: "2026-01-02T00:00:00.000Z" })).ok).toBe(true)

    const reloadedCandidates = createFileCoachWorkspaceRepository(paths.candidates)
    const reloadedAssociations = createFileCandidateApplicationAssociationRepository(paths.associations)
    const reloadedFollowUps = createFileCandidateFollowUpRepository(paths.followUps)
    const reloadedOperations = createFileCoachOperationsRepository(paths.operations)
    const reloadedApplications = createFileApplicationRepository(paths.applications)
    const overview = createCoachCandidateOperationalOverviewWorkflow(reloadedCandidates, reloadedApplications, reloadedAssociations, reloadedFollowUps, reloadedOperations)
    const result = await overview.getCandidateOperationalOverview("candidate-a", "2026-01-04T00:00:00.000Z")
    expect(result).toMatchObject({ ok: true, value: { overview: { applications: [{ applicationId: "application-1" }], followUps: [{ id: "follow-up-1", state: "completed" }] }, goals: [{ id: "goal-1", status: "completed" }], activities: [{ id: "activity-1", status: "completed" }], nextPlannedActivity: null } })
    if (result.ok) expect(JSON.stringify(result.value)).not.toContain("Private coach note")
    expect(await readFile(paths.associations, "utf8")).not.toContain("status")
    expect(await readFile(paths.operations, "utf8")).not.toContain("statusHistory")
    expect(await readFile(paths.operations, "utf8")).not.toContain("applicationNotes")
  })
})