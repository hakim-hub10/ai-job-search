import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  analyzeJobs,
  createApplication,
  createCandidateApplicationAssociation,
  createCandidateFollowUp,
  createCoachCandidate,
  createCoachCandidateOverviewWorkflow,
  createFileApplicationRepository,
  createFileCandidateApplicationAssociationRepository,
  createFileCandidateFollowUpRepository,
  createFileCoachWorkspaceRepository,
  normalizeCandidateProfile,
  normalizeJob,
  updateApplicationStatus,
} from "../src/index"
import type { NormalizedJob } from "../src/types"

const directories: string[] = []
const createdAt = "2026-01-01T00:00:00.000Z"
const appliedAt = "2026-01-02T00:00:00.000Z"
const dueAt = "2026-01-03T00:00:00.000Z"

afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

function job(overrides: Partial<NormalizedJob> & Pick<NormalizedJob, "id" | "title">): NormalizedJob {
  return normalizeJob({
    source: "jobindex",
    sourceId: `${overrides.id}-source`,
    company: "Example employer",
    location: "Aarhus, Denmark",
    url: `https://example.test/${overrides.id}`,
    applyUrl: `https://example.test/${overrides.id}/apply`,
    remote: "onsite",
    employmentType: "full-time",
    seniority: "mid",
    description: "Communication is important.",
    skills: ["Scheduling"],
    ...overrides,
  })
}

describe("Phase 6 stabilization file-repository integration", () => {
  it("persists, reloads, and composes authoritative application and follow-up state", async () => {
    const root = await mkdtemp(join(tmpdir(), "coach-overview-integration-"))
    directories.push(root)
    const paths = {
      candidates: join(root, "coach", "candidates.json"),
      associations: join(root, "coach", "associations.json"),
      applications: join(root, "applications", "applications.json"),
      followUps: join(root, "coach", "follow-ups.json"),
    }
    const candidateRepository = createFileCoachWorkspaceRepository(paths.candidates)
    const associationRepository = createFileCandidateApplicationAssociationRepository(paths.associations)
    const applicationRepository = createFileApplicationRepository(paths.applications)
    const followUpRepository = createFileCandidateFollowUpRepository(paths.followUps)

    const candidateResult = createCoachCandidate({ id: "candidate-a", displayName: "Alex", createdAt })
    if (!candidateResult.ok) throw new Error(candidateResult.error.message)
    expect((await candidateRepository.createCandidate(candidateResult.value)).ok).toBe(true)

    const profile = normalizeCandidateProfile({
      headline: "Operations coordinator",
      targetRoles: ["Operations Coordinator"],
      locationPreferences: ["Aarhus, Denmark"],
      workMode: "onsite",
      remotePreference: false,
      preferredEmploymentType: ["full-time"],
      skills: { technical: ["Scheduling"], soft: ["Communication"] },
      yearsOfExperience: 3,
    })
    const rankedJob = analyzeJobs(profile, [job({ id: "operations", title: "Operations Coordinator" })]).rankedJobs[0]
    const applicationResult = createApplication({ id: "application-1", rankedJob, createdAt, initialNote: { text: "Authoritative application note", createdAt } })
    if (!applicationResult.ok) throw new Error(applicationResult.error.message)
    expect((await applicationRepository.create(applicationResult.value)).ok).toBe(true)

    const associationResult = createCandidateApplicationAssociation({ candidateId: "candidate-a", applicationId: "application-1", createdAt })
    if (!associationResult.ok) throw new Error(associationResult.error.message)
    expect((await associationRepository.create(associationResult.value)).ok).toBe(true)

    const followUpResult = createCandidateFollowUp({ id: "follow-up-1", candidateId: "candidate-a", applicationId: "application-1", dueAt, createdAt, updatedAt: createdAt })
    if (!followUpResult.ok) throw new Error(followUpResult.error.message)
    expect((await followUpRepository.create(followUpResult.value)).ok).toBe(true)

    const reloadedCandidates = createFileCoachWorkspaceRepository(paths.candidates)
    const reloadedAssociations = createFileCandidateApplicationAssociationRepository(paths.associations)
    const reloadedApplications = createFileApplicationRepository(paths.applications)
    const reloadedFollowUps = createFileCandidateFollowUpRepository(paths.followUps)
    const loadedApplication = await reloadedApplications.getById("application-1")
    if (!loadedApplication.ok) throw new Error(loadedApplication.error.message)
    const updated = updateApplicationStatus(loadedApplication.value, { status: "applied", timestamp: appliedAt })
    if (!updated.ok) throw new Error(updated.error.message)
    expect((await reloadedApplications.save(updated.value)).ok).toBe(true)

    const workflow = createCoachCandidateOverviewWorkflow(reloadedCandidates, reloadedApplications, reloadedAssociations, reloadedFollowUps)
    const result = await workflow.getCandidateOverview("candidate-a", "2026-01-04T00:00:00.000Z")
    expect(result).toMatchObject({
      ok: true,
      value: {
        applications: [{ applicationId: "application-1", status: "applied" }],
        progress: { applicationCount: 1, statusCounts: { applied: 1, saved: 0 } },
        followUps: [{ id: "follow-up-1", state: "overdue" }],
        overdueFollowUps: [{ id: "follow-up-1", state: "overdue" }],
        nextFollowUp: { id: "follow-up-1", state: "overdue" },
      },
    })
    expect(JSON.stringify(result)).not.toContain("Authoritative application note")
    expect(await readFile(paths.candidates, "utf8")).not.toContain("applications")
    expect(await readFile(paths.associations, "utf8")).not.toContain("status")
    expect(await readFile(paths.followUps, "utf8")).not.toContain("statusHistory")
    expect(await readFile(paths.followUps, "utf8")).not.toContain("progress")
  })
})