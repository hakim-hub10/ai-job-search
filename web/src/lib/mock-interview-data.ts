import "server-only";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createFileApplicationRepository } from "../../../.agents/job-search/cli/src/application-file-repository";
import type { ApplicationRepository } from "../../../.agents/job-search/cli/src/application-repository";
import { createFileInterviewPreparationRepository } from "../../../.agents/job-search/cli/src/interview-preparation-file-repository";
import type { InterviewPreparationRepository } from "../../../.agents/job-search/cli/src/interview-preparation-repository";
import { isInterviewPreparationRecord } from "../../../.agents/job-search/cli/src/interview-preparation-storage-validation";
import { createFileInterviewSessionRepository } from "../../../.agents/job-search/cli/src/interview-session-file-repository";
import type { InterviewSessionRepository } from "../../../.agents/job-search/cli/src/interview-session-repository";
import { isPersistableInterviewSession } from "../../../.agents/job-search/cli/src/interview-session-storage-validation";
import { startInterviewSession, getCurrentInterviewQuestion, getInterviewSessionSummary } from "../../../.agents/job-search/cli/src/interview-session";
import { createFileInterviewSessionPreparationLinkRepository } from "../../../.agents/job-search/cli/src/interview-session-preparation-link-file-repository";
import type { InterviewSessionPreparationLinkRepository } from "../../../.agents/job-search/cli/src/interview-session-preparation-link-repository";
import { resolveInterviewSessionPreparation } from "../../../.agents/job-search/cli/src/interview-session-preparation";
import { preparationDetailModel, type PreparationDetail } from "./interview-preparation-data";
import type { InterviewSessionReadModel } from "./interview-data";
import { mockInterviewError } from "./mock-interview-presentation";

export type MockInterviewErrorCode = "CONFIGURATION_MISSING" | "INVALID_REQUEST" | "APPLICATION_NOT_FOUND" | "PREPARATION_NOT_FOUND" | "INTERVIEW_SESSION_NOT_FOUND" | "UNLINKED_SESSION" | "INVALID_INTERVIEW_DATA" | "SESSION_CREATION_FAILED" | "REPOSITORY_ERROR";
export type MockInterviewResult<T> = { ok: true; value: T } | { ok: false; code: MockInterviewErrorCode; message: string };
export interface MockInterviewReadModel {
  application: { applicationId: string; jobTitle: string; company: string | null };
  session: InterviewSessionReadModel;
  preparationId: string;
  currentQuestion: PreparationDetail["questions"][number] | null;
}
export interface MockInterviewReadDependencies {
  applicationRepository: Pick<ApplicationRepository, "getById">;
  preparationRepository: Pick<InterviewPreparationRepository, "getById">;
  sessionRepository: Pick<InterviewSessionRepository, "getById">;
  linkRepository: Pick<InterviewSessionPreparationLinkRepository, "getBySessionId">;
}
export interface MockInterviewStartDependencies extends MockInterviewReadDependencies {
  sessionRepository: Pick<InterviewSessionRepository, "getById" | "save">;
  linkRepository: InterviewSessionPreparationLinkRepository;
}
const failure = (code: MockInterviewErrorCode): { ok: false; code: MockInterviewErrorCode; message: string } => ({ ok: false, code, message: mockInterviewError(code) });
const validId = (id: unknown): id is string => typeof id === "string" && id.trim().length > 0;
function storageFailure(code: string) {
  return failure(["INVALID_RECORD", "INVALID_LINK", "CORRUPT_STORAGE", "UNSUPPORTED_SCHEMA_VERSION"].includes(code) ? "INVALID_INTERVIEW_DATA" : "REPOSITORY_ERROR");
}
function configured(): MockInterviewStartDependencies | null {
  const app = process.env.APPLICATION_REPOSITORY, prep = process.env.INTERVIEW_PREPARATION_REPOSITORY;
  const session = process.env.INTERVIEW_SESSION_REPOSITORY, link = process.env.INTERVIEW_SESSION_PREPARATION_LINK_REPOSITORY;
  if (![app, prep, session, link].every((path) => path?.trim())) return null;
  const dependencies = { applicationRepository: createFileApplicationRepository(resolve(app!)),
    preparationRepository: createFileInterviewPreparationRepository(resolve(prep!)), sessionRepository: createFileInterviewSessionRepository(resolve(session!)) };
  return { ...dependencies, linkRepository: createFileInterviewSessionPreparationLinkRepository(resolve(link!), dependencies) };
}
async function applicationExists(id: string, deps: MockInterviewReadDependencies) {
  const result = await deps.applicationRepository.getById(id);
  if (!result.ok) return result.error.code === "NOT_FOUND" ? failure("APPLICATION_NOT_FOUND") : storageFailure(result.error.code);
  if (result.value?.id !== id) return failure("INVALID_INTERVIEW_DATA");
  return { ok: true as const, value: undefined };
}
/** Read only: the durable link chooses the preparation, then the core chooses the question. */
export async function loadApplicationMockInterview(applicationId: string, sessionId: string, dependencies?: MockInterviewReadDependencies): Promise<MockInterviewResult<MockInterviewReadModel>> {
  if (!validId(applicationId) || !validId(sessionId)) return failure("INVALID_REQUEST");
  try {
    const deps = dependencies ?? configured(); if (!deps) return failure("CONFIGURATION_MISSING");
    const app = await applicationExists(applicationId, deps); if (!app.ok) return app;
    const stored = await deps.sessionRepository.getById(sessionId);
    if (!stored.ok) return stored.error.code === "NOT_FOUND" ? failure("INTERVIEW_SESSION_NOT_FOUND") : storageFailure(stored.error.code);
    if (!isPersistableInterviewSession(stored.value) || stored.value.id !== sessionId) return failure("INVALID_INTERVIEW_DATA");
    if (stored.value.applicationId !== applicationId) return failure("INTERVIEW_SESSION_NOT_FOUND");
    const resolved = await resolveInterviewSessionPreparation({ applicationId, sessionId }, deps);
    if (!resolved.ok) return resolved.error.code === "UNLINKED_SESSION" ? failure("UNLINKED_SESSION") : storageFailure(resolved.error.code);
    if (!isInterviewPreparationRecord(resolved.value) || resolved.value.applicationId !== applicationId) return failure("INVALID_INTERVIEW_DATA");
    const current = getCurrentInterviewQuestion(stored.value, resolved.value.plan);
    const summary = getInterviewSessionSummary(stored.value);
    if (!current.ok || !summary.ok) return failure("INVALID_INTERVIEW_DATA");
    const model = preparationDetailModel(resolved.value);
    const question = current.value ? model.questions.find((q) => q.id === current.value!.id) : null;
    if (current.value && !question) return failure("INVALID_INTERVIEW_DATA");
    const s = summary.value;
    return { ok: true, value: {
      application: { applicationId, jobTitle: model.jobTitle, company: model.company }, preparationId: model.preparationId,
      session: { sessionId, applicationId, status: s.status, language: stored.value.language, interviewType: stored.value.interviewType,
        currentQuestionIndex: stored.value.currentQuestionIndex, totalQuestions: s.totalQuestions, answeredQuestions: s.answeredQuestions,
        skippedQuestions: s.skippedQuestions, remainingQuestions: s.remainingQuestions }, currentQuestion: question ?? null,
    } };
  } catch { return failure("REPOSITORY_ERROR"); }
}
// Serialize the entire two-file sequence in this web process. There is no
// cross-file transaction or cross-process lock; one writer per store is required.
let pendingStart: Promise<unknown> = Promise.resolve();
export async function startApplicationMockInterview(input: { applicationId: unknown; preparationId: unknown }, dependencies?: MockInterviewStartDependencies): Promise<MockInterviewResult<MockInterviewReadModel>> {
  if (!validId(input.applicationId) || !validId(input.preparationId)) return failure("INVALID_REQUEST");
  const applicationId = input.applicationId, preparationId = input.preparationId;
  const operation = pendingStart.then(async (): Promise<MockInterviewResult<MockInterviewReadModel>> => {
    let saveAttempted = false;
    try {
      const deps = dependencies ?? configured(); if (!deps) return failure("CONFIGURATION_MISSING");
      const app = await applicationExists(applicationId, deps); if (!app.ok) return app;
      const preparation = await deps.preparationRepository.getById(preparationId);
      if (!preparation.ok) return preparation.error.code === "NOT_FOUND" ? failure("PREPARATION_NOT_FOUND") : storageFailure(preparation.error.code);
      if (!isInterviewPreparationRecord(preparation.value) || preparation.value.id !== preparationId) return failure("INVALID_INTERVIEW_DATA");
      if (preparation.value.applicationId !== applicationId) return failure("PREPARATION_NOT_FOUND");
      const exact = structuredClone(preparation.value);
      const sessionId = crypto.randomUUID();
      // save is an upsert: refuse a collision rather than replacing history.
      const existing = await deps.sessionRepository.getById(sessionId);
      if (existing.ok) return failure("SESSION_CREATION_FAILED");
      if (existing.error.code !== "NOT_FOUND") return storageFailure(existing.error.code);
      const started = startInterviewSession(exact.plan, { sessionId });
      if (!started.ok) return failure("SESSION_CREATION_FAILED");
      saveAttempted = true;
      const saved = await deps.sessionRepository.save(started.value);
      if (!saved.ok || !isDeepStrictEqual(saved.value, started.value)) return failure("SESSION_CREATION_FAILED");
      const link = { applicationId, sessionId, preparationRecordId: preparationId };
      const linked = await deps.linkRepository.create(link);
      if (!linked.ok || !isDeepStrictEqual(linked.value, link)) return failure("SESSION_CREATION_FAILED");
      // Read back both durable records, including the resolver's full validation.
      const persisted = await deps.sessionRepository.getById(sessionId);
      const resolved = await resolveInterviewSessionPreparation({ applicationId, sessionId }, deps);
      if (!persisted.ok || !isDeepStrictEqual(persisted.value, started.value) || !resolved.ok || !isDeepStrictEqual(resolved.value, exact)) return failure("SESSION_CREATION_FAILED");
      const read = await loadApplicationMockInterview(applicationId, sessionId, deps);
      if (!read.ok || read.value.preparationId !== preparationId) return failure("SESSION_CREATION_FAILED");
      return read;
    } catch { return failure(saveAttempted ? "SESSION_CREATION_FAILED" : "REPOSITORY_ERROR"); }
  });
  pendingStart = operation.catch(() => undefined);
  return operation;
}
