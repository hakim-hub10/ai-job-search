import { describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));
let authenticated = true;
mock.module("./auth-session", () => ({
  requireAuthenticatedUser: async () => {
    if (!authenticated) throw new Error("no session");
    return { id: "user-a", email: "a@example.test", name: "User A", emailVerified: true };
  },
}));

const {
  denyMultiCandidateCoachAccess,
  getAuthorizedCandidateContext,
  requireOwnedApplication,
  requireOwnedApplicationDocument,
  requireOwnedBaseCv,
  requireOwnedCandidate,
  requireOwnedCandidateProfile,
  requireOwnedInterviewPreparation,
  requireOwnedInterviewSession,
} = await import("./authorization");
import type { CandidateOwnership } from "./candidate-ownership";
import type { JobSeekerOwnershipDependencies, CandidateOwnershipStore } from "./job-seeker-ownership";
import type { CoachCandidate } from "../../../.agents/job-search/cli/src/coach-workspace";
import type { CoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-repository";
import type { ApplicationRepository } from "../../../.agents/job-search/cli/src/application-repository";
import type { CandidateApplicationAssociationRepository } from "../../../.agents/job-search/cli/src/coach-application-association-repository";
import type { ApplicationDocumentRepository } from "../../../.agents/job-search/cli/src/application-document-repository";
import type { InterviewPreparationRepository } from "../../../.agents/job-search/cli/src/interview-preparation-repository";
import type { InterviewSessionRepository } from "../../../.agents/job-search/cli/src/interview-session-repository";
import type { CandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-repository";
import type { CandidateBaseCvRepository } from "./candidate-base-cv-repository";

const timestamp = "2026-09-10T00:00:00.000Z";
const candidateA: CoachCandidate = { id: "candidate-a", displayName: "A", createdAt: timestamp, updatedAt: timestamp };
const candidateB: CoachCandidate = { id: "candidate-b", displayName: "B", createdAt: timestamp, updatedAt: timestamp };
const ownershipA: CandidateOwnership = { userId: "user-a", candidateId: "candidate-a", relationship: "owner", createdAt: timestamp };
const ownershipB: CandidateOwnership = { userId: "user-b", candidateId: "candidate-b", relationship: "owner", createdAt: timestamp };

function fixture(options: { ownership?: CandidateOwnership[]; associations?: Array<{ applicationId: string; candidateId: string }>; applications?: string[] } = {}) {
  const ownership = options.ownership ?? [ownershipA, ownershipB];
  const candidates = new Map([[candidateA.id, candidateA], [candidateB.id, candidateB]]);
  const associations = options.associations ?? [{ applicationId: "application-a", candidateId: "candidate-a" }, { applicationId: "application-b", candidateId: "candidate-b" }];
  const applicationIds = new Set(options.applications ?? ["application-a", "application-b"]);
  const ownershipStore: CandidateOwnershipStore = {
    async listByUserId(userId) { return { ok: true, value: ownership.filter((row) => row.userId === userId).map((row) => structuredClone(row)) }; },
    async reserve() { return { ok: false, error: { code: "OWNERSHIP_CONFLICT", message: "not used" } }; },
  };
  const candidateRepository: CoachWorkspaceRepository = {
    async createCandidate() { throw new Error("not used"); },
    async getCandidateById(id) { const value = candidates.get(id); return value ? { ok: true, value } : { ok: false, error: { code: "NOT_FOUND", message: "missing" } }; },
    async listCandidates() { return { ok: true, value: [...candidates.values()] }; },
  };
  const applicationRepository: ApplicationRepository = {
    async create() { throw new Error("not used"); }, async save() { throw new Error("not used"); },
    async getById(id) { return applicationIds.has(id) ? { ok: true, value: { id } as never } : { ok: false, error: { code: "NOT_FOUND", message: "missing" } }; },
    async list() { return { ok: true, value: [] }; },
  };
  const associationRepository: CandidateApplicationAssociationRepository = {
    async create() { throw new Error("not used"); },
    async getByApplicationId(id) { const row = associations.find((association) => association.applicationId === id); return row ? { ok: true, value: { ...row, createdAt: timestamp } } : { ok: false, error: { code: "NOT_FOUND", message: "missing" } }; },
    async listByCandidateId(id) { return { ok: true, value: associations.filter((association) => association.candidateId === id).map((association) => ({ ...association, createdAt: timestamp })) }; },
  };
  const baseOwnership: JobSeekerOwnershipDependencies = { ownershipStore, candidateRepository };
  return { ownership: baseOwnership, applicationRepository, associationRepository };
}

function dependencies(options: Parameters<typeof fixture>[0] = {}) {
  return fixture(options);
}

describe("authorization boundary", () => {
  it("fails safely when unauthenticated", async () => {
    authenticated = false;
    const result = await getAuthorizedCandidateContext(dependencies());
    expect(result).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    authenticated = true;
  });

  it("allows A->A and denies A->B without foreign details", async () => {
    const deps = dependencies();
    expect((await requireOwnedCandidate("candidate-a", deps)).ok).toBe(true);
    const denied = await requireOwnedCandidate("candidate-b", deps);
    expect(denied).toMatchObject({ ok: false, error: { code: "FORBIDDEN", message: "Resursen kunde inte hittas." } });
    expect(JSON.stringify(denied)).not.toContain("Candidate B");
    expect(JSON.stringify(denied)).not.toContain("user-b");
  });

  it("fails closed on missing or duplicate ownership", async () => {
    expect(await getAuthorizedCandidateContext(fixture({ ownership: [] }))).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    const duplicate = fixture({ ownership: [ownershipA, { ...ownershipA, candidateId: "candidate-b" }] });
    expect(await getAuthorizedCandidateContext(duplicate)).toMatchObject({ ok: false, error: { code: "INTEGRITY_ERROR" } });
  });

  it("authorizes applications only through the owned candidate association", async () => {
    const deps = dependencies();
    expect((await requireOwnedApplication("application-a", deps)).ok).toBe(true);
    expect(await requireOwnedApplication("application-b", deps)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await requireOwnedApplication("application-a", dependencies({ associations: [{ applicationId: "application-a", candidateId: "candidate-a" }, { applicationId: "application-a", candidateId: "candidate-a" }] }))).toMatchObject({ ok: false, error: { code: "INTEGRITY_ERROR" } });
  });

  it("denies application-ID-only access and candidate mismatch", async () => {
    const result = await requireOwnedApplication("unknown-application", dependencies());
    expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await requireOwnedCandidate("", dependencies())).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("resolves documents and interviews through application ownership", async () => {
    const deps = dependencies();
    const document = { id: "document-a", applicationId: "application-a" } as never;
    const documentRepository: ApplicationDocumentRepository = { async create() { throw new Error("not used"); }, async getById() { return { ok: true, value: document }; }, async listByApplication() { return { ok: true, value: [] }; }, async listVersions() { return { ok: true, value: [] }; }, async getLatest() { return { ok: true, value: document }; } };
    const preparation = { id: "preparation-a", applicationId: "application-a", candidateId: "candidate-a" } as never;
    const preparationRepository: InterviewPreparationRepository = { async create() { throw new Error("not used"); }, async getById() { return { ok: true, value: preparation }; }, async listByApplicationId() { return { ok: true, value: [] }; } };
    const session = { id: "session-a", applicationId: "application-a" } as never;
    const sessionRepository: Pick<InterviewSessionRepository, "getById"> = { async getById() { return { ok: true, value: session }; } };
    const extended = { ...deps, documentRepository, preparationRepository, sessionRepository };
    expect((await requireOwnedApplicationDocument("document-a", extended)).ok).toBe(true);
    expect((await requireOwnedInterviewPreparation("preparation-a", extended)).ok).toBe(true);
    expect((await requireOwnedInterviewSession("session-a", "application-a", extended)).ok).toBe(true);
    expect(await requireOwnedInterviewSession("session-a", "application-b", extended)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("fails closed on inconsistent interview linkage", async () => {
    const deps = dependencies();
    const preparationRepository: InterviewPreparationRepository = { async create() { throw new Error("not used"); }, async getById() { return { ok: true, value: { id: "prep", applicationId: "application-a", candidateId: "candidate-b" } as never }; }, async listByApplicationId() { return { ok: true, value: [] }; } };
    expect(await requireOwnedInterviewPreparation("prep", { ...deps, preparationRepository })).toMatchObject({ ok: false, error: { code: "INTEGRITY_ERROR" } });
  });

  it("requires owned profile and Base CV without mutating either", async () => {
    const deps = dependencies();
    const profileRepository: CandidateProfileRepository = { async saveProfile() { throw new Error("must not save"); }, async getProfileByCandidateId() { return { ok: true, value: { candidateId: "candidate-a", profile: {} as never } }; }, async listProfiles() { return { ok: true, value: [] }; } };
    const baseCvRepository: CandidateBaseCvRepository = { async save() { throw new Error("must not save"); }, async getByCandidateId() { return { ok: true, value: { candidateId: "candidate-a" } as never }; } };
    expect((await requireOwnedCandidateProfile("candidate-a", { ...deps, profileRepository })).ok).toBe(true);
    expect((await requireOwnedBaseCv("candidate-a", { ...deps, baseCvRepository })).ok).toBe(true);
    expect(await requireOwnedCandidateProfile("candidate-b", { ...deps, profileRepository })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("denies multi-candidate coach access and returns minimum context", async () => {
    const context = await getAuthorizedCandidateContext(dependencies());
    expect(context.ok && Object.keys(context.value)).toEqual(["user", "candidate"]);
    expect(context.ok && Object.keys(context.value.user)).toEqual(["id", "email"]);
    expect(denyMultiCandidateCoachAccess()).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});
