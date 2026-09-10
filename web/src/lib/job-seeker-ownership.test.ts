import { describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));
let authenticated = true;
mock.module("./auth-session", () => ({
  requireAuthenticatedUser: async () => {
    if (!authenticated) throw new Error("no session");
    return { id: "user-a", email: "a@example.test", name: "User A", emailVerified: true };
  },
}));

const { getCurrentJobSeekerCandidate, getOrCreateOwnedCandidateForUser, getOwnedCandidateForUser } = await import("./job-seeker-ownership");
import type { CandidateOwnership } from "./candidate-ownership";
import type { CoachCandidate } from "../../../.agents/job-search/cli/src/coach-workspace";
import type { CoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-repository";
import type { CandidateOwnershipStore, JobSeekerOwnershipDependencies } from "./job-seeker-ownership";

const userA = { id: "user-a", email: "a@example.test", name: "User A", emailVerified: true };
const userB = { id: "user-b", email: "b@example.test", name: "User B", emailVerified: true };
const now = "2026-09-10T00:00:00.000Z";

function fixture(options: { ownership?: CandidateOwnership[]; candidates?: CoachCandidate[]; createFails?: boolean } = {}) {
  const ownership = [...(options.ownership ?? [])];
  const candidates = new Map((options.candidates ?? []).map((candidate) => [candidate.id, structuredClone(candidate)]));
  let creates = 0;
  const ownershipStore: CandidateOwnershipStore = {
    async listByUserId(userId) { return { ok: true, value: ownership.filter((row) => row.userId === userId).map((row) => structuredClone(row)) }; },
    async reserve(input) {
      const existingUser = ownership.filter((row) => row.userId === input.userId);
      const existingCandidate = ownership.find((row) => row.candidateId === input.candidateId);
      if (existingUser.length > 0) return { ok: true, value: { reserved: false, ownership: structuredClone(existingUser[0]!) } };
      if (existingCandidate) return { ok: false, error: { code: "OWNERSHIP_CONFLICT", message: "conflict" } };
      ownership.push(structuredClone(input));
      return { ok: true, value: { reserved: true, ownership: structuredClone(input) } };
    },
  };
  const candidateRepository: CoachWorkspaceRepository = {
    async createCandidate(candidate) {
      creates += 1;
      if (options.createFails) return { ok: false, error: { code: "WRITE_FAILURE", message: "storage" } };
      if (candidates.has(candidate.id)) return { ok: false, error: { code: "DUPLICATE_ID", message: "duplicate" } };
      candidates.set(candidate.id, structuredClone(candidate));
      return { ok: true, value: structuredClone(candidate) };
    },
    async getCandidateById(id) {
      const candidate = candidates.get(id);
      return candidate ? { ok: true, value: structuredClone(candidate) } : { ok: false, error: { code: "NOT_FOUND", message: "missing" } };
    },
    async listCandidates() { return { ok: true, value: [...candidates.values()].map((candidate) => structuredClone(candidate)) }; },
  };
  const dependencies: JobSeekerOwnershipDependencies = { ownershipStore, candidateRepository, createId: () => "candidate-reserved", now: () => now };
  return { dependencies, ownership, candidates, creates };
}

function candidate(id: string): CoachCandidate { return { id, displayName: "Existing", createdAt: now, updatedAt: now }; }

describe("job-seeker candidate ownership", () => {
  it("rejects unauthenticated current-user resolution", async () => {
    authenticated = false;
    const result = await getCurrentJobSeekerCandidate(fixture().dependencies);
    expect(result).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    authenticated = true;
  });

  it("creates one minimal candidate for a new owner and reuses it", async () => {
    const f = fixture();
    const first = await getOrCreateOwnedCandidateForUser(userA, f.dependencies);
    const second = await getOrCreateOwnedCandidateForUser(userA, f.dependencies);
    expect(first.ok && first.value.id).toBe("candidate-reserved");
    expect(second.ok && second.value.id).toBe("candidate-reserved");
    expect(f.ownership).toHaveLength(1);
  });

  it("converges concurrent calls through the ownership reservation", async () => {
    const f = fixture();
    const results = await Promise.all([getOrCreateOwnedCandidateForUser(userA, f.dependencies), getOrCreateOwnedCandidateForUser(userA, f.dependencies)]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(new Set(results.filter((result) => result.ok).map((result) => result.value.id))).toEqual(new Set(["candidate-reserved"]));
    expect(f.ownership).toHaveLength(1);
  });

  it("prefers existing ownership and never creates a second candidate", async () => {
    const f = fixture({ ownership: [{ userId: userA.id, candidateId: "candidate-a", relationship: "owner", createdAt: now }], candidates: [candidate("candidate-a")] });
    const result = await getOrCreateOwnedCandidateForUser(userA, f.dependencies);
    expect(result.ok && result.value.id).toBe("candidate-a");
    expect(f.ownership).toHaveLength(1);
  });

  it("does not allow one user to acquire another user's candidate", async () => {
    const f = fixture({ ownership: [{ userId: userB.id, candidateId: "candidate-b", relationship: "owner", createdAt: now }], candidates: [candidate("candidate-b")] });
    const result = await getOrCreateOwnedCandidateForUser(userA, { ...f.dependencies, createId: () => "candidate-b" });
    expect(result.ok ? undefined : result.error.code).toBe("OWNERSHIP_CONFLICT");
  });

  it("fails closed on multiple ownership rows", async () => {
    const f = fixture({ ownership: [
      { userId: userA.id, candidateId: "candidate-a", relationship: "owner", createdAt: now },
      { userId: userA.id, candidateId: "candidate-b", relationship: "owner", createdAt: now },
    ], candidates: [candidate("candidate-a"), candidate("candidate-b")] });
    const result = await getOwnedCandidateForUser(userA.id, f.dependencies);
    expect(result.ok ? undefined : result.error.code).toBe("OWNERSHIP_INTEGRITY_FAILURE");
  });

  it("repairs an ownership reservation when the legacy candidate is missing", async () => {
    const f = fixture({ ownership: [{ userId: userA.id, candidateId: "candidate-reserved", relationship: "owner", createdAt: now }] });
    const result = await getOrCreateOwnedCandidateForUser(userA, f.dependencies);
    expect(result.ok && result.value.id).toBe("candidate-reserved");
    expect(f.candidates.has("candidate-reserved")).toBe(true);
  });

  it("reports candidate creation failure without claiming cross-store atomicity", async () => {
    const f = fixture({ createFails: true });
    const result = await getOrCreateOwnedCandidateForUser(userA, f.dependencies);
    expect(result.ok ? undefined : result.error.code).toBe("CANDIDATE_CREATION_FAILED");
    expect(f.ownership).toHaveLength(1);
  });

  it("rejects blank user IDs and never accepts a client candidate claim", async () => {
    const f = fixture();
    expect((await getOrCreateOwnedCandidateForUser({ ...userA, id: "" }, f.dependencies)).ok).toBe(false);
    expect(await getOwnedCandidateForUser("", f.dependencies)).toMatchObject({ ok: false, error: { code: "INVALID_USER_ID" } });
    expect(f.ownership).toHaveLength(0);
  });

  it("does not create profile or Base CV data", async () => {
    const f = fixture();
    const result = await getOrCreateOwnedCandidateForUser(userA, f.dependencies);
    expect(result.ok).toBe(true);
    expect(f.candidates.get("candidate-reserved")).toEqual({ id: "candidate-reserved", displayName: "User A", createdAt: now, updatedAt: now });
  });
});
