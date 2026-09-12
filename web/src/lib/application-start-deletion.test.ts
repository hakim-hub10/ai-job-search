import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileApplicationRepository } from "../../../.agents/job-search/cli/src/application-file-repository";
import { createFileCandidateApplicationAssociationRepository } from "../../../.agents/job-search/cli/src/coach-application-association-file-repository";
import { createFileCoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-file-repository";
import { createFileCandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-file-repository";
import { createFileApplicationDocumentRepository } from "../../../.agents/job-search/cli/src/application-document-file-repository";
import { createFileInterviewSessionRepository } from "../../../.agents/job-search/cli/src/interview-session-file-repository";
import { createFileInterviewPreparationRepository } from "../../../.agents/job-search/cli/src/interview-preparation-file-repository";
import { createFileInterviewSessionPreparationLinkRepository } from "../../../.agents/job-search/cli/src/interview-session-preparation-link-file-repository";
import { deleteApplicationAndOwnedData } from "../../../.agents/job-search/cli/src/application-deletion";
import { normalizeCandidateProfile, normalizeJob } from "../../../.agents/job-search/cli/src/index";
import type { CoachCandidate } from "../../../.agents/job-search/cli/src/coach-workspace";
import { startApplicationFromJob } from "./application-start";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

function profile() {
  return normalizeCandidateProfile({
    headline: "IT Support Technician", targetRoles: ["IT Support Technician"], locationPreferences: ["Jönköping"],
    workMode: "onsite", remotePreference: false, preferredEmploymentType: ["full-time"],
    skills: { technical: ["Windows"], soft: [] }, yearsOfExperience: 3,
  });
}

/** The exact job a real search would surface, twice - deterministic ID from
 * the real source/sourceId, exactly like createNormalizedJob computes it. */
function jobX() {
  return normalizeJob({
    source: "test", sourceId: "job-x-source", title: "IT Support Technician", company: "Nordic Tech",
    location: "Jönköping", url: "https://example.test/job-x", applyUrl: null, remote: "onsite",
    employmentType: "full-time", seniority: "mid", description: "Support role.", skills: ["Windows"],
  });
}

function jobSimilarTitle() {
  return normalizeJob({
    source: "test", sourceId: "job-y-source", title: "IT Support Technician (Night Shift)", company: "Other Employer",
    location: "Malmö", url: "https://example.test/job-y", applyUrl: null, remote: "onsite",
    employmentType: "full-time", seniority: "mid", description: "Different role.", skills: ["Windows"],
  });
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "application-start-deletion-"));
  directories.push(directory);
  const candidateRepository = createFileCoachWorkspaceRepository(join(directory, "candidates.json"));
  const profileRepository = createFileCandidateProfileRepository(join(directory, "profiles.json"));
  const applicationRepository = createFileApplicationRepository(join(directory, "applications.json"));
  const associationRepository = createFileCandidateApplicationAssociationRepository(join(directory, "associations.json"));
  const documentRepository = createFileApplicationDocumentRepository(join(directory, "documents.json"));
  const sessionRepository = createFileInterviewSessionRepository(join(directory, "sessions.json"));
  const preparationRepository = createFileInterviewPreparationRepository(join(directory, "preparations.json"));
  const sessionPreparationLinkRepository = createFileInterviewSessionPreparationLinkRepository(join(directory, "links.json"), { sessionRepository, preparationRepository });

  async function registerCandidate(id: string): Promise<CoachCandidate> {
    const candidate: CoachCandidate = { id, displayName: `Candidate ${id}`, createdAt: "2026-09-12T10:00:00.000Z", updatedAt: "2026-09-12T10:00:00.000Z" };
    const created = await candidateRepository.createCandidate(candidate);
    if (!created.ok) throw new Error(created.error.message);
    const saved = await profileRepository.saveProfile(id, profile());
    if (!saved.ok) throw new Error(saved.error.message);
    return candidate;
  }

  return {
    candidateRepository, profileRepository, applicationRepository, associationRepository,
    documentRepository, sessionRepository, preparationRepository, sessionPreparationLinkRepository,
    registerCandidate,
  };
}

/** The exact dependency shape jobs/actions.ts's startApplicationAction wires. */
function startInput(candidateId: string, job: ReturnType<typeof jobX>) {
  return { candidateId, jobId: job.id, limit: 10 };
}

describe("delete -> recreate application lifecycle (real file repositories)", () => {
  it("blocks a duplicate, then allows recreation for the same candidate and job after deletion", async () => {
    const store = await fixture();
    const candidate = await store.registerCandidate("candidate-a");
    const dependencies = {
      candidateRepository: store.candidateRepository,
      profileRepository: store.profileRepository,
      applicationRepository: store.applicationRepository,
      associationRepository: store.associationRepository,
      searchJobs: async () => ({ ok: true as const, jobs: [jobX()], totalRetrieved: 1, sourceStatus: [] }),
      createId: (() => { let n = 0; return () => `application-${++n}`; })(),
      now: () => "2026-09-12T10:00:00.000Z",
    };

    const first = await startApplicationFromJob(startInput(candidate.id, jobX()), dependencies);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("expected success");
    const applicationId = first.application.id;

    const duplicate = await startApplicationFromJob(startInput(candidate.id, jobX()), dependencies);
    expect(duplicate).toMatchObject({ ok: false, code: "DUPLICATE_APPLICATION", applicationId });

    const deleted = await deleteApplicationAndOwnedData(applicationId, {
      applicationRepository: store.applicationRepository,
      associationRepository: store.associationRepository,
      documentRepository: store.documentRepository,
      sessionRepository: store.sessionRepository,
      preparationRepository: store.preparationRepository,
      sessionPreparationLinkRepository: store.sessionPreparationLinkRepository,
    });
    expect(deleted.ok).toBe(true);

    const recreated = await startApplicationFromJob(startInput(candidate.id, jobX()), dependencies);
    expect(recreated.ok).toBe(true);
    if (!recreated.ok) throw new Error("expected recreation to succeed");
    expect(recreated.application.id).not.toBe(applicationId);

    const stillDuplicate = await startApplicationFromJob(startInput(candidate.id, jobX()), dependencies);
    expect(stillDuplicate).toMatchObject({ ok: false, code: "DUPLICATE_APPLICATION", applicationId: recreated.application.id });
  });

  it("never lets one candidate's application block a different candidate from applying to the same job", async () => {
    const store = await fixture();
    const candidateA = await store.registerCandidate("candidate-a");
    const candidateB = await store.registerCandidate("candidate-b");
    const dependencies = {
      candidateRepository: store.candidateRepository,
      profileRepository: store.profileRepository,
      applicationRepository: store.applicationRepository,
      associationRepository: store.associationRepository,
      searchJobs: async () => ({ ok: true as const, jobs: [jobX()], totalRetrieved: 1, sourceStatus: [] }),
      createId: (() => { let n = 0; return () => `application-${++n}`; })(),
      now: () => "2026-09-12T10:00:00.000Z",
    };

    const forA = await startApplicationFromJob(startInput(candidateA.id, jobX()), dependencies);
    expect(forA.ok).toBe(true);

    const forB = await startApplicationFromJob(startInput(candidateB.id, jobX()), dependencies);
    expect(forB.ok).toBe(true);
    if (!forA.ok || !forB.ok) throw new Error("expected both candidates to succeed independently");
    expect(forB.application.id).not.toBe(forA.application.id);

    // Each candidate is still blocked from creating a second application for
    // their own already-applied job - duplicate detection is scoped to the
    // candidate, not disabled.
    const repeatForA = await startApplicationFromJob(startInput(candidateA.id, jobX()), dependencies);
    expect(repeatForA).toMatchObject({ ok: false, code: "DUPLICATE_APPLICATION", applicationId: forA.application.id });
    const repeatForB = await startApplicationFromJob(startInput(candidateB.id, jobX()), dependencies);
    expect(repeatForB).toMatchObject({ ok: false, code: "DUPLICATE_APPLICATION", applicationId: forB.application.id });
  });

  it("keeps unrelated jobs with similar titles from colliding as duplicates", async () => {
    const store = await fixture();
    const candidate = await store.registerCandidate("candidate-a");
    const dependencies = {
      candidateRepository: store.candidateRepository,
      profileRepository: store.profileRepository,
      applicationRepository: store.applicationRepository,
      associationRepository: store.associationRepository,
      searchJobs: async () => ({ ok: true as const, jobs: [jobX(), jobSimilarTitle()], totalRetrieved: 2, sourceStatus: [] }),
      createId: (() => { let n = 0; return () => `application-${++n}`; })(),
      now: () => "2026-09-12T10:00:00.000Z",
    };

    const forX = await startApplicationFromJob(startInput(candidate.id, jobX()), dependencies);
    expect(forX.ok).toBe(true);

    const forSimilar = await startApplicationFromJob(startInput(candidate.id, jobSimilarTitle()), dependencies);
    expect(forSimilar.ok).toBe(true);
  });

  it("deleting an application never touches the candidate's profile", async () => {
    const store = await fixture();
    const candidate = await store.registerCandidate("candidate-a");
    const dependencies = {
      candidateRepository: store.candidateRepository,
      profileRepository: store.profileRepository,
      applicationRepository: store.applicationRepository,
      associationRepository: store.associationRepository,
      searchJobs: async () => ({ ok: true as const, jobs: [jobX()], totalRetrieved: 1, sourceStatus: [] }),
      createId: () => "application-1",
      now: () => "2026-09-12T10:00:00.000Z",
    };
    const beforeProfile = await store.profileRepository.getProfileByCandidateId(candidate.id);
    const created = await startApplicationFromJob(startInput(candidate.id, jobX()), dependencies);
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected success");

    await deleteApplicationAndOwnedData(created.application.id, {
      applicationRepository: store.applicationRepository,
      associationRepository: store.associationRepository,
      documentRepository: store.documentRepository,
      sessionRepository: store.sessionRepository,
      preparationRepository: store.preparationRepository,
      sessionPreparationLinkRepository: store.sessionPreparationLinkRepository,
    });

    const afterProfile = await store.profileRepository.getProfileByCandidateId(candidate.id);
    expect(afterProfile).toEqual(beforeProfile);
  });
});
