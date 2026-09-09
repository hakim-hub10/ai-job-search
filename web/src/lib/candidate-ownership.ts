import "server-only";

export const CANDIDATE_OWNERSHIP_RELATIONSHIP = "owner" as const;

export interface CandidateOwnership {
  userId: string;
  candidateId: string;
  relationship: typeof CANDIDATE_OWNERSHIP_RELATIONSHIP;
  createdAt: string;
}

export type CandidateOwnershipErrorCode =
  | "INVALID_USER_ID"
  | "INVALID_CANDIDATE_ID"
  | "INVALID_RELATIONSHIP"
  | "INVALID_TIMESTAMP";

export type CandidateOwnershipResult =
  | { ok: true; value: CandidateOwnership }
  | { ok: false; error: { code: CandidateOwnershipErrorCode; message: string } };

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function timestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    && !Number.isNaN(Date.parse(value));
}

/** Pure validation for the future ownership persistence boundary. */
export function createCandidateOwnership(input: unknown): CandidateOwnershipResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: { code: "INVALID_USER_ID", message: "Ownership input is invalid." } };
  const value = input as Partial<CandidateOwnership>;
  if (!text(value.userId)) return { ok: false, error: { code: "INVALID_USER_ID", message: "Ownership user ID is required." } };
  if (!text(value.candidateId)) return { ok: false, error: { code: "INVALID_CANDIDATE_ID", message: "Ownership candidate ID is required." } };
  if (value.relationship !== CANDIDATE_OWNERSHIP_RELATIONSHIP) return { ok: false, error: { code: "INVALID_RELATIONSHIP", message: "Ownership relationship is not supported." } };
  if (!timestamp(value.createdAt)) return { ok: false, error: { code: "INVALID_TIMESTAMP", message: "Ownership timestamp is invalid." } };
  return { ok: true, value: { userId: value.userId, candidateId: value.candidateId, relationship: CANDIDATE_OWNERSHIP_RELATIONSHIP, createdAt: value.createdAt } };
}
