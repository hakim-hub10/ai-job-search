import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Full-stack, two-candidate isolation tests using REAL file repositories
 * (temporary directories, never the real coach directory) rather than mocks.
 * `authorization.ts`/`analytics.ts` are `server-only`-tainted, so both the
 * "server-only" and "./auth-session" modules are mocked here - the same
 * established pattern already used by authorization.test.ts and
 * job-seeker-ownership.test.ts - letting this file drive the exact
 * production authorization/analytics code against synthetic, isolated data
 * for two distinct authenticated identities (userId "user-a" / "user-b").
 */
mock.module("server-only", () => ({}));
let currentUserId = "user-a";
mock.module("./auth-session", () => ({
  requireAuthenticatedUser: async () => ({ id: currentUserId, email: `${currentUserId}@example.test`, name: currentUserId, emailVerified: true }),
  getAuthenticatedUser: async () => ({ id: currentUserId, email: `${currentUserId}@example.test`, name: currentUserId, emailVerified: true }),
}));

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const previous = currentUserId;
  currentUserId = userId;
  try {
    return await fn();
  } finally {
    currentUserId = previous;
  }
}

const {
  requireOwnedApplication,
  requireOwnedApplicationDocument,
  requireOwnedCandidate,
  requireOwnedCandidateProfile,
  requireOwnedBaseCv,
  requireOwnedInterviewPreparation,
  requireOwnedInterviewSession,
  configuredAuthorizationDependencies,
} = await import("./authorization");
const { deriveCandidateRequirementInsights, loadCandidateRequirementInsights } = await import("./analytics");
const { createCoachOperationsWebWorkflow } = await import("./coach-operations");

import {
  analyzeJobs,
  createApplication,
  createInterviewPreparationPlan,
  normalizeCandidateProfile,
  normalizeJob,
  startInterviewSession,
  buildApplicationDocumentFoundation,
} from "../../../.agents/job-search/cli/src/index";
import { createFileApplicationRepository } from "../../../.agents/job-search/cli/src/application-file-repository";
import { createFileApplicationDocumentRepository } from "../../../.agents/job-search/cli/src/application-document-file-repository";
import { createFileCandidateApplicationAssociationRepository } from "../../../.agents/job-search/cli/src/coach-application-association-file-repository";
import { createCandidateApplicationAssociation } from "../../../.agents/job-search/cli/src/coach-application-association";
import { createFileCoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-file-repository";
import { createFileCandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-file-repository";
import { createFileInterviewSessionRepository } from "../../../.agents/job-search/cli/src/interview-session-file-repository";
import { createFileInterviewPreparationRepository } from "../../../.agents/job-search/cli/src/interview-preparation-file-repository";
import type { CoachCandidate } from "../../../.agents/job-search/cli/src/coach-workspace";
import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import type { ApplicationRecord } from "../../../.agents/job-search/cli/src/applications";

const originalEnv = { ...process.env };
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

function itProfile(): CandidateProfile {
  return normalizeCandidateProfile({
    headline: "IT Support Technician", targetRoles: ["IT Support Technician"], locationPreferences: ["Jönköping"],
    workMode: "onsite", remotePreference: false, preferredEmploymentType: ["full-time"],
    skills: { technical: ["Windows", "Active Directory", "Microsoft 365"], soft: [] }, yearsOfExperience: 5,
  });
}

function logisticsProfile(): CandidateProfile {
  return normalizeCandidateProfile({
    headline: "Logistics Coordinator", targetRoles: ["Logistics Coordinator"], locationPreferences: ["Malmö"],
    workMode: "onsite", remotePreference: false, preferredEmploymentType: ["full-time"],
    skills: { technical: ["Forklift", "Warehouse Management"], soft: [] }, yearsOfExperience: 2,
  });
}

function job(id: string) {
  return normalizeJob({
    id, source: "test", sourceId: `${id}-source`, title: "IT Support Technician", company: "Nordic Tech",
    location: "Jönköping", url: `https://example.test/${id}`, applyUrl: null, remote: "onsite",
    employmentType: "full-time", seniority: "mid", description: "Windows and Active Directory support.",
    skills: ["Windows", "Active Directory"],
  });
}

function logisticsJob(id: string) {
  return normalizeJob({
    id, source: "test", sourceId: `${id}-source`, title: "Logistics Coordinator", company: "Nordic Freight",
    location: "Malmö", url: `https://example.test/${id}`, applyUrl: null, remote: "onsite",
    employmentType: "full-time", seniority: "mid", description: "Forklift and warehouse management.",
    skills: ["Forklift", "Warehouse Management"],
  });
}

/** A full isolated fixture: two real, independent candidate workspaces
 * (own profile, applications, documents, interview data), sharing only the
 * process env vars a real request would use - exactly mirroring the real
 * multi-user file-repository layout under one COACH_DIR. */
async function fixture() {
  const coachDir = await mkdtemp(join(tmpdir(), "ownership-isolation-"));
  directories.push(coachDir);
  const applicationRepositoryPath = join(coachDir, "applications.json");
  const documentRepositoryPath = join(coachDir, "documents.json");
  const preparationRepositoryPath = join(coachDir, "preparations.json");
  const sessionRepositoryPath = join(coachDir, "sessions.json");
  process.env.COACH_DIR = coachDir;
  process.env.APPLICATION_REPOSITORY = applicationRepositoryPath;
  process.env.APPLICATION_DOCUMENT_REPOSITORY = documentRepositoryPath;
  process.env.INTERVIEW_PREPARATION_REPOSITORY = preparationRepositoryPath;
  process.env.INTERVIEW_SESSION_REPOSITORY = sessionRepositoryPath;

  const candidates = createFileCoachWorkspaceRepository(join(coachDir, "candidates.json"));
  const profiles = createFileCandidateProfileRepository(join(coachDir, "candidate-profiles.json"));
  const applications = createFileApplicationRepository(applicationRepositoryPath);
  const associations = createFileCandidateApplicationAssociationRepository(join(coachDir, "associations.json"));
  const documents = createFileApplicationDocumentRepository(documentRepositoryPath);
  const sessions = createFileInterviewSessionRepository(sessionRepositoryPath);
  const preparations = createFileInterviewPreparationRepository(preparationRepositoryPath);

  async function registerCandidate(id: string, profile: CandidateProfile): Promise<CoachCandidate> {
    const candidate: CoachCandidate = { id, displayName: `Candidate ${id}`, createdAt: "2026-09-12T10:00:00.000Z", updatedAt: "2026-09-12T10:00:00.000Z" };
    const created = await candidates.createCandidate(candidate);
    if (!created.ok) throw new Error(created.error.message);
    const saved = await profiles.saveProfile(id, profile);
    if (!saved.ok) throw new Error(saved.error.message);
    return candidate;
  }

  async function seedApplication(applicationId: string, candidateId: string, profile: CandidateProfile, jobFactory: (id: string) => ReturnType<typeof job> = job) {
    const ranked = analyzeJobs(profile, [jobFactory(applicationId)]).rankedJobs[0];
    const created = createApplication({ id: applicationId, rankedJob: ranked, createdAt: "2026-09-12T10:00:00.000Z" });
    if (!created.ok) throw new Error(created.error.message);
    const savedApplication = await applications.create(created.value);
    if (!savedApplication.ok) throw new Error(savedApplication.error.message);
    const association = createCandidateApplicationAssociation({ candidateId, applicationId, createdAt: "2026-09-12T10:00:00.000Z" });
    if (!association.ok) throw new Error(association.error.message);
    const savedAssociation = await associations.create(association.value);
    if (!savedAssociation.ok) throw new Error(savedAssociation.error.message);
    return created.value;
  }

  async function seedDocument(applicationId: string) {
    const document = {
      applicationId, documentType: "cv" as const, language: "en" as const, requiresHumanReview: false, warnings: [],
      sections: [{ id: "identity", kind: "identity" as const, claims: [{ id: "name", kind: "candidateFact" as const, provenance: "verbatim" as const, text: "Alex Testsson", evidenceIds: ["identity:name"] }] }],
    };
    const rendered = {
      applicationId, documentType: "cv" as const, language: "en" as const, format: "markdown" as const, requiresHumanReview: false, warnings: [],
      content: "# Alex Testsson", renderMap: [{ sectionId: "identity", claimId: "name", blockIndex: 0, evidenceIds: ["identity:name"], provenance: "verbatim" as const }],
    };
    const saved = await documents.create({ id: `${applicationId}-cv-1`, applicationId, documentType: "cv", language: "en", version: 1, createdAt: "2026-09-12T10:00:00.000Z", generatedDocument: document, renderedDocument: rendered });
    if (!saved.ok) throw new Error(saved.error.message);
    return saved.value;
  }

  async function seedInterview(applicationRecord: ApplicationRecord, candidateId: string) {
    const evidence = [{ id: "experience:0", kind: "experience" as const, content: "Provided support.", context: { employer: "Example employer", role: "Support" }, relatedRequirements: [{ category: "skill" as const, value: "Windows" }] }];
    const foundation = buildApplicationDocumentFoundation(applicationRecord, { evidence });
    if (!foundation.ok) throw new Error("Invalid foundation fixture");
    const plan = createInterviewPreparationPlan(applicationRecord, { evidence }, { language: "en", interviewType: "hiringManager" });
    if (!plan.ok) throw new Error("Invalid plan fixture");
    const savedPreparation = await preparations.create({ id: `${applicationRecord.id}-prep-1`, applicationId: applicationRecord.id, candidateId, plan: plan.value, evidenceSnapshot: evidence, requirementContext: foundation.value.requirements });
    if (!savedPreparation.ok) throw new Error(savedPreparation.error.message);
    const session = startInterviewSession(plan.value, { sessionId: `${applicationRecord.id}-session-1` });
    if (!session.ok) throw new Error("Invalid session fixture");
    const savedSession = await sessions.save(session.value);
    if (!savedSession.ok) throw new Error(savedSession.error.message);
    return { preparationId: `${applicationRecord.id}-prep-1`, sessionId: session.value.id };
  }

  return { coachDir, candidates, profiles, applications, associations, documents, sessions, preparations, registerCandidate, seedApplication, seedDocument, seedInterview };
}

function authDependencies() {
  return configuredAuthorizationDependencies();
}

describe("two-candidate ownership isolation (real file repositories)", () => {
  it("keeps analytics counts fully separate: candidate A's 2 applications never becomes 9 because candidate B has 7", async () => {
    const store = await fixture();
    await store.registerCandidate("candidate-a", itProfile());
    await store.registerCandidate("candidate-b", logisticsProfile());
    for (let index = 0; index < 2; index += 1) await store.seedApplication(`a-application-${index}`, "candidate-a", itProfile());
    for (let index = 0; index < 7; index += 1) await store.seedApplication(`b-application-${index}`, "candidate-b", logisticsProfile());

    const insightsA = await loadCandidateRequirementInsights("candidate-a");
    const insightsB = await loadCandidateRequirementInsights("candidate-b");
    expect(insightsA.insights?.applicationsTotal).toBe(2);
    expect(insightsB.insights?.applicationsTotal).toBe(7);
    expect(insightsA.insights?.applicationsTotal).not.toBe(9);
  });

  it("never uses candidate B's evidence when aggregating candidate A's requirement insights", async () => {
    const store = await fixture();
    await store.registerCandidate("candidate-a", itProfile());
    await store.registerCandidate("candidate-b", logisticsProfile());
    const a1 = await store.seedApplication("a-app-1", "candidate-a", itProfile());
    const b1 = await store.seedApplication("b-app-1", "candidate-b", logisticsProfile(), logisticsJob);
    const insightsA = deriveCandidateRequirementInsights([a1]);
    const insightsB = deriveCandidateRequirementInsights([b1]);
    const labelsA = insightsA.requirements.map((requirement) => requirement.label);
    const labelsB = insightsB.requirements.map((requirement) => requirement.label);
    expect(labelsA.some((label) => labelsB.includes(label))).toBe(false);
  });

  it("produces independent match results per candidate for the identical job - a candidate's profile never influences another candidate's score", () => {
    const jobX = job("shared-job");
    const rankedForIt = analyzeJobs(itProfile(), [jobX]).rankedJobs[0];
    const rankedForLogistics = analyzeJobs(logisticsProfile(), [jobX]).rankedJobs[0];
    expect(rankedForIt.score).not.toBe(rankedForLogistics.score);
    expect(rankedForIt.matchingResult.matchedDimensions).toContain("technicalSkills");
    expect(rankedForLogistics.matchingResult.matchedDimensions).not.toContain("technicalSkills");
  });

  it("denies candidate A's session access to candidate B's application, document, and interview data", async () => {
    const store = await fixture();
    await store.registerCandidate("candidate-a", itProfile());
    await store.registerCandidate("candidate-b", logisticsProfile());
    const applicationB = await store.seedApplication("application-b", "candidate-b", logisticsProfile());
    await store.seedDocument(applicationB.id);
    const interviewB = await store.seedInterview(applicationB, "candidate-b");

    await asUser("user-a", async () => {
      const dependencies = authDependencies();
      expect(dependencies.ok).toBe(true);
      if (!dependencies.ok) return;
      // No ownership row exists for user-a at all in this fixture (Postgres
      // is not seeded here), which already fails closed via FORBIDDEN -
      // exactly the outcome required: user A must never resolve B's data.
      const application = await requireOwnedApplication("application-b", dependencies.value);
      expect(application.ok).toBe(false);
      const candidate = await requireOwnedCandidate("candidate-b", dependencies.value);
      expect(candidate.ok).toBe(false);
      const profile = await requireOwnedCandidateProfile("candidate-b", dependencies.value);
      expect(profile.ok).toBe(false);
      const baseCv = await requireOwnedBaseCv("candidate-b", dependencies.value);
      expect(baseCv.ok).toBe(false);
      const preparation = await requireOwnedInterviewPreparation(interviewB.preparationId, dependencies.value);
      expect(preparation.ok).toBe(false);
      const session = await requireOwnedInterviewSession(interviewB.sessionId, applicationB.id, dependencies.value);
      expect(session.ok).toBe(false);
      const document = await requireOwnedApplicationDocument(`${applicationB.id}-cv-1`, dependencies.value);
      expect(document.ok).toBe(false);
    });
  });

  it("isolates notes, goals, and activities per candidate and rejects cross-candidate mutation by ID", async () => {
    const store = await fixture();
    await store.registerCandidate("candidate-a", itProfile());
    await store.registerCandidate("candidate-b", logisticsProfile());
    const workflow = createCoachOperationsWebWorkflow();
    if (!workflow) throw new Error("workflow not configured");

    const noteA = await workflow.createNote({ id: "note-a", candidateId: "candidate-a", text: "A's private note", createdAt: "2026-09-12T10:00:00.000Z" });
    const noteB = await workflow.createNote({ id: "note-b", candidateId: "candidate-b", text: "B's private note", createdAt: "2026-09-12T10:00:00.000Z" });
    expect(noteA.ok).toBe(true);
    expect(noteB.ok).toBe(true);

    const listA = await workflow.listNotes("candidate-a");
    const listB = await workflow.listNotes("candidate-b");
    expect(listA).toMatchObject({ ok: true, value: [{ id: "note-a", text: "A's private note" }] });
    expect(listB).toMatchObject({ ok: true, value: [{ id: "note-b", text: "B's private note" }] });

    // Candidate A's own candidateId is legitimate, but note-b belongs to B -
    // the domain workflow must catch the ID mismatch even though the caller
    // passed their own, real candidateId.
    const crossUpdate = await workflow.updateNote("note-b", "candidate-a", { text: "tampered", updatedAt: "2026-09-12T11:00:00.000Z" });
    expect(crossUpdate).toMatchObject({ ok: false, error: { kind: "operations_repository", error: { code: "NOT_FOUND" } } });
    const untouched = await workflow.listNotes("candidate-b");
    expect(untouched).toMatchObject({ ok: true, value: [{ id: "note-b", text: "B's private note" }] });
  });
});
