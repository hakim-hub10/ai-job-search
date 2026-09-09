import "server-only";

import { createHash } from "node:crypto";

import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import type { CandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-repository";
import {
  createCandidateBaseCvFromProfile,
  type CandidateBaseCv,
} from "./candidate-base-cv";
import type { CandidateBaseCvRepository } from "./candidate-base-cv-repository";

export type CandidateBaseCvRefreshAction = "add" | "no-op" | "conflict" | "unsupported";
export type CandidateBaseCvRefreshPath =
  | "headline"
  | "technicalSkills"
  | "softSkills"
  | "certifications"
  | "languages"
  | "workExperience"
  | "education";

export interface CandidateBaseCvRefreshPreviewEntry {
  claimPath: CandidateBaseCvRefreshPath;
  currentValue: unknown;
  proposedValue: unknown;
  action: CandidateBaseCvRefreshAction;
  reason?: string;
}

export interface CandidateBaseCvRefreshPreview {
  candidateId: string;
  baseCvFingerprint: string | null;
  profileFingerprint: string;
  creating: boolean;
  creationTimestamp?: string;
  changes: CandidateBaseCvRefreshPreviewEntry[];
}

export interface CandidateBaseCvRefreshReceipt {
  candidateId: string;
  baseCvFingerprintBefore: string | null;
  baseCvFingerprintAfter: string;
  appliedPaths: CandidateBaseCvRefreshPath[];
  noOpPaths: CandidateBaseCvRefreshPath[];
  conflictPaths: CandidateBaseCvRefreshPath[];
  unsupportedPaths: CandidateBaseCvRefreshPath[];
}

export type CandidateBaseCvRefreshErrorCode =
  | "INVALID_INPUT"
  | "PROFILE_NOT_FOUND"
  | "PROFILE_READ_FAILED"
  | "BASE_CV_NOT_FOUND"
  | "BASE_CV_READ_FAILED"
  | "CANDIDATE_MISMATCH"
  | "STALE_BASE_CV"
  | "STALE_PROFILE"
  | "PREVIEW_MISMATCH"
  | "CONFLICT_REQUIRES_CONFIRMATION"
  | "CREATION_REQUIRES_INPUT"
  | "BASE_CV_VALIDATION_FAILED"
  | "BASE_CV_SAVE_FAILED";

export type CandidateBaseCvRefreshResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: CandidateBaseCvRefreshErrorCode; message: string } };

const messages: Record<CandidateBaseCvRefreshErrorCode, string> = {
  INVALID_INPUT: "The Base CV refresh input is invalid.",
  PROFILE_NOT_FOUND: "The candidate profile was not found.",
  PROFILE_READ_FAILED: "The candidate profile could not be read.",
  BASE_CV_NOT_FOUND: "The Base CV was not found.",
  BASE_CV_READ_FAILED: "The Base CV could not be read.",
  CANDIDATE_MISMATCH: "The Base CV does not belong to the selected candidate.",
  STALE_BASE_CV: "The Base CV changed after the preview was created.",
  STALE_PROFILE: "The candidate profile changed after the preview was created.",
  PREVIEW_MISMATCH: "The Base CV preview is no longer valid.",
  CONFLICT_REQUIRES_CONFIRMATION: "A conflicting Base CV value requires explicit confirmation.",
  CREATION_REQUIRES_INPUT: "More candidate-controlled Base CV information is required.",
  BASE_CV_VALIDATION_FAILED: "The proposed Base CV is invalid.",
  BASE_CV_SAVE_FAILED: "The Base CV could not be saved.",
};

function failure<T>(code: CandidateBaseCvRefreshErrorCode): CandidateBaseCvRefreshResult<T> {
  return { ok: false, error: { code, message: messages[code] } };
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function listChanges<T>(
  path: CandidateBaseCvRefreshPath,
  current: T[],
  proposed: T[],
  key: (value: T) => string,
): CandidateBaseCvRefreshPreviewEntry[] {
  return proposed.map((value) => {
    const existing = current.some((item) => normalize(key(item)) === normalize(key(value)));
    return {
      claimPath: path,
      currentValue: current,
      proposedValue: value,
      action: existing ? "no-op" : "add",
    };
  });
}

export function candidateBaseCvFingerprint(baseCv: CandidateBaseCv): string {
  return createHash("sha256").update(JSON.stringify(baseCv)).digest("hex");
}

export function candidateProfileForBaseCvFingerprint(profile: CandidateProfile): string {
  return createHash("sha256").update(JSON.stringify(profile)).digest("hex");
}

function previewChanges(profile: CandidateProfile, baseCv: CandidateBaseCv | null): CandidateBaseCvRefreshPreviewEntry[] {
  if (!baseCv) {
    return [
      { claimPath: "headline", currentValue: null, proposedValue: profile.headline, action: "add" },
      ...listChanges("technicalSkills", [], profile.skills.technical, (value) => value),
      ...listChanges("softSkills", [], profile.skills.soft, (value) => value),
      ...listChanges("certifications", [], profile.certifications, (value) => value),
      ...listChanges("languages", [], profile.languages, (value) => `${value.name}:${value.level}`),
      ...listChanges("workExperience", [], profile.workExperience, (value) => JSON.stringify(value)),
      ...listChanges("education", [], profile.education, (value) => JSON.stringify(value)),
    ];
  }

  return [
    {
      claimPath: "headline",
      currentValue: baseCv.headline,
      proposedValue: profile.headline,
      action: normalize(baseCv.headline) === normalize(profile.headline) ? "no-op" : "conflict",
    },
    ...listChanges("technicalSkills", baseCv.technicalSkills, profile.skills.technical, (value) => value),
    ...listChanges("softSkills", baseCv.softSkills, profile.skills.soft, (value) => value),
    ...listChanges("certifications", baseCv.certifications, profile.certifications, (value) => value),
    ...listChanges("languages", baseCv.languages, profile.languages, (value) => `${value.name}:${value.level}`),
    ...listChanges("workExperience", baseCv.workExperience, profile.workExperience, (value) => JSON.stringify(value)),
    ...listChanges("education", baseCv.education, profile.education, (value) => JSON.stringify(value)),
  ];
}

function validInput(input: {
  candidateId: string;
  profile: CandidateProfile;
  baseCv: CandidateBaseCv | null;
}): boolean {
  return Boolean(input && input.candidateId.trim() && input.profile
    && (!input.baseCv || input.baseCv.candidateId === input.candidateId));
}

/** Builds a deterministic, non-mutating Base CV refresh preview. */
export function previewCandidateBaseCvRefresh(input: {
  candidateId: string;
  profile: CandidateProfile;
  baseCv: CandidateBaseCv | null;
  creationTimestamp?: string;
}): CandidateBaseCvRefreshResult<CandidateBaseCvRefreshPreview> {
  if (!validInput(input)) return failure("INVALID_INPUT");
  const creating = input.baseCv === null;
  if (creating && !input.creationTimestamp) return failure("CREATION_REQUIRES_INPUT");
  if (creating && !input.creationTimestamp?.trim()) return failure("CREATION_REQUIRES_INPUT");
  return {
    ok: true,
    value: {
      candidateId: input.candidateId,
      baseCvFingerprint: input.baseCv ? candidateBaseCvFingerprint(input.baseCv) : null,
      profileFingerprint: candidateProfileForBaseCvFingerprint(input.profile),
      creating,
      ...(creating ? { creationTimestamp: input.creationTimestamp } : {}),
      changes: previewChanges(input.profile, input.baseCv),
    },
  };
}

function samePreview(left: CandidateBaseCvRefreshPreview, right: CandidateBaseCvRefreshPreview): boolean {
  return equalJson(left, right);
}

function appendUnique<T>(target: T[], values: T[], key: (value: T) => string): void {
  for (const value of values) {
    if (!target.some((existing) => normalize(key(existing)) === normalize(key(value)))) target.push(structuredClone(value));
  }
}

function applyPreviewChanges(profile: CandidateProfile, baseCv: CandidateBaseCv | null, preview: CandidateBaseCvRefreshPreview, confirmations: Set<CandidateBaseCvRefreshPath>): CandidateBaseCvRefreshResult<CandidateBaseCv> {
  if (!baseCv) {
    const created = createCandidateBaseCvFromProfile(profile === undefined ? "" : preview.candidateId, profile, preview.creationTimestamp ?? "");
    if (!created.ok) return failure("BASE_CV_VALIDATION_FAILED");
    return { ok: true, value: created.value };
  }

  const next = structuredClone(baseCv);
  for (const change of preview.changes) {
    if (change.action === "conflict" && !confirmations.has(change.claimPath)) continue;
    if (change.action !== "add" && !(change.action === "conflict" && confirmations.has(change.claimPath))) continue;
    if (change.claimPath === "headline") next.headline = String(change.proposedValue);
    else if (change.claimPath === "technicalSkills") appendUnique(next.technicalSkills, [String(change.proposedValue)], (value) => value);
    else if (change.claimPath === "softSkills") appendUnique(next.softSkills, [String(change.proposedValue)], (value) => value);
    else if (change.claimPath === "certifications") appendUnique(next.certifications, [String(change.proposedValue)], (value) => value);
    else if (change.claimPath === "languages") appendUnique(next.languages, [change.proposedValue as CandidateBaseCv["languages"][number]], (value) => `${value.name}:${value.level}`);
    else if (change.claimPath === "workExperience") appendUnique(next.workExperience, [change.proposedValue as CandidateBaseCv["workExperience"][number]], (value) => JSON.stringify(value));
    else if (change.claimPath === "education") appendUnique(next.education, [change.proposedValue as CandidateBaseCv["education"][number]], (value) => JSON.stringify(value));
  }
  return { ok: true, value: next };
}

function repositoryError(code: string | undefined): CandidateBaseCvRefreshErrorCode {
  if (code === "NOT_FOUND") return "BASE_CV_NOT_FOUND";
  if (code === "READ_FAILURE" || code === "CORRUPT_STORAGE" || code === "UNSUPPORTED_SCHEMA_VERSION") return "BASE_CV_READ_FAILED";
  return "BASE_CV_SAVE_FAILED";
}

/** Loads current profile/Base CV, validates the preview, and saves once. */
export async function applyCandidateBaseCvRefresh(input: {
  candidateId: string;
  preview: CandidateBaseCvRefreshPreview;
  profileRepository: CandidateProfileRepository;
  baseCvRepository: CandidateBaseCvRepository;
  confirmConflictPaths?: CandidateBaseCvRefreshPath[];
}): Promise<CandidateBaseCvRefreshResult<CandidateBaseCvRefreshReceipt>> {
  if (!input || !input.candidateId.trim() || input.preview.candidateId !== input.candidateId) return failure("INVALID_INPUT");
  const profileResult = await input.profileRepository.getProfileByCandidateId(input.candidateId);
  if (!profileResult.ok) return failure(profileResult.error.code === "NOT_FOUND" ? "PROFILE_NOT_FOUND" : "PROFILE_READ_FAILED");
  if (profileResult.value.candidateId !== input.candidateId) return failure("CANDIDATE_MISMATCH");
  const baseResult = await input.baseCvRepository.getByCandidateId(input.candidateId);
  const currentBase = baseResult.ok ? baseResult.value : baseResult.error.code === "NOT_FOUND" ? null : null;
  if (!baseResult.ok && baseResult.error.code !== "NOT_FOUND") return failure(repositoryError(baseResult.error.code));
  if (currentBase && currentBase.candidateId !== input.candidateId) return failure("CANDIDATE_MISMATCH");

  const profile = profileResult.value.profile;
  if (candidateProfileForBaseCvFingerprint(profile) !== input.preview.profileFingerprint) return failure("STALE_PROFILE");
  const currentFingerprint = currentBase ? candidateBaseCvFingerprint(currentBase) : null;
  if (currentFingerprint !== input.preview.baseCvFingerprint) return failure("STALE_BASE_CV");
  const regenerated = previewCandidateBaseCvRefresh({ candidateId: input.candidateId, profile, baseCv: currentBase, creationTimestamp: input.preview.creationTimestamp });
  if (!regenerated.ok || !samePreview(regenerated.value, input.preview)) return failure("PREVIEW_MISMATCH");

  const confirmations = new Set(input.confirmConflictPaths ?? []);
  const conflicts = regenerated.value.changes.filter((change) => change.action === "conflict");
  if (conflicts.some((change) => !confirmations.has(change.claimPath))) return failure("CONFLICT_REQUIRES_CONFIRMATION");
  const next = applyPreviewChanges(profile, currentBase, regenerated.value, confirmations);
  if (!next.ok) return next;
  const saved = await input.baseCvRepository.save(next.value);
  if (!saved.ok) return failure(repositoryError(saved.error.code));
  const appliedPaths = regenerated.value.changes.filter((change) => change.action === "add" || (change.action === "conflict" && confirmations.has(change.claimPath))).map((change) => change.claimPath);
  const noOpPaths = regenerated.value.changes.filter((change) => change.action === "no-op").map((change) => change.claimPath);
  const conflictPaths = conflicts.map((change) => change.claimPath);
  const unsupportedPaths = regenerated.value.changes.filter((change) => change.action === "unsupported").map((change) => change.claimPath);
  return {
    ok: true,
    value: {
      candidateId: input.candidateId,
      baseCvFingerprintBefore: currentFingerprint,
      baseCvFingerprintAfter: candidateBaseCvFingerprint(saved.value),
      appliedPaths,
      noOpPaths,
      conflictPaths,
      unsupportedPaths,
    },
  };
}
