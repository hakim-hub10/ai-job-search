import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import {
  analyzeJobs,
  createApplication,
  createApplicationDocumentStorageWorkflow,
  createFileApplicationDocumentRepository,
  createFileApplicationRepository,
  normalizeCandidateProfile,
  normalizeJob,
  type ApplicationDocumentRecord,
  type GeneratedApplicationDocument,
  type GeneratedDocumentRenderResult,
} from "../src/index"

const directories: string[] = []
const createdAt = "2026-08-31T10:00:00.000Z"
const secondCreatedAt = "2026-08-31T11:00:00.000Z"

afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

async function paths() {
  const directory = await mkdtemp(join(tmpdir(), "ai-job-search-documents-")); directories.push(directory)
  return { applications: join(directory, "applications.json"), documents: join(directory, "nested", "documents.json") }
}

function application(id = "application-a") {
  const profile = normalizeCandidateProfile({ headline: "Coordinator", targetRoles: ["Coordinator"], locationPreferences: ["Aarhus"], workMode: "onsite", remotePreference: false, preferredEmploymentType: ["full-time"], skills: { technical: ["Scheduling"], soft: [] }, yearsOfExperience: 3 })
  const job = normalizeJob({ id: `${id}-job`, source: "test", sourceId: `${id}-source`, title: "Coordinator", company: "Example", location: "Aarhus", url: "https://example.test/job", applyUrl: null, remote: "onsite", employmentType: "full-time", seniority: "mid", description: null, skills: ["Scheduling"] })
  const result = createApplication({ id, rankedJob: analyzeJobs(profile, [job]).rankedJobs[0], createdAt })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function generated(applicationId: string, documentType: "cv" | "coverLetter" = "cv", language: "sv" | "en" = "en", review = true): GeneratedApplicationDocument {
  return {
    applicationId, documentType, language, requiresHumanReview: review, warnings: [],
    sections: [
      { id: "identity", kind: "identity", claims: [{ id: "name", kind: "candidateFact", provenance: "verbatim", text: "Alex Example", evidenceIds: ["identity:name"] }] },
      { id: "experience", kind: "experience", claims: [{ id: "experience", kind: "candidateFact", provenance: review ? "paraphrased" : "verbatim", text: review ? "Experienced in scheduling." : "Coordinated scheduling", evidenceIds: ["experience:scheduling"] }] },
    ],
  }
}

function rendered(document: GeneratedApplicationDocument): GeneratedDocumentRenderResult {
  const heading = document.language === "sv" ? "Erfarenhet" : "Experience"
  return {
    applicationId: document.applicationId, documentType: document.documentType, language: document.language, format: "markdown", requiresHumanReview: document.requiresHumanReview, warnings: [],
    content: `# Alex Example\n## ${heading}\n- ${document.sections[1].claims[0].text}`,
    renderMap: [
      { sectionId: "identity", claimId: "name", blockIndex: 0, evidenceIds: ["identity:name"], provenance: "verbatim" },
      { sectionId: "experience", claimId: "experience", blockIndex: 1, evidenceIds: ["experience:scheduling"], provenance: document.sections[1].claims[0].provenance },
    ],
  }
}

function record(id: string, app = "application-a", type: "cv" | "coverLetter" = "cv", version = 1, timestamp = createdAt): ApplicationDocumentRecord {
  const document = generated(app, type)
  return { id, applicationId: app, documentType: type, language: document.language, version, createdAt: timestamp, generatedDocument: document, renderedDocument: rendered(document) }
}

describe("Phase 4.5 append-only document persistence", () => {
  it("assigns independent deterministic versions per application and document type without mutating applications", async () => {
    const path = await paths(); const applications = createFileApplicationRepository(path.applications); const documents = createFileApplicationDocumentRepository(path.documents)
    const first = application(); const other = application("application-b")
    expect((await applications.create(first)).ok).toBe(true); expect((await applications.create(other)).ok).toBe(true)
    const workflow = createApplicationDocumentStorageWorkflow(applications, documents)
    const original = structuredClone(first); const cv = generated(first.id); const cvBefore = structuredClone(cv)
    const one = await workflow.saveGeneratedApplicationDocument({ documentId: "cv-1", createdAt, generatedDocument: cv, renderedDocument: rendered(cv) })
    const two = await workflow.saveGeneratedApplicationDocument({ documentId: "cv-2", createdAt: secondCreatedAt, generatedDocument: cv, renderedDocument: rendered(cv) })
    const letter = generated(first.id, "coverLetter", "sv"); const cover = await workflow.saveGeneratedApplicationDocument({ documentId: "letter-1", createdAt, generatedDocument: letter, renderedDocument: rendered(letter) })
    const otherCv = generated(other.id); const otherResult = await workflow.saveGeneratedApplicationDocument({ documentId: "other-cv-1", createdAt, generatedDocument: otherCv, renderedDocument: rendered(otherCv) })
    expect(one).toMatchObject({ ok: true, value: { version: 1, documentType: "cv" } }); expect(two).toMatchObject({ ok: true, value: { version: 2, documentType: "cv" } })
    expect(cover).toMatchObject({ ok: true, value: { version: 1, documentType: "coverLetter", language: "sv" } }); expect(otherResult).toMatchObject({ ok: true, value: { version: 1, applicationId: other.id } })
    expect(await documents.listVersions(first.id, "cv")).toMatchObject({ ok: true, value: [{ id: "cv-1", version: 1 }, { id: "cv-2", version: 2 }] })
    expect(await documents.getLatest(first.id, "cv")).toMatchObject({ ok: true, value: { id: "cv-2", version: 2 } })
    expect(first).toEqual(original); expect(cv).toEqual(cvBefore)
  })

  it("provides deterministic get and list results with detached immutable historical snapshots", async () => {
    const path = await paths(); const repository = createFileApplicationDocumentRepository(path.documents)
    expect((await repository.create(record("b", "application-a", "cv", 2, secondCreatedAt))).ok).toBe(true)
    const first = record("a"); expect(await repository.create(first)).toEqual({ ok: true, value: first })
    expect((await repository.create(record("letter", "application-a", "coverLetter"))).ok).toBe(true)
    const listed = await repository.listByApplication("application-a"); if (!listed.ok) throw new Error(listed.error.message)
    expect(listed.value.map((item) => `${item.documentType}:${item.version}`)).toEqual(["coverLetter:1", "cv:1", "cv:2"])
    listed.value[1].generatedDocument.sections[0].claims[0].text = "mutated"
    const loaded = await repository.getById("a"); if (!loaded.ok) throw new Error(loaded.error.message)
    expect(loaded.value.generatedDocument.sections[0].claims[0].text).toBe("Alex Example")
    loaded.value.renderedDocument.renderMap[0].evidenceIds[0] = "mutated"
    const reread = await repository.getById("a"); if (!reread.ok) throw new Error(reread.error.message)
    expect(reread.value.renderedDocument.renderMap[0].evidenceIds).toEqual(["identity:name"])
    expect(await createFileApplicationDocumentRepository(path.documents).getLatest("application-a", "cv")).toMatchObject({ ok: true, value: { id: "b", version: 2 } })
  })

  it("rejects duplicate IDs, duplicate versions, invalid provenance, and missing documents without overwrite", async () => {
    const repository = createFileApplicationDocumentRepository((await paths()).documents); const first = record("first")
    expect((await repository.create(first)).ok).toBe(true)
    expect(await repository.create(first)).toMatchObject({ ok: false, error: { code: "DUPLICATE_ID" } })
    expect(await repository.create({ ...record("different"), version: 1 })).toMatchObject({ ok: false, error: { code: "DUPLICATE_VERSION" } })
    const invalid = record("invalid", "application-b"); invalid.generatedDocument.sections[1].claims[0].evidenceIds = []
    expect(await repository.create(invalid)).toMatchObject({ ok: false, error: { code: "INVALID_PROVENANCE" } })
    const mismatchedMarkdown = record("mismatched", "application-b"); mismatchedMarkdown.renderedDocument.content = "unverified Markdown"
    expect(await repository.create(mismatchedMarkdown)).toMatchObject({ ok: false, error: { code: "INVALID_PROVENANCE" } })
    expect(await repository.getById("missing")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } })
    expect(await repository.getById("first")).toEqual({ ok: true, value: first })
  })

  it("requires an existing application before saving and never changes its status or notes", async () => {
    const path = await paths(); const applications = createFileApplicationRepository(path.applications); const documents = createFileApplicationDocumentRepository(path.documents)
    const missing = generated("missing")
    expect(await createApplicationDocumentStorageWorkflow(applications, documents).saveGeneratedApplicationDocument({ documentId: "missing", createdAt, generatedDocument: missing, renderedDocument: rendered(missing) })).toMatchObject({ ok: false, error: { kind: "application", error: { code: "NOT_FOUND" } } })
    const stored = application(); await applications.create(stored); const before = structuredClone(stored); const document = generated(stored.id)
    await createApplicationDocumentStorageWorkflow(applications, documents).saveGeneratedApplicationDocument({ documentId: "saved", createdAt, generatedDocument: document, renderedDocument: rendered(document) })
    expect(await applications.getById(stored.id)).toEqual({ ok: true, value: before })
  })

  it("fails closed for corrupted JSON, invalid roots, unsupported schemas, and atomic write failures", async () => {
    const path = await paths(); const repository = createFileApplicationDocumentRepository(path.documents)
    await mkdir(dirname(path.documents), { recursive: true }); await writeFile(path.documents, "{ invalid", "utf8")
    expect(await repository.listByApplication("a")).toMatchObject({ ok: false, error: { code: "CORRUPT_STORAGE" } }); expect(await readFile(path.documents, "utf8")).toBe("{ invalid")
    await writeFile(path.documents, JSON.stringify({ schemaVersion: 1, documents: [{}] }), "utf8")
    expect(await repository.listByApplication("a")).toMatchObject({ ok: false, error: { code: "CORRUPT_STORAGE" } })
    await writeFile(path.documents, JSON.stringify({ schemaVersion: 2, documents: [] }), "utf8")
    expect(await repository.listByApplication("a")).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_SCHEMA_VERSION" } })
    const writePath = (await paths()).documents; await mkdir(dirname(writePath), { recursive: true }); await mkdir(join(dirname(writePath), ".documents.json.tmp"))
    expect(await createFileApplicationDocumentRepository(writePath).create(record("write-failure"))).toMatchObject({ ok: false, error: { code: "WRITE_FAILURE" } })
  })

  it("uses the same offline storage contract for IT, healthcare, logistics, and administration", async () => {
    const repository = createFileApplicationDocumentRepository((await paths()).documents)
    for (const [index, domain] of ["it", "healthcare", "logistics", "administration"].entries()) {
      const document = record(`${domain}-document`, `${domain}-application`, "cv", 1, index % 2 ? secondCreatedAt : createdAt)
      document.generatedDocument.sections[1].claims[0].text = `${domain} evidence`
      document.renderedDocument.content = `# Alex Example\n## Experience\n- ${domain} evidence`
      expect(await repository.create(document)).toMatchObject({ ok: true, value: { applicationId: `${domain}-application` } })
    }
  })
})
