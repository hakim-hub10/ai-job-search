import "server-only";

import { createHash } from "node:crypto";

import { parseCandidateProfile } from "../../../.agents/job-search/cli/src/profile-input";
import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import type { CandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-repository";
import type { CandidateImportClaimKind } from "./candidate-import-claims";
import type { ReviewedCandidateImportClaim } from "./candidate-import-review";

export const MAX_CANDIDATE_IMPORT_PROFILE_VALUE_LENGTH = 10_000;

type ProfileChangeAction = "add" | "no-op" | "conflict" | "unsupported";
type ProfileChangePath = "skills.technical" | "skills.soft" | "certifications" | "languages" | "headline" | "workExperience" | "education" | "projects";

export interface CandidateProfileChangePreviewEntry {
  claimId: string;
  path: ProfileChangePath;
  currentValue: unknown;
  proposedValue: unknown;
  action: ProfileChangeAction;
  reason?: string;
}

export interface CandidateProfileChangePreview {
  candidateId: string;
  profileFingerprint: string;
  changes: CandidateProfileChangePreviewEntry[];
}

export interface CandidateProfileApplyReceipt {
  candidateId: string;
  profileFingerprintBefore: string;
  profileFingerprintAfter: string;
  appliedClaimIds: string[];
  noOpClaimIds: string[];
  unsupportedClaimIds: string[];
  conflictClaimIds: string[];
  userAddedClaimIds: string[];
}

export type CandidateImportProfileErrorCode =
  | "INVALID_INPUT"
  | "INVALID_LINKAGE"
  | "INVALID_REVIEW"
  | "PROFILE_NOT_FOUND"
  | "PROFILE_READ_FAILED"
  | "STALE_PROFILE"
  | "PREVIEW_MISMATCH"
  | "CONFLICT_REQUIRES_CONFIRMATION"
  | "PROFILE_VALIDATION_FAILED"
  | "PROFILE_SAVE_FAILED";

export type CandidateImportProfileResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: CandidateImportProfileErrorCode; message: string } };

const messages: Record<CandidateImportProfileErrorCode, string> = {
  INVALID_INPUT: "The profile integration input is invalid.",
  INVALID_LINKAGE: "The reviewed claim does not belong to the selected import.",
  INVALID_REVIEW: "The reviewed claim is not eligible for profile application.",
  PROFILE_NOT_FOUND: "The candidate profile was not found.",
  PROFILE_READ_FAILED: "The candidate profile could not be read.",
  STALE_PROFILE: "The candidate profile changed after the preview was created.",
  PREVIEW_MISMATCH: "The supplied profile preview is no longer valid.",
  CONFLICT_REQUIRES_CONFIRMATION: "A conflicting profile value requires explicit confirmation.",
  PROFILE_VALIDATION_FAILED: "The proposed candidate profile is invalid.",
  PROFILE_SAVE_FAILED: "The candidate profile could not be saved.",
};

function failure<T>(code: CandidateImportProfileErrorCode): CandidateImportProfileResult<T> {
  return { ok: false, error: { code, message: messages[code] } };
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

function isClaimKind(value: unknown): value is CandidateImportClaimKind {
  return typeof value === "string" && [
    "technicalSkill", "softSkill", "workExperience", "education",
    "certification", "language", "headline", "project",
  ].includes(value);
}

function isReviewedClaim(value: unknown): value is ReviewedCandidateImportClaim {
  if (!value || typeof value !== "object") return false;
  const review = value as ReviewedCandidateImportClaim;
  const claim = review.claim;
  return Boolean(claim && typeof claim === "object")
    && hasText(claim.id) && hasText(claim.candidateId) && hasText(claim.importId)
    && hasText(claim.documentId) && isClaimKind(claim.kind)
    && hasText(claim.value) && claim.value.length <= MAX_CANDIDATE_IMPORT_PROFILE_VALUE_LENGTH
    && (claim.source === "cv-text" || claim.source === "user")
    && claim.status === "proposed"
    && hasText(review.originalValue) && review.originalValue === claim.value
    && (review.decision === "approved" || review.decision === "edited-and-approved" || review.decision === "rejected")
    && (review.reviewedValue === undefined || (typeof review.reviewedValue === "string"
      && review.reviewedValue.trim().length > 0
      && review.reviewedValue.length <= MAX_CANDIDATE_IMPORT_PROFILE_VALUE_LENGTH));
}

function linkageMatches(review: ReviewedCandidateImportClaim, linkage: { candidateId: string; importId: string; documentId: string }): boolean {
  return hasText(linkage.candidateId) && hasText(linkage.importId) && hasText(linkage.documentId)
    && review.claim.candidateId === linkage.candidateId
    && review.claim.importId === linkage.importId
    && review.claim.documentId === linkage.documentId;
}

function valueForReview(review: ReviewedCandidateImportClaim): string | null {
  if (review.decision === "rejected") return null;
  if (review.decision === "edited-and-approved") return hasText(review.reviewedValue) ? review.reviewedValue.trim() : null;
  return (review.reviewedValue ?? review.originalValue).trim() || null;
}

function languageValue(value: string): CandidateProfile["languages"][number] | null {
  const match = /^(.+?)\s*(?:\(([^()]+)\)|[-:]\s+(.+))$/u.exec(value.trim());
  if (!match) return null;
  const name = match[1]?.trim();
  const level = (match[2] ?? match[3])?.trim();
  return name && level ? { name, level } : null;
}

function entry(
  claimId: string,
  path: ProfileChangePath,
  currentValue: unknown,
  proposedValue: unknown,
  action: ProfileChangeAction,
  reason?: string,
): CandidateProfileChangePreviewEntry {
  return { claimId, path, currentValue, proposedValue, action, ...(reason ? { reason } : {}) };
}

function listChange(
  review: ReviewedCandidateImportClaim,
  path: "skills.technical" | "skills.soft" | "certifications",
  current: string[],
): CandidateProfileChangePreviewEntry {
  const proposed = valueForReview(review);
  if (!proposed) return entry(review.claim.id, path, current, null, "unsupported", "EMPTY_APPROVED_VALUE");
  const action = current.some((value) => normalize(value) === normalize(proposed)) ? "no-op" : "add";
  return entry(review.claim.id, path, current, proposed, action);
}

function changeForReview(review: ReviewedCandidateImportClaim, profile: CandidateProfile): CandidateProfileChangePreviewEntry {
  const proposed = valueForReview(review);
  if (!proposed) return entry(review.claim.id, "headline", profile.headline, null, "unsupported", "EMPTY_APPROVED_VALUE");
  switch (review.claim.kind) {
    case "technicalSkill": return listChange(review, "skills.technical", profile.skills.technical);
    case "softSkill": return listChange(review, "skills.soft", profile.skills.soft);
    case "certification": return listChange(review, "certifications", profile.certifications);
    case "language": {
      const language = languageValue(proposed);
      if (!language) return entry(review.claim.id, "languages", profile.languages, proposed, "unsupported", "EXPLICIT_LANGUAGE_LEVEL_REQUIRED");
      const action = profile.languages.some((current) => normalize(current.name) === normalize(language.name) && normalize(current.level) === normalize(language.level)) ? "no-op" : "add";
      return entry(review.claim.id, "languages", profile.languages, language, action);
    }
    case "headline":
      return entry(review.claim.id, "headline", profile.headline, proposed, normalize(profile.headline) === normalize(proposed) ? "no-op" : "conflict");
    case "workExperience":
      return entry(review.claim.id, "workExperience", profile.workExperience, proposed, "unsupported", "EXPLICIT_STRUCTURED_WORK_EXPERIENCE_REQUIRED");
    case "education":
      return entry(review.claim.id, "education", profile.education, proposed, "unsupported", "EXPLICIT_STRUCTURED_EDUCATION_REQUIRED");
    case "project":
      // A raw imported line is, at most, a plausible project title - never
      // enough to safely infer a description, technologies, or URL. Same
      // boundary as workExperience/education: the candidate completes and
      // approves a structured project entry explicitly in the profile UI.
      return entry(review.claim.id, "projects", profile.projects ?? [], proposed, "unsupported", "EXPLICIT_STRUCTURED_PROJECT_REQUIRED");
  }
}

function validateInputs(
  candidateId: string,
  reviews: ReviewedCandidateImportClaim[],
  linkage: { candidateId: string; importId: string; documentId: string },
): CandidateImportProfileResult<void> {
  if (!hasText(candidateId) || !Array.isArray(reviews)
    || !hasText(linkage.candidateId) || !hasText(linkage.importId) || !hasText(linkage.documentId)) return failure("INVALID_INPUT");
  if (linkage.candidateId !== candidateId) return failure("INVALID_LINKAGE");
  for (const review of reviews) {
    if (!isReviewedClaim(review)) return failure("INVALID_REVIEW");
    if (!linkageMatches(review, linkage) || review.claim.candidateId !== candidateId) return failure("INVALID_LINKAGE");
    if (review.decision !== "rejected" && !valueForReview(review)) return failure("INVALID_REVIEW");
  }
  return { ok: true, value: undefined };
}

export function candidateProfileFingerprint(profile: CandidateProfile): string {
  return createHash("sha256").update(JSON.stringify(profile)).digest("hex");
}

/** Builds a deterministic, non-mutating preview from reviewed claims. */
export function previewCandidateImportProfile(input: {
  candidateId: string;
  profile: CandidateProfile;
  reviews: ReviewedCandidateImportClaim[];
  linkage: { candidateId: string; importId: string; documentId: string };
}): CandidateImportProfileResult<CandidateProfileChangePreview> {
  if (!input || !input.profile) return failure("INVALID_INPUT");
  const valid = validateInputs(input.candidateId, input.reviews, input.linkage);
  if (!valid.ok) return valid;
  return {
    ok: true,
    value: {
      candidateId: input.candidateId,
      profileFingerprint: candidateProfileFingerprint(input.profile),
      changes: input.reviews.map((review) => review.decision === "rejected"
        ? entry(review.claim.id, "headline", null, null, "unsupported", "REJECTED_CLAIM")
        : changeForReview(review, input.profile)),
    },
  };
}

function samePreview(a: CandidateProfileChangePreview, b: CandidateProfileChangePreview): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function profileRepositoryError(code: string | undefined): CandidateImportProfileErrorCode {
  return code === "NOT_FOUND" ? "PROFILE_NOT_FOUND" : "PROFILE_READ_FAILED";
}

/** Applies one validated preview with one atomic repository save. */
export async function applyCandidateImportProfile(input: {
  candidateId: string;
  reviews: ReviewedCandidateImportClaim[];
  linkage: { candidateId: string; importId: string; documentId: string };
  preview: CandidateProfileChangePreview;
  confirmConflictClaimIds?: string[];
  profileRepository: CandidateProfileRepository;
}): Promise<CandidateImportProfileResult<CandidateProfileApplyReceipt>> {
  if (!input || !input.profileRepository || !input.preview || input.preview.candidateId !== input.candidateId) return failure("INVALID_INPUT");
  const valid = validateInputs(input.candidateId, input.reviews, input.linkage);
  if (!valid.ok) return valid;
  const loaded = await input.profileRepository.getProfileByCandidateId(input.candidateId);
  if (!loaded.ok) return failure(profileRepositoryError(loaded.error.code));
  if (loaded.value.candidateId !== input.candidateId) return failure("INVALID_LINKAGE");

  const current = loaded.value.profile;
  const before = candidateProfileFingerprint(current);
  if (before !== input.preview.profileFingerprint) return failure("STALE_PROFILE");
  const regenerated = previewCandidateImportProfile({ candidateId: input.candidateId, profile: current, reviews: input.reviews, linkage: input.linkage });
  if (!regenerated.ok) return regenerated;
  if (!samePreview(regenerated.value, input.preview)) return failure("PREVIEW_MISMATCH");

  const confirmations = new Set(input.confirmConflictClaimIds ?? []);
  const unresolvedConflicts = regenerated.value.changes.filter((change) => change.action === "conflict" && !confirmations.has(change.claimId)).map((change) => change.claimId);
  if (unresolvedConflicts.length > 0) return failure("CONFLICT_REQUIRES_CONFIRMATION");

  const next = structuredClone(current);
  const appliedClaimIds: string[] = [];
  const noOpClaimIds: string[] = [];
  const unsupportedClaimIds: string[] = [];
  const conflictClaimIds: string[] = [];
  const userAddedClaimIds: string[] = [];

  for (const change of regenerated.value.changes) {
    const review = input.reviews.find((item) => item.claim.id === change.claimId)!;
    if (change.action === "unsupported") { unsupportedClaimIds.push(change.claimId); continue; }
    if (change.action === "no-op") { noOpClaimIds.push(change.claimId); continue; }
    if (change.action === "conflict") {
      conflictClaimIds.push(change.claimId);
      if (!confirmations.has(change.claimId)) continue;
      next.headline = String(change.proposedValue);
    } else if (change.path === "skills.technical") next.skills.technical.push(String(change.proposedValue));
    else if (change.path === "skills.soft") next.skills.soft.push(String(change.proposedValue));
    else if (change.path === "certifications") next.certifications.push(String(change.proposedValue));
    else if (change.path === "languages") next.languages.push(change.proposedValue as CandidateProfile["languages"][number]);
    else continue;
    appliedClaimIds.push(change.claimId);
    if (review.claim.source === "user") userAddedClaimIds.push(change.claimId);
  }

  let parsed: CandidateProfile;
  try {
    parsed = parseCandidateProfile(next);
  } catch {
    return failure("PROFILE_VALIDATION_FAILED");
  }
  const saved = await input.profileRepository.saveProfile(input.candidateId, parsed);
  if (!saved.ok) return failure("PROFILE_SAVE_FAILED");
  return {
    ok: true,
    value: {
      candidateId: input.candidateId,
      profileFingerprintBefore: before,
      profileFingerprintAfter: candidateProfileFingerprint(saved.value.profile),
      appliedClaimIds,
      noOpClaimIds,
      unsupportedClaimIds,
      conflictClaimIds,
      userAddedClaimIds,
    },
  };
}
