import "server-only";

import { createHash } from "node:crypto";

import type {
  CandidateImportClaim,
  CandidateImportClaimKind,
} from "./candidate-import-claims";

export const MAX_CANDIDATE_IMPORT_REVIEW_VALUE_LENGTH = 10_000;

export type CandidateImportReviewDecision =
  | "approved"
  | "edited-and-approved"
  | "rejected";

export interface ReviewedCandidateImportClaim {
  claim: CandidateImportClaim;
  originalValue: string;
  reviewedValue?: string;
  decision: CandidateImportReviewDecision;
}

export type CandidateImportReviewErrorCode =
  | "INVALID_INPUT"
  | "INVALID_CLAIM"
  | "INVALID_LINKAGE"
  | "INVALID_DECISION"
  | "INVALID_VALUE"
  | "STALE_CLAIM"
  | "UNKNOWN_CLAIM";

export type CandidateImportReviewResult =
  | { ok: true; value: ReviewedCandidateImportClaim }
  | { ok: false; error: { code: CandidateImportReviewErrorCode; message: string } };

const messages: Record<CandidateImportReviewErrorCode, string> = {
  INVALID_INPUT: "The review input is invalid.",
  INVALID_CLAIM: "The proposed claim is invalid.",
  INVALID_LINKAGE: "The review does not match the imported document.",
  INVALID_DECISION: "The review decision is invalid.",
  INVALID_VALUE: "The reviewed value is invalid.",
  STALE_CLAIM: "The proposed claim changed before it was reviewed.",
  UNKNOWN_CLAIM: "The proposed claim could not be found.",
};

function failure(code: CandidateImportReviewErrorCode): CandidateImportReviewResult {
  return { ok: false, error: { code, message: messages[code] } };
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isClaimKind(value: unknown): value is CandidateImportClaimKind {
  return typeof value === "string" && [
    "technicalSkill", "softSkill", "workExperience", "education",
    "certification", "language", "headline",
  ].includes(value);
}

function isDecision(value: unknown): value is CandidateImportReviewDecision {
  return value === "approved" || value === "edited-and-approved" || value === "rejected";
}

function validClaim(claim: unknown): claim is CandidateImportClaim {
  if (!claim || typeof claim !== "object") return false;
  const value = claim as CandidateImportClaim;
  return hasText(value.id) && hasText(value.candidateId) && hasText(value.importId)
    && hasText(value.documentId) && isClaimKind(value.kind)
    && hasText(value.value) && value.value.length <= MAX_CANDIDATE_IMPORT_REVIEW_VALUE_LENGTH
    && (value.source === "cv-text" || value.source === "user")
    && value.status === "proposed"
    && Boolean(value.provenance && typeof value.provenance === "object");
}

function linkageMatches(
  claim: CandidateImportClaim,
  linkage: { candidateId: string; importId: string; documentId: string },
): boolean {
  return hasText(linkage.candidateId) && hasText(linkage.importId) && hasText(linkage.documentId)
    && claim.candidateId === linkage.candidateId
    && claim.importId === linkage.importId
    && claim.documentId === linkage.documentId;
}

/** A stable snapshot token for the exact proposal shown to the reviewer. */
export function candidateImportClaimFingerprint(claim: CandidateImportClaim): string {
  const provenance = claim.provenance ?? {};
  return createHash("sha256").update(JSON.stringify([
    claim.id, claim.candidateId, claim.importId, claim.documentId, claim.kind,
    claim.value, claim.source, claim.status, provenance.section ?? null,
    provenance.snippet ?? null, provenance.line ?? null,
  ])).digest("hex");
}

function reviewedValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value.trim() : undefined;
}

/** Reviews one unchanged proposed claim without applying it to any profile. */
export function reviewCandidateImportClaim(input: {
  claim: CandidateImportClaim;
  linkage: { candidateId: string; importId: string; documentId: string };
  expectedOriginalValue: string;
  expectedFingerprint: string;
  decision: CandidateImportReviewDecision;
  reviewedValue?: string;
}): CandidateImportReviewResult {
  if (!input || !validClaim(input.claim) || !hasText(input.expectedOriginalValue)
    || !hasText(input.expectedFingerprint)) return failure("INVALID_INPUT");
  if (!linkageMatches(input.claim, input.linkage)) return failure("INVALID_LINKAGE");
  if (!isDecision(input.decision)) return failure("INVALID_DECISION");
  if (input.expectedOriginalValue !== input.claim.value
    || input.expectedFingerprint !== candidateImportClaimFingerprint(input.claim)) {
    return failure("STALE_CLAIM");
  }

  const value = reviewedValue(input.reviewedValue);
  if (input.decision === "edited-and-approved" && (!value || value === input.claim.value)) {
    return failure("INVALID_VALUE");
  }
  if (input.decision === "approved" && value !== undefined && !value) return failure("INVALID_VALUE");
  if (value !== undefined && value.length > MAX_CANDIDATE_IMPORT_REVIEW_VALUE_LENGTH) {
    return failure("INVALID_VALUE");
  }

  return {
    ok: true,
    value: {
      claim: structuredClone(input.claim),
      originalValue: input.claim.value,
      ...(value === undefined ? {} : { reviewedValue: value }),
      decision: input.decision,
    },
  };
}

/** Looks up a claim in the displayed set, protecting review from unknown IDs. */
export function reviewCandidateImportClaimSet(input: {
  claims: CandidateImportClaim[];
  claimId: string;
  linkage: { candidateId: string; importId: string; documentId: string };
  expectedOriginalValue: string;
  expectedFingerprint: string;
  decision: CandidateImportReviewDecision;
  reviewedValue?: string;
}): CandidateImportReviewResult {
  if (!input || !Array.isArray(input.claims) || !hasText(input.claimId)) return failure("INVALID_INPUT");
  const claim = input.claims.find((item) => item.id === input.claimId);
  if (!claim) return failure("UNKNOWN_CLAIM");
  return reviewCandidateImportClaim({ ...input, claim });
}

/** Re-reviews an existing decision explicitly; changed values cannot inherit approval. */
export function reviseCandidateImportClaim(input: {
  review: ReviewedCandidateImportClaim;
  linkage: { candidateId: string; importId: string; documentId: string };
  expectedCurrentValue: string;
  decision: CandidateImportReviewDecision;
  reviewedValue?: string;
}): CandidateImportReviewResult {
  if (!input || !input.review || !hasText(input.expectedCurrentValue)) return failure("INVALID_INPUT");
  const currentValue = input.review.reviewedValue ?? input.review.originalValue;
  if (input.expectedCurrentValue !== currentValue) return failure("STALE_CLAIM");
  const result = reviewCandidateImportClaim({
    claim: input.review.claim,
    linkage: input.linkage,
    expectedOriginalValue: input.review.originalValue,
    expectedFingerprint: candidateImportClaimFingerprint(input.review.claim),
    decision: input.decision,
    reviewedValue: input.reviewedValue,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    value: {
      ...result.value,
      ...(input.decision === "rejected" && input.review.reviewedValue
        ? { reviewedValue: input.review.reviewedValue }
        : {}),
    },
  };
}

/** Creates a user-provided proposal in the same claim taxonomy, without CV provenance. */
export function createUserAddedCandidateImportClaim(input: {
  candidateId: string;
  importId: string;
  documentId: string;
  kind: CandidateImportClaimKind;
  value: string;
}, scope: { candidateId: string; importId: string; documentId: string }):
  | { ok: true; value: CandidateImportClaim }
  | { ok: false; error: { code: CandidateImportReviewErrorCode; message: string } } {
  if (!input || !linkageMatches(input as CandidateImportClaim, scope)) return { ok: false, error: { code: "INVALID_LINKAGE", message: messages.INVALID_LINKAGE } };
  if (!isClaimKind(input.kind)) return { ok: false, error: { code: "INVALID_CLAIM", message: messages.INVALID_CLAIM } };
  const value = input.value.trim();
  if (!value || value.length > MAX_CANDIDATE_IMPORT_REVIEW_VALUE_LENGTH) return { ok: false, error: { code: "INVALID_VALUE", message: messages.INVALID_VALUE } };
  const id = `user-claim-${createHash("sha256").update(JSON.stringify([input.candidateId, input.importId, input.documentId, input.kind, value])).digest("hex").slice(0, 24)}`;
  return {
    ok: true,
    value: {
      id,
      candidateId: input.candidateId,
      importId: input.importId,
      documentId: input.documentId,
      kind: input.kind,
      value,
      source: "user",
      status: "proposed",
      provenance: {},
    },
  };
}
