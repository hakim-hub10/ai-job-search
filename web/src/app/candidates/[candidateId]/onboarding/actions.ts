"use server";

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { createFileCoachWorkspaceRepository } from "../../../../../../.agents/job-search/cli/src/coach-workspace-file-repository";
import { resolveCoachRepositoryPaths } from "../../../../../../.agents/job-search/cli/src/coach-cli-paths";
import type { CandidateImportClaim, CandidateImportClaimKind } from "@/lib/candidate-import-claims";
import { extractCandidateImportClaims } from "@/lib/candidate-import-claims";
import { extractCandidateImportDocx } from "@/lib/candidate-import-docx";
import { extractCandidateImportPdf } from "@/lib/candidate-import-pdf";
import { validateCandidateImportUpload } from "@/lib/candidate-import-upload";
import { reviewCandidateImportClaim, createUserAddedCandidateImportClaim, candidateImportClaimFingerprint, type ReviewedCandidateImportClaim } from "@/lib/candidate-import-review";
import { applyCandidateImportProfile, previewCandidateImportProfile } from "@/lib/candidate-import-profile";
import { applyCandidateBaseCvRefresh, previewCandidateBaseCvRefresh } from "@/lib/candidate-import-base-cv";
import { createFileCandidateProfileRepository } from "../../../../../../.agents/job-search/cli/src/candidate-profile-file-repository";
import { createFileCandidateBaseCvRepository } from "@/lib/candidate-base-cv-file-repository";
import { configuredAuthorizationDependencies, requireOwnedCandidate } from "@/lib/authorization";

export type OnboardingActionResult =
  | { ok: true; claims: OnboardingClaimView[]; importId: string; documentId: string }
  | { ok: true; complete: true }
  | { ok: false; code: string; message: string };

function failure(code: string, message: string): OnboardingActionResult {
  return { ok: false, code, message };
}

export interface OnboardingClaimView {
  id: string;
  kind: CandidateImportClaimKind;
  value: string;
  source: "cv-text" | "user";
}

function toOnboardingClaimView(claim: CandidateImportClaim): OnboardingClaimView {
  return { id: claim.id, kind: claim.kind, value: claim.value, source: claim.source };
}

const CLAIM_SESSION_TTL_MS = 15 * 60 * 1000;
const MAX_CLAIM_SESSIONS = 100;

// Deliberately process-local for the local single-user app. Sessions expire and
// are bounded; a process restart simply requires the candidate to upload again.
const claimSessions = new Map<string, {
  candidateId: string;
  importId: string;
  documentId: string;
  claims: CandidateImportClaim[];
  createdAt: number;
}>();

function purgeClaimSessions(now = Date.now()): void {
  for (const [key, session] of claimSessions) {
    if (now - session.createdAt > CLAIM_SESSION_TTL_MS) claimSessions.delete(key);
  }
  while (claimSessions.size > MAX_CLAIM_SESSIONS) {
    const oldest = claimSessions.keys().next().value;
    if (!oldest) break;
    claimSessions.delete(oldest);
  }
}

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function friendlyExtractionError(code: string): string {
  if (code === "FILE_TOO_LARGE") return "CV:t är för stort. Använd en fil på högst 5 MB.";
  if (code === "UNSUPPORTED_FORMAT" || code === "FORMAT_MISMATCH") return "Använd en PDF- eller DOCX-fil.";
  if (code === "NO_EXTRACTABLE_TEXT") return "CV:t verkar inte innehålla läsbar text.";
  return "Filen kunde inte läsas. Välj en annan fil och försök igen.";
}

async function candidateContext(candidateId: string) {
  const coachDir = process.env.COACH_DIR?.trim();
  if (!coachDir || !candidateId) return null;
  const paths = resolveCoachRepositoryPaths(resolve(coachDir));
  const candidates = createFileCoachWorkspaceRepository(paths.candidates);
  const candidate = await candidates.getCandidateById(candidateId);
  return candidate.ok ? { coachDir, paths } : null;
}

async function authorizeCandidate(candidateId: string): Promise<boolean> {
  const dependencies = configuredAuthorizationDependencies();
  if (!dependencies.ok) return false;
  return (await requireOwnedCandidate(candidateId, dependencies.value)).ok;
}

export async function uploadCandidateOnboardingAction(formData: FormData): Promise<OnboardingActionResult> {
  purgeClaimSessions();
  const candidateId = text(formData.get("candidateId"));
  const file = formData.get("cv");
  if (!(await authorizeCandidate(candidateId))) return failure("FORBIDDEN", "Filen kunde inte läsas.");
  const context = await candidateContext(candidateId);
  if (!context) return failure("CANDIDATE_NOT_FOUND", "Kandidaten kunde inte hittas.");
  if (!(file instanceof File)) return failure("INVALID_FILE", "Välj ett CV att ladda upp.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const admission = validateCandidateImportUpload({ candidateId, filename: file.name, mimeType: file.type || undefined, bytes }, { id: candidateId });
  if (!admission.ok) return failure(admission.error.code, friendlyExtractionError(admission.error.code));

  const upload = { candidateId, filename: file.name, mimeType: file.type || undefined, bytes };
  const extraction = admission.value.document.format === "pdf"
    ? await extractCandidateImportPdf(upload, { id: candidateId })
    : await extractCandidateImportDocx(upload, { id: candidateId });
  if (!extraction.ok) return failure(extraction.error.code, friendlyExtractionError(extraction.error.code));

  const claims = await extractCandidateImportClaims({
    candidateId,
    importId: admission.value.id,
    documentId: admission.value.document.id,
    text: extraction.value.text,
  });
  if (!claims.ok) return failure(claims.error.code, "CV:t kunde inte tolkas. Försök med en annan fil.");
  const sessionKey = randomUUID();
  claimSessions.set(sessionKey, {
    candidateId,
    importId: admission.value.id,
    documentId: admission.value.document.id,
    claims: claims.value.claims,
    createdAt: Date.now(),
  });
  purgeClaimSessions();
  return {
    ok: true,
    claims: claims.value.claims.map(toOnboardingClaimView),
    importId: sessionKey,
    documentId: admission.value.document.id,
  };
}

function isKind(value: unknown): value is CandidateImportClaimKind {
  return ["technicalSkill", "softSkill", "certification", "language", "headline", "workExperience", "education"].includes(String(value));
}

function reconstructReviews(candidateId: string, input: unknown, session: {
  candidateId: string;
  importId: string;
  documentId: string;
  claims: CandidateImportClaim[];
}): ReviewedCandidateImportClaim[] | null {
  if (!Array.isArray(input)) return null;
  const reviews: ReviewedCandidateImportClaim[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") return null;
    const value = item as { claimId?: unknown; decision?: string; reviewedValue?: string };
    if (typeof value.claimId !== "string") return null;
    const claim = session.claims.find((candidateClaim) => candidateClaim.id === value.claimId);
    if (!claim || claim.candidateId !== candidateId || claim.importId !== session.importId || claim.documentId !== session.documentId || !isKind(claim.kind)) return null;
    const decision = value.decision;
    if (decision !== "approved" && decision !== "edited-and-approved" && decision !== "rejected") return null;
    const reviewed = reviewCandidateImportClaim({
      claim,
      linkage: { candidateId, importId: session.importId, documentId: session.documentId },
      expectedOriginalValue: claim.value,
      expectedFingerprint: candidateImportClaimFingerprint(claim),
      decision,
      reviewedValue: typeof value.reviewedValue === "string" ? value.reviewedValue : undefined,
    });
    if (!reviewed.ok) return null;
    reviews.push(reviewed.value);
  }
  return reviews;
}

export async function applyCandidateOnboardingAction(formData: FormData): Promise<OnboardingActionResult> {
  purgeClaimSessions();
  const candidateId = text(formData.get("candidateId"));
  const importId = text(formData.get("importId"));
  const documentId = text(formData.get("documentId"));
  if (!(await authorizeCandidate(candidateId))) return failure("FORBIDDEN", "Uppgifterna kunde inte sparas.");
  const context = await candidateContext(candidateId);
  if (!context || !importId || !documentId) return failure("INVALID_INPUT", "Uppgifterna kunde inte sparas.");
  const session = claimSessions.get(importId);
  if (!session || session.candidateId !== candidateId || session.documentId !== documentId) return failure("INVALID_REVIEW", "CV-granskningen kunde inte verifieras. Ladda upp CV:t igen.");
  let rawReviews: unknown;
  let rawAdded: unknown;
  try {
    rawReviews = JSON.parse(text(formData.get("reviews")) || "[]");
    rawAdded = JSON.parse(text(formData.get("added")) || "[]");
  } catch {
    return failure("INVALID_INPUT", "Kontrollera uppgifterna och försök igen.");
  }
  const linkage = { candidateId, importId: session.importId, documentId: session.documentId };
  const reviews = reconstructReviews(candidateId, rawReviews, session);
  if (!reviews) return failure("INVALID_REVIEW", "Kontrollera uppgifterna och försök igen.");
  if (!Array.isArray(rawAdded)) return failure("INVALID_REVIEW", "Kontrollera de tillagda uppgifterna.");
  for (const item of rawAdded) {
    if (!item || typeof item !== "object") return failure("INVALID_REVIEW", "Kontrollera de tillagda uppgifterna.");
    const added = item as { kind?: unknown; value?: unknown; decision?: unknown };
    if (!isKind(added.kind) || typeof added.value !== "string" || added.decision !== "approved") return failure("INVALID_REVIEW", "Kontrollera de tillagda uppgifterna.");
    const userClaim = createUserAddedCandidateImportClaim({ candidateId, importId: session.importId, documentId: session.documentId, kind: added.kind, value: added.value }, linkage);
    if (!userClaim.ok) return failure("INVALID_REVIEW", "Kontrollera de tillagda uppgifterna.");
    const reviewed = reviewCandidateImportClaim({ claim: userClaim.value, linkage, expectedOriginalValue: userClaim.value.value, expectedFingerprint: candidateImportClaimFingerprint(userClaim.value), decision: "approved" });
    if (!reviewed.ok) return failure("INVALID_REVIEW", "Kontrollera de tillagda uppgifterna.");
    reviews.push(reviewed.value);
  }

  const profileRepository = createFileCandidateProfileRepository(context.paths.candidateProfiles);
  const baseCvRepository = createFileCandidateBaseCvRepository(resolve(context.coachDir, "candidate-cvs.json"));
  const profile = await profileRepository.getProfileByCandidateId(candidateId);
  if (!profile.ok) return failure(profile.error.code === "NOT_FOUND" ? "PROFILE_NOT_FOUND" : "PROFILE_READ_FAILED", "Din profil kunde inte läsas.");
  const profilePreview = previewCandidateImportProfile({ candidateId, profile: profile.value.profile, reviews, linkage });
  if (!profilePreview.ok) return failure(profilePreview.error.code, "Uppgifterna kunde inte förhandsgranskas.");
  const confirmHeadline = formData.get("confirmHeadline") === "on";
  const profileApply = await applyCandidateImportProfile({ candidateId, reviews, linkage, preview: profilePreview.value, confirmConflictClaimIds: confirmHeadline ? reviews.filter((review) => review.claim.kind === "headline" && review.decision !== "rejected").map((review) => review.claim.id) : [], profileRepository });
  if (!profileApply.ok) return failure(profileApply.error.code, "Profilen kunde inte sparas. Inga ändringar bekräftades.");

  const updatedProfile = await profileRepository.getProfileByCandidateId(candidateId);
  if (!updatedProfile.ok) return failure("PROFILE_READ_FAILED", "Profilen kunde inte läsas efter sparandet.");
  const currentBase = await baseCvRepository.getByCandidateId(candidateId);
  if (!currentBase.ok && currentBase.error.code !== "NOT_FOUND") return failure("BASE_CV_READ_FAILED", "CV:t kunde inte läsas.");
  const basePreview = previewCandidateBaseCvRefresh({ candidateId, profile: updatedProfile.value.profile, baseCv: currentBase.ok ? currentBase.value : null, creationTimestamp: new Date().toISOString() });
  if (!basePreview.ok) return failure(basePreview.error.code, "CV:t kunde inte förhandsgranskas.");
  const baseApply = await applyCandidateBaseCvRefresh({ candidateId, preview: basePreview.value, confirmConflictPaths: confirmHeadline ? ["headline"] : [], profileRepository, baseCvRepository });
  if (!baseApply.ok) return failure(baseApply.error.code, "Profilen sparades, men CV:t kunde inte uppdateras ännu.");
  return { ok: true, complete: true };
}

export async function createOnboardingIdAction(): Promise<string> {
  return randomUUID();
}
