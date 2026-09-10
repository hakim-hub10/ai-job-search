import "server-only";

import type { CoachCandidate } from "../../../.agents/job-search/cli/src/coach-workspace";
import type { CandidateApplicationAssociation } from "../../../.agents/job-search/cli/src/coach-application-association";
import type { CandidateApplicationAssociationRepository } from "../../../.agents/job-search/cli/src/coach-application-association-repository";
import type { ApplicationRecord } from "../../../.agents/job-search/cli/src/applications";
import type { ApplicationRepository } from "../../../.agents/job-search/cli/src/application-repository";
import type { ApplicationDocumentRecord } from "../../../.agents/job-search/cli/src/application-document-repository";
import type { ApplicationDocumentRepository } from "../../../.agents/job-search/cli/src/application-document-repository";
import type { InterviewPreparationRecord } from "../../../.agents/job-search/cli/src/interview-preparation-repository";
import type { InterviewPreparationRepository } from "../../../.agents/job-search/cli/src/interview-preparation-repository";
import type { InterviewSession } from "../../../.agents/job-search/cli/src/interview-session";
import type { InterviewSessionRepository } from "../../../.agents/job-search/cli/src/interview-session-repository";

import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import type { CandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-repository";
import type { CandidateBaseCv } from "./candidate-base-cv";
import type { CandidateBaseCvRepository } from "./candidate-base-cv-repository";
import { getOwnedCandidateForUser, type JobSeekerOwnershipDependencies } from "./job-seeker-ownership";
import { requireAuthenticatedUser, type AuthenticatedUser } from "./auth-session";

export interface AuthorizedCandidateContext {
  user: Pick<AuthenticatedUser, "id" | "email">;
  candidate: Pick<CoachCandidate, "id" | "displayName">;
}

export type AuthorizationErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INTEGRITY_ERROR"
  | "STORAGE_ERROR";

export type AuthorizationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: AuthorizationErrorCode; message: string } };

export interface AuthorizationDependencies {
  ownership: JobSeekerOwnershipDependencies;
  applicationRepository?: ApplicationRepository;
  associationRepository?: CandidateApplicationAssociationRepository;
  documentRepository?: ApplicationDocumentRepository;
  preparationRepository?: InterviewPreparationRepository;
  sessionRepository?: Pick<InterviewSessionRepository, "getById">;
  profileRepository?: CandidateProfileRepository;
  baseCvRepository?: CandidateBaseCvRepository;
}

const messages: Record<AuthorizationErrorCode, string> = {
  UNAUTHENTICATED: "Du måste vara inloggad.",
  FORBIDDEN: "Resursen kunde inte hittas.",
  INTEGRITY_ERROR: "Resursen kunde inte verifieras.",
  STORAGE_ERROR: "Resursen kunde inte läsas.",
};

function failure<T>(code: AuthorizationErrorCode): AuthorizationResult<T> {
  return { ok: false, error: { code, message: messages[code] } };
}

function repoFailure<T>(code: string | undefined): AuthorizationResult<T> {
  return failure(code === "CORRUPT_STORAGE" || code === "READ_FAILURE" ? "STORAGE_ERROR" : "FORBIDDEN");
}

async function currentCandidate(dependencies: AuthorizationDependencies): Promise<AuthorizationResult<{ user: AuthenticatedUser; candidate: CoachCandidate }>> {
  let user: AuthenticatedUser;
  try {
    user = await requireAuthenticatedUser();
  } catch {
    return failure("UNAUTHENTICATED");
  }
  const owned = await getOwnedCandidateForUser(user.id, dependencies.ownership);
  if (!owned.ok) return owned.error.code === "CANDIDATE_NOT_FOUND" ? failure("FORBIDDEN") : failure(owned.error.code === "OWNERSHIP_INTEGRITY_FAILURE" ? "INTEGRITY_ERROR" : "STORAGE_ERROR");
  if (!owned.value) return failure("FORBIDDEN");
  return { ok: true, value: { user, candidate: owned.value } };
}

/** Resolves identity and ownership without creating or mutating anything. */
export async function getAuthorizedCandidateContext(dependencies: AuthorizationDependencies): Promise<AuthorizationResult<AuthorizedCandidateContext>> {
  const resolved = await currentCandidate(dependencies);
  if (!resolved.ok) return resolved;
  return { ok: true, value: { user: { id: resolved.value.user.id, email: resolved.value.user.email }, candidate: { id: resolved.value.candidate.id, displayName: resolved.value.candidate.displayName } } };
}

/** Candidate IDs are checked against the authenticated owner's candidate only. */
export async function requireOwnedCandidate(candidateId: string, dependencies: AuthorizationDependencies): Promise<AuthorizationResult<AuthorizedCandidateContext>> {
  if (typeof candidateId !== "string" || !candidateId.trim()) return failure("FORBIDDEN");
  const context = await getAuthorizedCandidateContext(dependencies);
  if (!context.ok) return context;
  return context.value.candidate.id === candidateId ? context : failure("FORBIDDEN");
}

async function ownedAssociation(applicationId: string, dependencies: AuthorizationDependencies): Promise<AuthorizationResult<{ context: AuthorizedCandidateContext; association: CandidateApplicationAssociation }>> {
  if (!dependencies.associationRepository || !dependencies.applicationRepository || typeof applicationId !== "string" || !applicationId.trim()) return failure("FORBIDDEN");
  const context = await getAuthorizedCandidateContext(dependencies);
  if (!context.ok) return context;
  const associations = await dependencies.associationRepository.listByCandidateId(context.value.candidate.id);
  if (!associations.ok) return repoFailure(associations.error.code);
  const matches = associations.value.filter((association) => association.applicationId === applicationId && association.candidateId === context.value.candidate.id);
  if (matches.length > 1) return failure("INTEGRITY_ERROR");
  if (matches.length === 0) return failure("FORBIDDEN");
  return { ok: true, value: { context: context.value, association: matches[0]! } };
}

export async function requireOwnedApplication(applicationId: string, dependencies: AuthorizationDependencies): Promise<AuthorizationResult<{ context: AuthorizedCandidateContext; application: ApplicationRecord; association: CandidateApplicationAssociation }>> {
  const association = await ownedAssociation(applicationId, dependencies);
  if (!association.ok) return association;
  const application = await dependencies.applicationRepository!.getById(applicationId);
  if (!application.ok) return repoFailure(application.error.code);
  return { ok: true, value: { ...association.value, application: application.value } };
}

export async function requireOwnedApplicationDocument(documentId: string, dependencies: AuthorizationDependencies): Promise<AuthorizationResult<{ context: AuthorizedCandidateContext; document: ApplicationDocumentRecord; application: ApplicationRecord }>> {
  if (!dependencies.documentRepository) return failure("FORBIDDEN");
  const document = await dependencies.documentRepository.getById(documentId);
  if (!document.ok) return repoFailure(document.error.code);
  const application = await requireOwnedApplication(document.value.applicationId, dependencies);
  if (!application.ok) return application;
  return { ok: true, value: { context: application.value.context, document: document.value, application: application.value.application } };
}

export async function requireOwnedInterviewPreparation(preparationId: string, dependencies: AuthorizationDependencies): Promise<AuthorizationResult<{ context: AuthorizedCandidateContext; preparation: InterviewPreparationRecord; application: ApplicationRecord }>> {
  if (!dependencies.preparationRepository) return failure("FORBIDDEN");
  const preparation = await dependencies.preparationRepository.getById(preparationId);
  if (!preparation.ok) return repoFailure(preparation.error.code);
  const application = await requireOwnedApplication(preparation.value.applicationId, dependencies);
  if (!application.ok) return application;
  if (preparation.value.candidateId !== application.value.context.candidate.id) return failure("INTEGRITY_ERROR");
  return { ok: true, value: { context: application.value.context, preparation: preparation.value, application: application.value.application } };
}

export async function requireOwnedInterviewSession(sessionId: string, applicationId: string, dependencies: AuthorizationDependencies): Promise<AuthorizationResult<{ context: AuthorizedCandidateContext; session: InterviewSession; application: ApplicationRecord }>> {
  if (!dependencies.sessionRepository) return failure("FORBIDDEN");
  const application = await requireOwnedApplication(applicationId, dependencies);
  if (!application.ok) return application;
  const session = await dependencies.sessionRepository.getById(sessionId);
  if (!session.ok) return repoFailure(session.error.code);
  if (session.value.applicationId !== applicationId) return failure("INTEGRITY_ERROR");
  return { ok: true, value: { context: application.value.context, session: session.value, application: application.value.application } };
}

export async function requireOwnedCandidateProfile(candidateId: string, dependencies: AuthorizationDependencies): Promise<AuthorizationResult<{ context: AuthorizedCandidateContext; profile: CandidateProfile }>> {
  if (!dependencies.profileRepository) return failure("FORBIDDEN");
  const context = await requireOwnedCandidate(candidateId, dependencies);
  if (!context.ok) return context;
  const profile = await dependencies.profileRepository.getProfileByCandidateId(context.value.candidate.id);
  if (!profile.ok) return repoFailure(profile.error.code);
  if (profile.value.candidateId !== context.value.candidate.id) return failure("INTEGRITY_ERROR");
  return { ok: true, value: { context: context.value, profile: profile.value.profile } };
}

export async function requireOwnedBaseCv(candidateId: string, dependencies: AuthorizationDependencies): Promise<AuthorizationResult<{ context: AuthorizedCandidateContext; baseCv: CandidateBaseCv }>> {
  if (!dependencies.baseCvRepository) return failure("FORBIDDEN");
  const context = await requireOwnedCandidate(candidateId, dependencies);
  if (!context.ok) return context;
  const baseCv = await dependencies.baseCvRepository.getByCandidateId(context.value.candidate.id);
  if (!baseCv.ok) return repoFailure(baseCv.error.code);
  if (baseCv.value.candidateId !== context.value.candidate.id) return failure("INTEGRITY_ERROR");
  return { ok: true, value: { context: context.value, baseCv: baseCv.value } };
}

export async function requireOwnedCandidateResource(candidateId: string, dependencies: AuthorizationDependencies): Promise<AuthorizationResult<AuthorizedCandidateContext>> {
  return requireOwnedCandidate(candidateId, dependencies);
}

export function denyMultiCandidateCoachAccess(): AuthorizationResult<never> {
  return failure("FORBIDDEN");
}
