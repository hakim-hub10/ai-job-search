import { describe, expect, it } from "bun:test"
import {
  addApplicationNote,
  analyzeJobs,
  createApplication,
  findDuplicateApplications,
  normalizeCandidateProfile,
  normalizeJob,
  updateApplicationStatus,
  type ApplicationRecord,
  type NormalizedJob,
} from "../src/index"

const createdAt = "2026-09-01T10:00:00.000Z"
const appliedAt = "2026-09-02T10:00:00.000Z"
const notedAt = "2026-09-03T10:00:00.000Z"

function candidate() {
  return normalizeCandidateProfile({
    headline: "Operations coordinator",
    targetRoles: ["Operations Coordinator", "Nurse", "Retail Manager"],
    locationPreferences: ["Aarhus, Denmark"],
    workMode: "onsite",
    remotePreference: false,
    preferredEmploymentType: ["full-time"],
    skills: { technical: ["Inventory management", "Scheduling"], soft: ["Communication"] },
    yearsOfExperience: 3,
  })
}

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
    skills: ["Inventory management", "Scheduling"],
    ...overrides,
  })
}

function ranked(overrides: Partial<NormalizedJob> & Pick<NormalizedJob, "id" | "title">) {
  const result = analyzeJobs(candidate(), [job(overrides)])
  return result.rankedJobs[0]
}

function created(rankedJob = ranked({ id: "operations", title: "Operations Coordinator" }), id = "application-1"): ApplicationRecord {
  const result = createApplication({ id, rankedJob, createdAt })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

describe("application management foundation", () => {
  it("creates an application from a RankedJob with detached provenance and analysis snapshots", () => {
    const rankedJob = ranked({ id: "operations", title: "Operations Coordinator" })
    const record = created(rankedJob, "application-preserved")

    expect(record).toMatchObject({
      id: "application-preserved",
      status: "saved",
      createdAt,
      updatedAt: createdAt,
      jobSnapshot: {
        id: "operations",
        source: "jobindex",
        sourceId: "operations-source",
        title: "Operations Coordinator",
        company: "Example employer",
        location: "Aarhus, Denmark",
        url: "https://example.test/operations",
        applyUrl: "https://example.test/operations/apply",
      },
      analysisSnapshot: {
        rank: rankedJob.rank,
        explanation: rankedJob.explanation,
        matchingResult: rankedJob.matchingResult,
        scoringResult: rankedJob.scoringBreakdown,
        skillGapResult: rankedJob.skillGapResult,
      },
    })
    expect(record.analysisSnapshot.scoringResult.confidence).toBe(rankedJob.scoringBreakdown.confidence)
    expect(record.statusHistory).toEqual([{ status: "saved", timestamp: createdAt }])
    expect(record.notes).toEqual([])
    expect("candidateProfile" in record).toBe(false)

    rankedJob.job.title = "Changed after selection"
    rankedJob.scoringBreakdown.score = 0
    expect(record.jobSnapshot.title).toBe("Operations Coordinator")
    expect(record.analysisSnapshot.scoringResult.score).not.toBe(0)
  })

  it("updates status immutably with append-only history and explicit timestamps", () => {
    const original = created()
    const result = updateApplicationStatus(original, { status: "applied", timestamp: appliedAt, note: "Submitted" })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)

    expect(original).toMatchObject({ status: "saved", updatedAt: createdAt })
    expect(original.statusHistory).toEqual([{ status: "saved", timestamp: createdAt }])
    expect(result.value).toMatchObject({ status: "applied", updatedAt: appliedAt, jobSnapshot: original.jobSnapshot, analysisSnapshot: original.analysisSnapshot })
    expect(result.value.statusHistory).toEqual([
      { status: "saved", timestamp: createdAt },
      { status: "applied", timestamp: appliedAt, note: "Submitted" },
    ])
  })

  it("handles optional notes immutably and validates note content and chronology", () => {
    const original = created()
    const noted = addApplicationNote(original, { text: "Follow up next week", createdAt: notedAt })
    expect(noted.ok).toBe(true)
    if (!noted.ok) throw new Error(noted.error.message)
    expect(original.notes).toEqual([])
    expect(noted.value).toMatchObject({ notes: [{ text: "Follow up next week", createdAt: notedAt }], updatedAt: notedAt })

    const withInitialNote = createApplication({
      id: "with-note",
      rankedJob: ranked({ id: "nurse", title: "Nurse" }),
      createdAt,
      initialNote: { text: "Contact preference confirmed", createdAt },
    })
    expect(withInitialNote.ok && withInitialNote.value.notes).toEqual([{ text: "Contact preference confirmed", createdAt }])
    expect(addApplicationNote(original, { text: "  ", createdAt: notedAt })).toMatchObject({ ok: false, error: { code: "EMPTY_NOTE" } })
    expect(addApplicationNote(original, { text: "Too early", createdAt: "2026-08-31T10:00:00.000Z" })).toMatchObject({ ok: false, error: { code: "TIMESTAMP_OUT_OF_ORDER" } })
  })

  it("validates application identity, statuses, timestamps, and malformed creation input", () => {
    const rankedJob = ranked({ id: "invalid", title: "Operations Coordinator" })
    expect(createApplication({ id: " ", rankedJob, createdAt })).toMatchObject({ ok: false, error: { code: "INVALID_APPLICATION_ID" } })
    expect(createApplication({ id: "bad-status", rankedJob, createdAt, initialStatus: "hired" as never })).toMatchObject({ ok: false, error: { code: "INVALID_APPLICATION_STATUS" } })
    expect(createApplication({ id: "bad-time", rankedJob, createdAt: "not-a-timestamp" })).toMatchObject({ ok: false, error: { code: "INVALID_TIMESTAMP" } })
    expect(createApplication({ id: "bad-ranked", rankedJob: {} as never, createdAt })).toMatchObject({ ok: false, error: { code: "MALFORMED_APPLICATION_INPUT" } })
    expect(updateApplicationStatus(created(), { status: "interview", timestamp: "2026-08-31T10:00:00.000Z" })).toMatchObject({ ok: false, error: { code: "TIMESTAMP_OUT_OF_ORDER" } })
  })

  it("provides conservative duplicate advisory without preventing intentional repeat applications", () => {
    const originalJob = ranked({ id: "same-job", title: "Operations Coordinator" })
    const sameSource = created(originalJob, "first")
    const sameJobAgain = ranked({ id: "same-job", title: "Operations Coordinator" })
    const crossSourceSameId = ranked({ id: "same-job", title: "Operations Coordinator", source: "linkedin", sourceId: "different-source-id" })
    const distinct = ranked({ id: "other-job", title: "Retail Manager", source: "retail", sourceId: "other-source-id" })

    expect(findDuplicateApplications([sameSource], sameJobAgain)).toEqual([
      { applicationId: "first", reasons: ["same_source_and_source_id", "same_normalized_job_id"] },
    ])
    expect(findDuplicateApplications([sameSource], crossSourceSameId)).toEqual([
      { applicationId: "first", reasons: ["same_normalized_job_id"] },
    ])
    expect(findDuplicateApplications([sameSource], distinct)).toEqual([])
    expect(createApplication({ id: "intentional-repeat", rankedJob: sameJobAgain, createdAt }).ok).toBe(true)
  })

  it("supports sparse jobs, optional URLs, cross-domain jobs, and repeated explicit creation deterministically", () => {
    const sparse = ranked({
      id: "sparse",
      title: "Administrative Assistant",
      source: "administration",
      sourceId: null,
      company: null,
      location: null,
      url: null,
      applyUrl: null,
      description: null,
      skills: [],
      remote: null,
      employmentType: null,
      seniority: null,
    })
    const healthcare = ranked({ id: "healthcare", title: "Nurse", source: "healthcare", skills: ["Patient care"] })
    const logistics = ranked({ id: "logistics", title: "Logistics Coordinator", source: "logistics", skills: ["Route planning"] })
    const first = createApplication({ id: "same-input", rankedJob: sparse, createdAt })
    const second = createApplication({ id: "same-input", rankedJob: sparse, createdAt })

    expect(first).toEqual(second)
    expect(first.ok && first.value.jobSnapshot).toMatchObject({ id: "sparse", url: null, applyUrl: null, company: null, location: null })
    expect(createApplication({ id: "healthcare", rankedJob: healthcare, createdAt }).ok).toBe(true)
    expect(createApplication({ id: "logistics", rankedJob: logistics, createdAt }).ok).toBe(true)
  })
})
