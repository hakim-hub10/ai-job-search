import "server-only";
import { resolve } from "node:path";
import { createFileApplicationRepository } from "../../../.agents/job-search/cli/src/application-file-repository";
import type { ApplicationRepository } from "../../../.agents/job-search/cli/src/application-repository";
import { buildApplicationDocumentFoundation, buildCandidateEvidenceCatalog, type CandidateDocumentEvidence } from "../../../.agents/job-search/cli/src/application-documents";
import { createFileCandidateApplicationAssociationRepository } from "../../../.agents/job-search/cli/src/coach-application-association-file-repository";
import type { CandidateApplicationAssociationRepository } from "../../../.agents/job-search/cli/src/coach-application-association-repository";
import { resolveCoachRepositoryPaths } from "../../../.agents/job-search/cli/src/coach-cli-paths";
import { createFileCoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-file-repository";
import type { CoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-repository";
import { createFileCandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-file-repository";
import type { CandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-repository";
import { createInterviewPreparationPlan, type InterviewType, type StarPreparationPrompt } from "../../../.agents/job-search/cli/src/interview-preparation";
import { createFileInterviewPreparationRepository } from "../../../.agents/job-search/cli/src/interview-preparation-file-repository";
import type { InterviewPreparationRecord, InterviewPreparationRepository } from "../../../.agents/job-search/cli/src/interview-preparation-repository";
import { isInterviewPreparationRecord } from "../../../.agents/job-search/cli/src/interview-preparation-storage-validation";
import { createRequirementIdentity } from "../../../.agents/job-search/cli/src/requirements";
import { preparationError } from "./interview-preparation-presentation";

export type PreparationErrorCode = "CONFIGURATION_MISSING" | "INVALID_REQUEST" | "APPLICATION_NOT_FOUND" | "ASSOCIATION_NOT_FOUND" | "CANDIDATE_PROFILE_NOT_FOUND" | "PREPARATION_NOT_FOUND" | "INVALID_PREPARATION_DATA" | "REPOSITORY_ERROR" | "PREPARATION_CREATION_FAILED";
export type PreparationResult<T> = { ok: true; value: T } | { ok: false; code: PreparationErrorCode; message: string };
export interface PreparationSummary {
  preparationId: string; applicationId: string; jobTitle: string; company: string | null;
  language: "sv" | "en"; interviewType: InterviewType; questionCount: number;
}
export interface PreparationDetail extends PreparationSummary {
  questions: {
    id: string; prompt: string; rationale: string;
    requirements: { key: string; label: string; status: string; source: "job" | "candidate" }[];
    evidence: { id: string; content: string; role?: string; employer?: string }[];
    starPrompts: Omit<StarPreparationPrompt, "questionId" | "evidenceIds">[];
  }[];
  warnings: { code: string; requirementLabel?: string }[];
}
export interface PreparationList {
  applicationId: string; jobTitle: string; company: string | null; preparations: PreparationSummary[];
}
export interface PreparationReadDependencies {
  applicationRepository: Pick<ApplicationRepository, "getById">;
  preparationRepository: Pick<InterviewPreparationRepository, "getById" | "listByApplicationId">;
}
export interface PreparationCreateDependencies extends PreparationReadDependencies {
  preparationRepository: InterviewPreparationRepository;
  associationRepository: Pick<CandidateApplicationAssociationRepository, "getByApplicationId">;
  candidateRepository: Pick<CoachWorkspaceRepository, "getCandidateById">;
  profileRepository: Pick<CandidateProfileRepository, "getProfileByCandidateId">;
}
function failure(code: PreparationErrorCode): { ok: false; code: PreparationErrorCode; message: string } {
  return { ok: false, code, message: preparationError(code) };
}
function validId(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function repositoryFailure(code: string) {
  return failure(["INVALID_RECORD", "CORRUPT_STORAGE", "UNSUPPORTED_SCHEMA_VERSION"].includes(code) ? "INVALID_PREPARATION_DATA" : "REPOSITORY_ERROR");
}
function configuredReads(): PreparationReadDependencies | null {
  const app = process.env.APPLICATION_REPOSITORY;
  const prep = process.env.INTERVIEW_PREPARATION_REPOSITORY;
  if (!app?.trim() || !prep?.trim()) return null;
  return { applicationRepository: createFileApplicationRepository(resolve(app)), preparationRepository: createFileInterviewPreparationRepository(resolve(prep)) };
}
function configuredCreate(): PreparationCreateDependencies | null {
  const reads = configuredReads();
  const coach = process.env.COACH_DIR;
  const prep = process.env.INTERVIEW_PREPARATION_REPOSITORY;
  if (!reads || !coach?.trim() || !prep?.trim()) return null;
  const paths = resolveCoachRepositoryPaths(resolve(coach));
  return { ...reads, preparationRepository: createFileInterviewPreparationRepository(resolve(prep)),
    associationRepository: createFileCandidateApplicationAssociationRepository(paths.associations),
    candidateRepository: createFileCoachWorkspaceRepository(paths.candidates),
    profileRepository: createFileCandidateProfileRepository(paths.candidateProfiles) };
}
async function loadApplication(id: string, deps: PreparationReadDependencies) {
  const result = await deps.applicationRepository.getById(id);
  if (!result.ok) return result.error.code === "NOT_FOUND" ? failure("APPLICATION_NOT_FOUND") : repositoryFailure(result.error.code);
  if (result.value?.id !== id || !validId(result.value.jobSnapshot?.title)
    || !(result.value.jobSnapshot.company === null || typeof result.value.jobSnapshot.company === "string")) return failure("INVALID_PREPARATION_DATA");
  return result;
}
function summary(record: InterviewPreparationRecord): PreparationSummary {
  return { preparationId: record.id, applicationId: record.applicationId, jobTitle: record.plan.job.jobTitle,
    company: record.plan.job.company, language: record.plan.language, interviewType: record.plan.interviewType, questionCount: record.plan.questions.length };
}
/** Only referenced career evidence reaches the view; no profile/identity or storage metadata. */
export function preparationDetailModel(record: InterviewPreparationRecord): PreparationDetail {
  const contexts = new Map(record.requirementContext.map((c) => [c.requirement.identity.key, c]));
  const evidence = new Map(record.evidenceSnapshot.map((e) => [e.id, e]));
  return { ...summary(record), questions: record.plan.questions.map((q) => ({
    id: q.id, prompt: q.prompt, rationale: q.rationale,
    requirements: q.requirementKeys.map((key) => {
      const context = contexts.get(key);
      const candidateReference = q.evidenceIds.flatMap((id) => evidence.get(id)?.relatedRequirements ?? [])
        .find((r) => createRequirementIdentity(r.category, r.value).key === key);
      return { key, label: context?.requirement.identity.original ?? candidateReference?.value ?? "Kravuppgift saknas",
        status: context?.status ?? "unknown", source: context ? "job" as const : "candidate" as const };
    }),
    evidence: q.evidenceIds.flatMap((id) => {
      const e = evidence.get(id);
      return e && e.kind !== "identity" ? [{ id, content: e.content,
        ...(e.context?.role ? { role: e.context.role } : {}), ...(e.context?.employer ? { employer: e.context.employer } : {}) }] : [];
    }),
    starPrompts: record.plan.starPrompts.filter((s) => s.questionId === q.id).map((s) => ({
      situationPrompt: s.situationPrompt, taskPrompt: s.taskPrompt, actionPrompt: s.actionPrompt, resultPrompt: s.resultPrompt, warnings: [...s.warnings],
    })),
  })), warnings: record.plan.warnings.map((w) => ({ code: w.code,
    ...(w.requirementKey ? { requirementLabel: contexts.get(w.requirementKey)?.requirement.identity.original } : {}) })) };
}

// The core file store requires serialized writes. This queue covers this web
// process; deployments must still have a single writer for each store.
let pendingWrite: Promise<unknown> = Promise.resolve();
function persist(repository: InterviewPreparationRepository, record: InterviewPreparationRecord) {
  const write = pendingWrite.then(() => repository.create(record));
  pendingWrite = write.catch(() => undefined);
  return write;
}

export async function createApplicationInterviewPreparation(input: {
  applicationId: unknown; language: unknown; interviewType: unknown;
}, dependencies?: PreparationCreateDependencies): Promise<PreparationResult<PreparationDetail>> {
  if (!validId(input.applicationId) || (input.language !== "sv" && input.language !== "en")
    || typeof input.interviewType !== "string" || !["recruiterScreening", "hiringManager", "behavioral", "roleSpecific", "situational"].includes(input.interviewType)) return failure("INVALID_REQUEST");
  const { applicationId, language } = input;
  const interviewType = input.interviewType as InterviewType;
  try {
    const deps = dependencies ?? configuredCreate();
    if (!deps) return failure("CONFIGURATION_MISSING");
    const application = await loadApplication(applicationId, deps);
    if (!application.ok) return application;
    const association = await deps.associationRepository.getByApplicationId(applicationId);
    if (!association.ok) return association.error.code === "NOT_FOUND" ? failure("ASSOCIATION_NOT_FOUND") : repositoryFailure(association.error.code);
    const candidateId = association.value.candidateId;
    if (association.value.applicationId !== applicationId || !validId(candidateId)) return failure("INVALID_PREPARATION_DATA");
    const candidate = await deps.candidateRepository.getCandidateById(candidateId);
    if (!candidate.ok) return candidate.error.code === "NOT_FOUND" ? failure("CANDIDATE_PROFILE_NOT_FOUND") : repositoryFailure(candidate.error.code);
    if (candidate.value.id !== candidateId) return failure("INVALID_PREPARATION_DATA");
    const profile = await deps.profileRepository.getProfileByCandidateId(candidateId);
    if (!profile.ok) return profile.error.code === "NOT_FOUND" ? failure("CANDIDATE_PROFILE_NOT_FOUND") : repositoryFailure(profile.error.code);
    if (profile.value.candidateId !== candidateId) return failure("INVALID_PREPARATION_DATA");
    // This profile repository is the verified career-fact boundary. Convert via
    // the core catalog, then pass explicit evidence into Phase 5, never a CV.
    const catalog = buildCandidateEvidenceCatalog({ matchingProfile: profile.value.profile });
    if (!catalog.ok) return failure("PREPARATION_CREATION_FAILED");
    const evidenceSnapshot: CandidateDocumentEvidence[] = catalog.value.evidence.map((e) => ({
      id: e.id, kind: e.kind, content: e.content,
      ...(e.relatedRequirements ? { relatedRequirements: structuredClone(e.relatedRequirements) } : {}),
      // Core profile conversion retains absent dates as undefined; omit these
      // optional properties to meet the immutable storage schema.
      ...(e.context ? { context: Object.fromEntries(Object.entries(e.context).filter(([, v]) => v !== undefined)) } : {}),
    }));
    const documentInput = { evidence: evidenceSnapshot };
    const foundation = buildApplicationDocumentFoundation(application.value, documentInput);
    const plan = createInterviewPreparationPlan(application.value, documentInput, { language, interviewType });
    if (!foundation.ok || !plan.ok) return failure("PREPARATION_CREATION_FAILED");
    const record: InterviewPreparationRecord = { id: crypto.randomUUID(), applicationId, candidateId,
      plan: plan.value, evidenceSnapshot, requirementContext: foundation.value.requirements };
    if (!isInterviewPreparationRecord(record)) return failure("INVALID_PREPARATION_DATA");
    const saved = await persist(deps.preparationRepository, record);
    if (!saved.ok) return repositoryFailure(saved.error.code);
    if (!isInterviewPreparationRecord(saved.value) || JSON.stringify(saved.value) !== JSON.stringify(record)) return failure("INVALID_PREPARATION_DATA");
    return { ok: true, value: preparationDetailModel(saved.value) };
  } catch { return failure("REPOSITORY_ERROR"); }
}

export async function listApplicationInterviewPreparations(applicationId: string, dependencies?: PreparationReadDependencies): Promise<PreparationResult<PreparationList>> {
  if (!validId(applicationId)) return failure("INVALID_REQUEST");
  try {
    const deps = dependencies ?? configuredReads();
    if (!deps) return failure("CONFIGURATION_MISSING");
    const app = await loadApplication(applicationId, deps);
    if (!app.ok) return app;
    const records = await deps.preparationRepository.listByApplicationId(applicationId);
    if (!records.ok) return repositoryFailure(records.error.code);
    if (!Array.isArray(records.value)) return failure("INVALID_PREPARATION_DATA");
    const ids = new Set<string>();
    for (const record of records.value) {
      if (!isInterviewPreparationRecord(record) || record.applicationId !== applicationId || ids.has(record.id)) return failure("INVALID_PREPARATION_DATA");
      ids.add(record.id);
    }
    return { ok: true, value: { applicationId, jobTitle: app.value.jobSnapshot.title, company: app.value.jobSnapshot.company, preparations: records.value.map(summary) } };
  } catch { return failure("REPOSITORY_ERROR"); }
}

export async function loadApplicationInterviewPreparation(applicationId: string, preparationId: string, dependencies?: PreparationReadDependencies): Promise<PreparationResult<PreparationDetail>> {
  if (!validId(applicationId) || !validId(preparationId)) return failure("INVALID_REQUEST");
  try {
    const deps = dependencies ?? configuredReads();
    if (!deps) return failure("CONFIGURATION_MISSING");
    const app = await loadApplication(applicationId, deps);
    if (!app.ok) return app;
    const record = await deps.preparationRepository.getById(preparationId);
    if (!record.ok) return record.error.code === "NOT_FOUND" ? failure("PREPARATION_NOT_FOUND") : repositoryFailure(record.error.code);
    if (!isInterviewPreparationRecord(record.value) || record.value.id !== preparationId) return failure("INVALID_PREPARATION_DATA");
    if (record.value.applicationId !== applicationId) return failure("PREPARATION_NOT_FOUND");
    return { ok: true, value: preparationDetailModel(record.value) };
  } catch { return failure("REPOSITORY_ERROR"); }
}
