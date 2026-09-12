import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  analyzeJobs,
  buildApplicationDocumentFoundation,
  createApplication,
  createFileApplicationDocumentRepository,
  createFileApplicationRepository,
  createFileCandidateApplicationAssociationRepository,
  createFileInterviewPreparationRepository,
  createFileInterviewSessionPreparationLinkRepository,
  createFileInterviewSessionRepository,
  createCandidateApplicationAssociation,
  createInterviewPreparationPlan,
  deleteApplicationAndOwnedData,
  findDuplicateApplications,
  normalizeCandidateProfile,
  normalizeJob,
  startInterviewSession,
  type ApplicationDeletionDependencies,
  type ApplicationRecord,
  type CandidateDocumentEvidence,
  type GeneratedApplicationDocument,
  type GeneratedDocumentRenderResult,
} from "../src/index"

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

async function dependencies(): Promise<ApplicationDeletionDependencies> {
  const directory = await mkdtemp(join(tmpdir(), "ai-job-search-application-deletion-"))
  directories.push(directory)
  const sessionRepository = createFileInterviewSessionRepository(join(directory, "sessions.json"))
  const preparationRepository = createFileInterviewPreparationRepository(join(directory, "preparations.json"))
  return {
    applicationRepository: createFileApplicationRepository(join(directory, "applications.json")),
    associationRepository: createFileCandidateApplicationAssociationRepository(join(directory, "associations.json")),
    documentRepository: createFileApplicationDocumentRepository(join(directory, "documents.json")),
    sessionRepository,
    preparationRepository,
    sessionPreparationLinkRepository: createFileInterviewSessionPreparationLinkRepository(
      join(directory, "links.json"),
      { sessionRepository, preparationRepository },
    ),
  }
}

function profile() {
  return normalizeCandidateProfile({
    headline: "Support technician",
    targetRoles: ["Support Technician"],
    locationPreferences: ["Jönköping"],
    workMode: "onsite",
    remotePreference: false,
    preferredEmploymentType: ["full-time"],
    skills: { technical: ["Windows", "Active Directory"], soft: ["Communication"] },
    yearsOfExperience: 3,
  })
}

function job(id: string, sourceId: string) {
  return normalizeJob({
    id, source: "test", sourceId, title: "Support Technician", company: "Example employer",
    location: "Jönköping", url: `https://example.test/${id}`, applyUrl: null, remote: "onsite",
    employmentType: "full-time", seniority: "mid", description: "Windows and Active Directory support.",
    skills: ["Windows", "Active Directory"],
  })
}

function application(id: string, sourceId: string, createdAt = "2026-09-10T10:00:00.000Z"): ApplicationRecord {
  const ranked = analyzeJobs(profile(), [job(id, sourceId)]).rankedJobs[0]
  const result = createApplication({ id, rankedJob: ranked, createdAt })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

const evidence: CandidateDocumentEvidence[] = [
  { id: "experience:0", kind: "experience", content: "Resolved Windows and Active Directory support requests.", context: { employer: "Example employer", role: "Support Technician" }, relatedRequirements: [{ category: "skill", value: "Windows" }] },
]

function generatedDocument(applicationId: string): GeneratedApplicationDocument {
  return {
    applicationId, documentType: "cv", language: "en", requiresHumanReview: false, warnings: [],
    sections: [{ id: "identity", kind: "identity", claims: [{ id: "name", kind: "candidateFact", provenance: "verbatim", text: "Alex Testsson", evidenceIds: ["identity:name"] }] }],
  }
}

function renderedDocument(document: GeneratedApplicationDocument): GeneratedDocumentRenderResult {
  return {
    applicationId: document.applicationId, documentType: document.documentType, language: document.language,
    format: "markdown", requiresHumanReview: document.requiresHumanReview, warnings: [],
    content: "# Alex Testsson",
    renderMap: [{ sectionId: "identity", claimId: "name", blockIndex: 0, evidenceIds: ["identity:name"], provenance: "verbatim" }],
  }
}

/** Seeds one application with every kind of owned artifact: a document version,
 * a candidate association, an interview session, an interview preparation, and
 * the link between the session and the preparation. */
async function seedApplication(deps: ApplicationDeletionDependencies, id: string, sourceId: string, candidateId: string) {
  const record = application(id, sourceId)
  const created = await deps.applicationRepository.create(record)
  if (!created.ok) throw new Error(created.error.message)

  const document = generatedDocument(id)
  const savedDocument = await deps.documentRepository.create({
    id: `${id}-cv-1`, applicationId: id, documentType: "cv", language: "en", version: 1,
    createdAt: "2026-09-10T10:00:00.000Z", generatedDocument: document, renderedDocument: renderedDocument(document),
  })
  if (!savedDocument.ok) throw new Error(savedDocument.error.message)

  const association = createCandidateApplicationAssociation({ candidateId, applicationId: id, createdAt: "2026-09-10T10:00:00.000Z" })
  if (!association.ok) throw new Error(association.error.message)
  const savedAssociation = await deps.associationRepository.create(association.value)
  if (!savedAssociation.ok) throw new Error(savedAssociation.error.message)

  const foundation = buildApplicationDocumentFoundation(record, { evidence })
  if (!foundation.ok) throw new Error("Invalid foundation fixture")
  const plan = createInterviewPreparationPlan(record, { evidence }, { language: "en", interviewType: "hiringManager" })
  if (!plan.ok) throw new Error("Invalid plan fixture")
  const savedPreparation = await deps.preparationRepository.create({
    id: `${id}-prep-1`, applicationId: id, candidateId, plan: plan.value, evidenceSnapshot: evidence, requirementContext: foundation.value.requirements,
  })
  if (!savedPreparation.ok) throw new Error(savedPreparation.error.message)

  const session = startInterviewSession(plan.value, { sessionId: `${id}-session-1` })
  if (!session.ok) throw new Error("Invalid session fixture")
  const savedSession = await deps.sessionRepository.save(session.value)
  if (!savedSession.ok) throw new Error(savedSession.error.message)

  const savedLink = await deps.sessionPreparationLinkRepository.create({
    sessionId: session.value.id, applicationId: id, preparationRecordId: `${id}-prep-1`,
  })
  if (!savedLink.ok) throw new Error(savedLink.error.message)

  return { record, sessionId: session.value.id, preparationId: `${id}-prep-1` }
}

describe("application deletion cascade", () => {
  it("removes every artifact exclusively owned by the deleted application", async () => {
    const deps = await dependencies()
    const target = await seedApplication(deps, "application-target", "target-source", "candidate-a")

    const result = await deleteApplicationAndOwnedData("application-target", deps)
    expect(result).toMatchObject({ ok: true, value: { applicationId: "application-target", sessionsDeleted: 1, preparationsDeleted: 1, documentsDeleted: 1 } })

    expect(await deps.applicationRepository.getById("application-target")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } })
    expect(await deps.documentRepository.listByApplication("application-target")).toEqual({ ok: true, value: [] })
    expect(await deps.associationRepository.getByApplicationId("application-target")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } })
    expect(await deps.sessionRepository.listByApplicationId("application-target")).toEqual({ ok: true, value: [] })
    expect(await deps.preparationRepository.listByApplicationId("application-target")).toEqual({ ok: true, value: [] })
    expect(await deps.sessionPreparationLinkRepository.getBySessionId(target.sessionId)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } })
  })

  it("leaves every other application, and the candidate's own data elsewhere, completely untouched", async () => {
    const deps = await dependencies()
    const survivor = await seedApplication(deps, "application-survivor", "survivor-source", "candidate-a")
    await seedApplication(deps, "application-target", "target-source", "candidate-a")

    await deleteApplicationAndOwnedData("application-target", deps)

    expect(await deps.applicationRepository.getById("application-survivor")).toMatchObject({ ok: true, value: { id: "application-survivor" } })
    expect(await deps.documentRepository.listByApplication("application-survivor")).toMatchObject({ ok: true, value: [{ id: "application-survivor-cv-1" }] })
    expect(await deps.associationRepository.getByApplicationId("application-survivor")).toMatchObject({ ok: true, value: { candidateId: "candidate-a" } })
    expect(await deps.sessionRepository.listByApplicationId("application-survivor")).toMatchObject({ ok: true, value: [{ id: survivor.sessionId }] })
    expect(await deps.preparationRepository.listByApplicationId("application-survivor")).toMatchObject({ ok: true, value: [{ id: survivor.preparationId }] })
    expect(await deps.sessionPreparationLinkRepository.getBySessionId(survivor.sessionId)).toMatchObject({ ok: true, value: { preparationRecordId: survivor.preparationId } })
  })

  it("releases duplicate detection for the same job after deletion, so a fresh application can be created", async () => {
    const deps = await dependencies()
    const seeded = await seedApplication(deps, "application-target", "target-source", "candidate-a")
    const rankedJob = analyzeJobs(profile(), [job("application-target", "target-source")]).rankedJobs[0]

    const beforeDeletion = await deps.applicationRepository.list()
    if (!beforeDeletion.ok) throw new Error(beforeDeletion.error.message)
    expect(findDuplicateApplications(beforeDeletion.value, rankedJob)).toEqual([{ applicationId: "application-target", reasons: ["same_source_and_source_id", "same_normalized_job_id"] }])

    await deleteApplicationAndOwnedData(seeded.record.id, deps)

    const afterDeletion = await deps.applicationRepository.list()
    if (!afterDeletion.ok) throw new Error(afterDeletion.error.message)
    expect(findDuplicateApplications(afterDeletion.value, rankedJob)).toEqual([])
  })

  it("fails without deleting anything for an unknown application id", async () => {
    const deps = await dependencies()
    const survivor = await seedApplication(deps, "application-survivor", "survivor-source", "candidate-a")

    const result = await deleteApplicationAndOwnedData("does-not-exist", deps)
    expect(result).toMatchObject({ ok: false, error: { stage: "delete_application", code: "NOT_FOUND" } })

    expect(await deps.applicationRepository.getById("application-survivor")).toMatchObject({ ok: true, value: { id: "application-survivor" } })
    expect(await deps.sessionRepository.listByApplicationId("application-survivor")).toMatchObject({ ok: true, value: [{ id: survivor.sessionId }] })
  })

  it("works the same for IT, healthcare, logistics, and administration application data", async () => {
    for (const domain of ["it", "healthcare", "logistics", "administration"]) {
      const deps = await dependencies()
      await seedApplication(deps, `${domain}-application`, `${domain}-source`, `${domain}-candidate`)
      const result = await deleteApplicationAndOwnedData(`${domain}-application`, deps)
      expect(result).toMatchObject({ ok: true, value: { applicationId: `${domain}-application` } })
      expect(await deps.applicationRepository.getById(`${domain}-application`)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } })
    }
  })
})
