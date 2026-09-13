import "server-only";

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import type { CoachCandidate } from "../../../.agents/job-search/cli/src/coach-workspace";
import type { CoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-repository";
import { createCoachCandidate } from "../../../.agents/job-search/cli/src/coach-workspace";
import { createFileCoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-file-repository";
import { resolveCoachRepositoryPaths } from "../../../.agents/job-search/cli/src/coach-cli-paths";

import { getAuthDatabase } from "./auth-db";
import { requireAuthenticatedUser, type AuthenticatedUser } from "./auth-session";
import { CANDIDATE_OWNERSHIP_RELATIONSHIP, createCandidateOwnership, type CandidateOwnership } from "./candidate-ownership";

export type JobSeekerOwnershipErrorCode =
  | "UNAUTHENTICATED"
  | "INVALID_USER_ID"
  | "OWNERSHIP_STORAGE_FAILURE"
  | "OWNERSHIP_INTEGRITY_FAILURE"
  | "OWNERSHIP_CONFLICT"
  | "CANDIDATE_STORAGE_FAILURE"
  | "CANDIDATE_NOT_FOUND"
  | "CANDIDATE_CREATION_FAILED"
  | "CONFIGURATION_MISSING";

export type JobSeekerOwnershipResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: JobSeekerOwnershipErrorCode; message: string } };

export interface CandidateOwnershipStore {
  listByUserId(userId: string): Promise<JobSeekerOwnershipResult<CandidateOwnership[]>>;
  reserve(input: CandidateOwnership): Promise<JobSeekerOwnershipResult<{ reserved: boolean; ownership: CandidateOwnership }>>;
}

export interface JobSeekerOwnershipDependencies {
  ownershipStore: CandidateOwnershipStore;
  candidateRepository: CoachWorkspaceRepository;
  createId?: () => string;
  now?: () => string;
}

const messages: Record<JobSeekerOwnershipErrorCode, string> = {
  UNAUTHENTICATED: "Du måste vara inloggad.",
  INVALID_USER_ID: "Kontot kunde inte identifieras.",
  OWNERSHIP_STORAGE_FAILURE: "Ägarskapsinformationen kunde inte läsas.",
  OWNERSHIP_INTEGRITY_FAILURE: "Ägarskapsinformationen är inkonsekvent.",
  OWNERSHIP_CONFLICT: "Kontot kunde inte kopplas till kandidaten.",
  CANDIDATE_STORAGE_FAILURE: "Kandidatregistret kunde inte uppdateras.",
  CANDIDATE_NOT_FOUND: "Den ägda kandidaten kunde inte hittas.",
  CANDIDATE_CREATION_FAILED: "Kandidatens arbetsyta kunde inte skapas.",
  CONFIGURATION_MISSING: "Jobbcoachens arbetsyta är inte konfigurerad.",
};

function failure<T>(code: JobSeekerOwnershipErrorCode): JobSeekerOwnershipResult<T> {
  return { ok: false, error: { code, message: messages[code] } };
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function ownershipRow(value: Record<string, unknown>): CandidateOwnership | null {
  const timestamp = value.createdAt;
  if (timestamp instanceof Date && !Number.isFinite(timestamp.getTime())) return null;
  const result = createCandidateOwnership({
    ...value,
    createdAt: timestamp instanceof Date ? timestamp.toISOString() : timestamp,
  });
  return result.ok ? result.value : null;
}

function createDatabaseOwnershipStore(): CandidateOwnershipStore {
  return {
    async listByUserId(userId) {
      try {
        const result = await getAuthDatabase().query('SELECT "userId", "candidateId", "relationship", "createdAt" FROM "candidate_ownership" WHERE "userId" = $1 AND "relationship" = $2 ORDER BY "createdAt", "candidateId"', [userId, CANDIDATE_OWNERSHIP_RELATIONSHIP]);
        const rows = result.rows.map(ownershipRow);
        if (rows.some((row) => row === null)) return failure("OWNERSHIP_INTEGRITY_FAILURE");
        return { ok: true, value: rows as CandidateOwnership[] };
      } catch {
        return failure("OWNERSHIP_STORAGE_FAILURE");
      }
    },
    async reserve(input) {
      try {
        const inserted = await getAuthDatabase().query('INSERT INTO "candidate_ownership" ("userId", "candidateId", "relationship", "createdAt") VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING "userId", "candidateId", "relationship", "createdAt"', [input.userId, input.candidateId, input.relationship, input.createdAt]);
        if (inserted.rows.length === 1) {
          const ownership = ownershipRow(inserted.rows[0] as Record<string, unknown>);
          return ownership ? { ok: true, value: { reserved: true, ownership } } : failure("OWNERSHIP_INTEGRITY_FAILURE");
        }
        const existing = await this.listByUserId(input.userId);
        if (!existing.ok) return existing;
        if (existing.value.length !== 1) return failure(existing.value.length === 0 ? "OWNERSHIP_CONFLICT" : "OWNERSHIP_INTEGRITY_FAILURE");
        return { ok: true, value: { reserved: false, ownership: existing.value[0]! } };
      } catch {
        return failure("OWNERSHIP_STORAGE_FAILURE");
      }
    },
  };
}

export function configuredJobSeekerOwnershipDependencies(): JobSeekerOwnershipDependencies | JobSeekerOwnershipResult<never> {
  const coachDir = process.env.COACH_DIR?.trim();
  if (!coachDir) return failure("CONFIGURATION_MISSING");
  const paths = resolveCoachRepositoryPaths(resolve(coachDir));
  return { ownershipStore: createDatabaseOwnershipStore(), candidateRepository: createFileCoachWorkspaceRepository(paths.candidates) };
}

function displayName(user: AuthenticatedUser): string {
  return user.name.trim() || "Min kandidat";
}

async function resolveCandidate(ownership: CandidateOwnership, user: AuthenticatedUser, dependencies: JobSeekerOwnershipDependencies): Promise<JobSeekerOwnershipResult<CoachCandidate>> {
  const existing = await dependencies.candidateRepository.getCandidateById(ownership.candidateId);
  if (existing.ok) return { ok: true, value: existing.value };
  if (existing.error.code !== "NOT_FOUND") return failure("CANDIDATE_STORAGE_FAILURE");

  const now = dependencies.now?.() ?? new Date().toISOString();
  const candidate = createCoachCandidate({ id: ownership.candidateId, displayName: displayName(user), createdAt: now });
  if (!candidate.ok) return failure("CANDIDATE_CREATION_FAILED");
  const created = await dependencies.candidateRepository.createCandidate(candidate.value);
  if (created.ok) return created;
  if (created.error.code === "DUPLICATE_ID") {
    const repaired = await dependencies.candidateRepository.getCandidateById(ownership.candidateId);
    return repaired.ok ? repaired : failure("CANDIDATE_STORAGE_FAILURE");
  }
  return failure("CANDIDATE_CREATION_FAILED");
}

export async function getOwnedCandidateForUser(userId: string, dependencies?: JobSeekerOwnershipDependencies): Promise<JobSeekerOwnershipResult<CoachCandidate | null>> {
  if (!validText(userId)) return failure("INVALID_USER_ID");
  const resolved = dependencies ?? configuredJobSeekerOwnershipDependencies();
  if (!("ownershipStore" in resolved)) return resolved;
  const ownership = await resolved.ownershipStore.listByUserId(userId);
  if (!ownership.ok) return ownership;
  if (ownership.value.length === 0) return { ok: true, value: null };
  if (ownership.value.length !== 1) return failure("OWNERSHIP_INTEGRITY_FAILURE");
  const candidate = await resolved.candidateRepository.getCandidateById(ownership.value[0]!.candidateId);
  if (candidate.ok) return candidate;
  return candidate.error.code === "NOT_FOUND" ? failure("CANDIDATE_NOT_FOUND") : failure("CANDIDATE_STORAGE_FAILURE");
}

export async function getOrCreateOwnedCandidateForUser(user: AuthenticatedUser, dependencies?: JobSeekerOwnershipDependencies): Promise<JobSeekerOwnershipResult<CoachCandidate>> {
  if (!validText(user.id)) return failure("INVALID_USER_ID");
  const resolved = dependencies ?? configuredJobSeekerOwnershipDependencies();
  if (!("ownershipStore" in resolved)) return resolved;
  const existing = await getOwnedCandidateForUser(user.id, resolved);
  if (!existing.ok) {
    if (existing.error.code !== "CANDIDATE_NOT_FOUND") return existing;
    const rows = await resolved.ownershipStore.listByUserId(user.id);
    if (!rows.ok || rows.value.length !== 1) return failure(rows.ok ? "OWNERSHIP_INTEGRITY_FAILURE" : rows.error.code);
    return resolveCandidate(rows.value[0]!, user, resolved);
  }
  if (existing.value) return { ok: true, value: existing.value };

  const ownership = await resolved.ownershipStore.reserve({ userId: user.id, candidateId: resolved.createId?.() ?? randomUUID(), relationship: CANDIDATE_OWNERSHIP_RELATIONSHIP, createdAt: resolved.now?.() ?? new Date().toISOString() });
  if (!ownership.ok) return ownership;
  return resolveCandidate(ownership.value.ownership, user, resolved);
}

export async function getCurrentJobSeekerCandidate(dependencies?: JobSeekerOwnershipDependencies): Promise<JobSeekerOwnershipResult<{ user: AuthenticatedUser; candidate: CoachCandidate }>> {
  let user: AuthenticatedUser;
  try {
    user = await requireAuthenticatedUser();
  } catch {
    return failure("UNAUTHENTICATED");
  }
  const candidate = await getOrCreateOwnedCandidateForUser(user, dependencies);
  return candidate.ok ? { ok: true, value: { user, candidate: candidate.value } } : candidate;
}
