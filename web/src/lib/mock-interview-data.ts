import "server-only";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createFileApplicationRepository } from "../../../.agents/job-search/cli/src/application-file-repository";
import type { ApplicationRepository } from "../../../.agents/job-search/cli/src/application-repository";
import { createFileInterviewPreparationRepository } from "../../../.agents/job-search/cli/src/interview-preparation-file-repository";
import type { InterviewPreparationRecord, InterviewPreparationRepository } from "../../../.agents/job-search/cli/src/interview-preparation-repository";
import { isInterviewPreparationRecord } from "../../../.agents/job-search/cli/src/interview-preparation-storage-validation";
import { createFileInterviewSessionRepository } from "../../../.agents/job-search/cli/src/interview-session-file-repository";
import type { InterviewSessionRepository } from "../../../.agents/job-search/cli/src/interview-session-repository";
import { isPersistableInterviewSession } from "../../../.agents/job-search/cli/src/interview-session-storage-validation";
import type { InterviewAnswerInput } from "../../../.agents/job-search/cli/src/interview-answer-preparation";
import { createInterviewSessionFeedback, type InterviewFeedbackItem, type InterviewSessionFeedback } from "../../../.agents/job-search/cli/src/interview-feedback";
import { generateInterviewAIProposal, type InterviewAIGenerator, type InterviewAIProposal } from "../../../.agents/job-search/cli/src/interview-ai";
import { createOpenAIInterviewGenerator } from "../../../.agents/job-search/cli/src/providers/openai-interview-generator";
import { startInterviewSession, getCurrentInterviewQuestion, getInterviewSessionSummary, submitInterviewAnswer, skipCurrentInterviewQuestion, type InterviewSession } from "../../../.agents/job-search/cli/src/interview-session";
import { createFileInterviewSessionPreparationLinkRepository } from "../../../.agents/job-search/cli/src/interview-session-preparation-link-file-repository";
import type { InterviewSessionPreparationLinkRepository } from "../../../.agents/job-search/cli/src/interview-session-preparation-link-repository";
import { resolveInterviewSessionPreparation } from "../../../.agents/job-search/cli/src/interview-session-preparation";
import { preparationDetailModel, type PreparationDetail } from "./interview-preparation-data";
import type { InterviewSessionReadModel } from "./interview-data";
import { mockInterviewError } from "./mock-interview-presentation";

export type MockInterviewErrorCode = "CONFIGURATION_MISSING" | "INVALID_REQUEST" | "APPLICATION_NOT_FOUND" | "PREPARATION_NOT_FOUND" | "INTERVIEW_SESSION_NOT_FOUND" | "UNLINKED_SESSION" | "INVALID_INTERVIEW_DATA" | "SESSION_CREATION_FAILED" | "SESSION_ALREADY_COMPLETED" | "STALE_QUESTION" | "INVALID_ANSWER" | "ANSWER_SUBMISSION_FAILED" | "SKIP_FAILED" | "SESSION_INCOMPLETE" | "FEEDBACK_FAILED" | "AI_CONSENT_REQUIRED" | "AI_UNAVAILABLE" | "INVALID_AI_REQUEST" | "AI_REQUEST_FAILED" | "INVALID_AI_RESPONSE" | "REPOSITORY_ERROR";
export type MockInterviewResult<T> = { ok: true; value: T } | { ok: false; code: MockInterviewErrorCode; message: string };
export interface MockInterviewReadModel {
  application: { applicationId: string; jobTitle: string; company: string | null };
  session: InterviewSessionReadModel;
  preparationId: string;
  currentQuestion: PreparationDetail["questions"][number] | null;
}
export interface MockInterviewFeedbackItem {
  code: string; category: string; message: string;
  questions: string[]; requirements: string[]; evidence: string[];
}
export interface MockInterviewQuestionFeedback {
  prompt: string; status: "submitted" | "skipped"; answerFormat?: "freeText" | "star";
  structuralChecks?: { hasEvidenceCitation: boolean; hasQuestionLinkedEvidence: boolean; star: string };
  observations: MockInterviewFeedbackItem[]; strengths: MockInterviewFeedbackItem[]; cautions: MockInterviewFeedbackItem[]; priorities: MockInterviewFeedbackItem[];
}
export interface MockInterviewFeedbackReadModel {
  application: MockInterviewReadModel["application"];
  preparationId: string;
  status: "completed";
  summary: MockInterviewReadModel["session"];
  questions: MockInterviewQuestionFeedback[];
  categoryCoverage: { category: string; answeredQuestions: number; skippedQuestions: number; remainingQuestions: number }[];
  requirementCoverage: { requirement: string; status: string; questionCount: number }[];
  priorities: MockInterviewFeedbackItem[];
}
export interface MockInterviewAIReadModel {
  applicationId: string; sessionId: string; questionId: string;
  proposal: InterviewAIProposal;
  requiresHumanReview: true;
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
const validId = (id: unknown): id is string => typeof id === "string" && id.trim().length > 0 && id.length <= 200;
function storageFailure(code: string) {
  return failure(["INVALID_RECORD", "INVALID_LINK", "CORRUPT_STORAGE", "UNSUPPORTED_SCHEMA_VERSION"].includes(code) ? "INVALID_INTERVIEW_DATA" : "REPOSITORY_ERROR");
}
function transitionFailure(code: string, skip = false) {
  if (code === "SESSION_ALREADY_COMPLETED") return failure("SESSION_ALREADY_COMPLETED");
  if (code === "ANSWER_NOT_FOR_CURRENT_QUESTION" || code === "QUESTION_ALREADY_ANSWERED") return failure("STALE_QUESTION");
  if (!skip && (code === "INVALID_ANSWER_INPUT" || code === "UNKNOWN_QUESTION_ID" || code === "UNKNOWN_EVIDENCE_ID" || code === "DUPLICATE_EVIDENCE_ID")) return failure("INVALID_ANSWER");
  return failure(skip ? "SKIP_FAILED" : "ANSWER_SUBMISSION_FAILED");
}
function feedbackItemModel(item: InterviewFeedbackItem, questionLabels: Map<string, string>, requirementLabels: Map<string, string>, evidenceLabels: Map<string, string>): MockInterviewFeedbackItem {
  return { code: item.code, category: item.category, message: item.message,
    questions: item.questionIds.map((id) => questionLabels.get(id) ?? "Fråga kunde inte identifieras"),
    requirements: item.requirementKeys.map((key) => requirementLabels.get(key) ?? "Kravuppgift saknas"),
    evidence: item.evidenceIds.map((id) => evidenceLabels.get(id) ?? "Underlag kunde inte identifieras") };
}
function feedbackModel(record: InterviewPreparationRecord, session: InterviewSession, feedback: InterviewSessionFeedback): MockInterviewFeedbackReadModel {
  const detail = preparationDetailModel(record);
  const questionLabels = new Map(detail.questions.map((question) => [question.id, question.prompt]));
  const requirementLabels = new Map(record.requirementContext.map((context) => [context.requirement.identity.key, context.requirement.identity.original]));
  const evidenceLabels = new Map(record.evidenceSnapshot.filter((evidence) => evidence.kind !== "identity").map((evidence) => [evidence.id, evidence.content]));
  const mapItem = (item: InterviewFeedbackItem) => feedbackItemModel(item, questionLabels, requirementLabels, evidenceLabels);
  const turns = new Map(session.turns.map((turn) => [turn.questionId, turn]));
  return { application: { applicationId: record.applicationId, jobTitle: detail.jobTitle, company: detail.company }, preparationId: record.id, status: "completed",
    summary: { sessionId: session.id, applicationId: session.applicationId, status: "completed", language: session.language, interviewType: session.interviewType,
      currentQuestionIndex: session.currentQuestionIndex, totalQuestions: feedback.structuralSummary.totalQuestions, answeredQuestions: feedback.structuralSummary.answeredQuestions,
      skippedQuestions: feedback.structuralSummary.skippedQuestions, remainingQuestions: 0 },
    questions: feedback.questionFeedback.map((question) => { const turn = turns.get(question.questionId); return { prompt: questionLabels.get(question.questionId) ?? "Fråga kunde inte identifieras", status: question.turnStatus,
      ...(turn?.status === "submitted" ? { answerFormat: turn.answerFormat, structuralChecks: { hasEvidenceCitation: turn.preparation.structuralChecks.hasEvidenceCitation, hasQuestionLinkedEvidence: turn.preparation.structuralChecks.hasQuestionLinkedEvidence, star: turn.preparation.structuralChecks.star } } : {}),
      observations: question.observations.map(mapItem), strengths: question.structuralStrengths.map(mapItem), cautions: question.cautions.map(mapItem), priorities: question.improvementPriorities.map(mapItem) }; }),
    categoryCoverage: feedback.categoryCoverage, requirementCoverage: feedback.requirementPracticeCoverage.map((item) => ({ requirement: requirementLabels.get(item.requirementKey) ?? "Kravuppgift saknas", status: item.status, questionCount: item.questionIds.length })), priorities: feedback.practicePriorities.map(mapItem) };
}
function configured(): MockInterviewStartDependencies | null {
  const app = process.env.APPLICATION_REPOSITORY, prep = process.env.INTERVIEW_PREPARATION_REPOSITORY;
  const session = process.env.INTERVIEW_SESSION_REPOSITORY, link = process.env.INTERVIEW_SESSION_PREPARATION_LINK_REPOSITORY;
  if (![app, prep, session, link].every((path) => path?.trim())) return null;
  const dependencies = { applicationRepository: createFileApplicationRepository(resolve(app!)),
    preparationRepository: createFileInterviewPreparationRepository(resolve(prep!)), sessionRepository: createFileInterviewSessionRepository(resolve(session!)) };
  return { ...dependencies, linkRepository: createFileInterviewSessionPreparationLinkRepository(resolve(link!), dependencies) };
}
function configuredAIGenerator(): InterviewAIGenerator | null {
  const apiKey = process.env.OPENAI_API_KEY, model = process.env.INTERVIEW_AI_MODEL;
  if (!apiKey?.trim() || !model?.trim() || process.env.INTERVIEW_AI_ENABLED !== "true") return null;
  return createOpenAIInterviewGenerator({ enabled: true, remoteGenerationConsent: true, apiKey, model,
    maxOutputTokens: Number(process.env.INTERVIEW_AI_MAX_OUTPUT_TOKENS ?? 800), timeoutMs: Number(process.env.INTERVIEW_AI_TIMEOUT_MS ?? 15000) });
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
export async function loadApplicationMockInterviewFeedback(applicationId: string, sessionId: string, dependencies?: MockInterviewReadDependencies): Promise<MockInterviewResult<MockInterviewFeedbackReadModel>> {
  if (!validId(applicationId) || !validId(sessionId)) return failure("INVALID_REQUEST");
  try {
    const deps = dependencies ?? configured(); if (!deps) return failure("CONFIGURATION_MISSING");
    const app = await applicationExists(applicationId, deps); if (!app.ok) return app;
    const stored = await deps.sessionRepository.getById(sessionId);
    if (!stored.ok) return stored.error.code === "NOT_FOUND" ? failure("INTERVIEW_SESSION_NOT_FOUND") : storageFailure(stored.error.code);
    if (!isPersistableInterviewSession(stored.value) || stored.value.id !== sessionId || stored.value.applicationId !== applicationId) return failure("INTERVIEW_SESSION_NOT_FOUND");
    if (stored.value.status !== "completed") return failure("SESSION_INCOMPLETE");
    const resolved = await resolveInterviewSessionPreparation({ applicationId, sessionId }, deps);
    if (!resolved.ok) {
      if (resolved.error.code === "UNLINKED_SESSION") return failure("UNLINKED_SESSION");
      if (resolved.error.code === "NOT_FOUND") return failure("PREPARATION_NOT_FOUND");
      return storageFailure(resolved.error.code);
    }
    if (!isInterviewPreparationRecord(resolved.value) || resolved.value.applicationId !== applicationId) return failure("INVALID_INTERVIEW_DATA");
    const feedback = createInterviewSessionFeedback(resolved.value.plan, stored.value);
    if (!feedback.ok) return failure("FEEDBACK_FAILED");
    return { ok: true, value: feedbackModel(resolved.value, stored.value, feedback.value) };
  } catch { return failure("REPOSITORY_ERROR"); }
}
export async function requestInterviewAiCoaching(input: {
  applicationId: unknown; sessionId: unknown; questionId: unknown;
  answer: InterviewAnswerInput; consent: unknown;
}, dependencies?: MockInterviewReadDependencies, generator?: InterviewAIGenerator): Promise<MockInterviewResult<MockInterviewAIReadModel>> {
  if (!validId(input.applicationId) || !validId(input.sessionId) || !validId(input.questionId)) return failure("INVALID_AI_REQUEST");
  if (input.consent !== true) return failure("AI_CONSENT_REQUIRED");
  if (!input.answer || typeof input.answer !== "object" || !validId(input.answer.questionId)) return failure("INVALID_AI_REQUEST");
  const applicationId = input.applicationId, sessionId = input.sessionId, questionId = input.questionId;
  try {
    const deps = dependencies ?? configured(); if (!deps) return failure("CONFIGURATION_MISSING");
    const app = await applicationExists(applicationId, deps); if (!app.ok) return app;
    const stored = await deps.sessionRepository.getById(sessionId);
    if (!stored.ok) return stored.error.code === "NOT_FOUND" ? failure("INTERVIEW_SESSION_NOT_FOUND") : storageFailure(stored.error.code);
    if (!isPersistableInterviewSession(stored.value) || stored.value.id !== sessionId || stored.value.applicationId !== applicationId) return failure("INTERVIEW_SESSION_NOT_FOUND");
    const resolved = await resolveInterviewSessionPreparation({ applicationId, sessionId }, deps);
    if (!resolved.ok) return resolved.error.code === "UNLINKED_SESSION" ? failure("UNLINKED_SESSION") : storageFailure(resolved.error.code);
    if (!isInterviewPreparationRecord(resolved.value) || resolved.value.applicationId !== applicationId) return failure("INVALID_INTERVIEW_DATA");
    if (input.answer.questionId !== questionId) return failure("INVALID_AI_REQUEST");
    const selectedGenerator = generator ?? configuredAIGenerator(); if (!selectedGenerator) return failure("AI_UNAVAILABLE");
    const result = await generateInterviewAIProposal(resolved.value.plan, stored.value, { evidence: structuredClone(resolved.value.evidenceSnapshot) }, input.answer, selectedGenerator);
    if (!result.ok) return failure("AI_REQUEST_FAILED");
    if (result.value.proposal.applicationId !== applicationId || result.value.proposal.sessionId !== sessionId || result.value.proposal.questionId !== questionId || result.value.requiresHumanReview !== true) return failure("INVALID_AI_RESPONSE");
    return { ok: true, value: { applicationId, sessionId, questionId, proposal: result.value.proposal, requiresHumanReview: true } };
  } catch { return failure("AI_REQUEST_FAILED"); }
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

export interface MockInterviewProgressDependencies extends MockInterviewReadDependencies {
  sessionRepository: Pick<InterviewSessionRepository, "getById" | "save">;
}
export interface MockInterviewAnswerFields {
  format: unknown;
  text?: unknown;
  star?: unknown;
  citedEvidenceIds?: unknown;
}
function configuredProgress(): MockInterviewProgressDependencies | null {
  const configuredDependencies = configured();
  return configuredDependencies ? configuredDependencies : null;
}
function answerInput(questionId: string, fields: MockInterviewAnswerFields): InterviewAnswerInput | null {
  const citedEvidenceIds = fields.citedEvidenceIds === undefined ? undefined
    : Array.isArray(fields.citedEvidenceIds) && fields.citedEvidenceIds.every((id) => typeof id === "string")
      ? fields.citedEvidenceIds as string[] : null;
  if (citedEvidenceIds === null) return null;
  if (fields.format === "freeText" && typeof fields.text === "string" && fields.text.length <= 10000) {
    return { questionId, format: "freeText", text: fields.text,
      ...(citedEvidenceIds ? { citedEvidenceIds } : {}) };
  }
  if (fields.format === "star" && fields.star && typeof fields.star === "object" && !Array.isArray(fields.star)) {
    const star = fields.star as Record<string, unknown>;
    const fieldsValid = [star.situation, star.task, star.action, star.result].every((value) => value === undefined || typeof value === "string" && value.length <= 4000);
    if (!fieldsValid) return null;
    return { questionId, format: "star", star: {
      ...(typeof star.situation === "string" ? { situation: star.situation } : {}),
      ...(typeof star.task === "string" ? { task: star.task } : {}),
      ...(typeof star.action === "string" ? { action: star.action } : {}),
      ...(typeof star.result === "string" ? { result: star.result } : {}),
    }, ...(citedEvidenceIds ? { citedEvidenceIds } : {}) };
  }
  return null;
}
let pendingProgress: Promise<unknown> = Promise.resolve();
async function progressApplicationMockInterview(
  input: { applicationId: unknown; sessionId: unknown; expectedQuestionId: unknown },
  fields: MockInterviewAnswerFields | null,
  dependencies?: MockInterviewProgressDependencies,
): Promise<MockInterviewResult<MockInterviewReadModel>> {
  if (!validId(input.applicationId) || !validId(input.sessionId) || !validId(input.expectedQuestionId)) return failure("INVALID_REQUEST");
  const applicationId = input.applicationId, sessionId = input.sessionId, expectedQuestionId = input.expectedQuestionId;
  const operation = pendingProgress.then(async (): Promise<MockInterviewResult<MockInterviewReadModel>> => {
    try {
      const deps = dependencies ?? configuredProgress(); if (!deps) return failure("CONFIGURATION_MISSING");
      const app = await applicationExists(applicationId, deps); if (!app.ok) return app;
      const stored = await deps.sessionRepository.getById(sessionId);
      if (!stored.ok) return stored.error.code === "NOT_FOUND" ? failure("INTERVIEW_SESSION_NOT_FOUND") : storageFailure(stored.error.code);
      if (!isPersistableInterviewSession(stored.value) || stored.value.id !== sessionId || stored.value.applicationId !== applicationId) return failure("INTERVIEW_SESSION_NOT_FOUND");
      const resolved = await resolveInterviewSessionPreparation({ applicationId, sessionId }, deps);
      if (!resolved.ok) return resolved.error.code === "UNLINKED_SESSION" ? failure("UNLINKED_SESSION") : storageFailure(resolved.error.code);
      if (!isInterviewPreparationRecord(resolved.value) || resolved.value.applicationId !== applicationId) return failure("INVALID_INTERVIEW_DATA");
      const current = getCurrentInterviewQuestion(stored.value, resolved.value.plan);
      if (!current.ok) return failure("INVALID_INTERVIEW_DATA");
      if (!current.value) return failure("SESSION_ALREADY_COMPLETED");
      if (current.value.id !== expectedQuestionId) return failure("STALE_QUESTION");
      const answer = fields ? answerInput(current.value.id, fields) : null;
      if (fields && !answer) return failure("INVALID_ANSWER");
      const updated = answer
        ? submitInterviewAnswer(stored.value, resolved.value.plan, { evidence: structuredClone(resolved.value.evidenceSnapshot) }, answer)
        : skipCurrentInterviewQuestion(stored.value, resolved.value.plan);
      if (!updated.ok) return transitionFailure("stage" in updated.error ? updated.error.error.code : updated.error.code, !fields);
      const saved = await deps.sessionRepository.save(updated.value);
      if (!saved.ok || !isDeepStrictEqual(saved.value, updated.value)) return failure(fields ? "ANSWER_SUBMISSION_FAILED" : "SKIP_FAILED");
      const persisted = await deps.sessionRepository.getById(sessionId);
      if (!persisted.ok || !isDeepStrictEqual(persisted.value, updated.value)) return failure(fields ? "ANSWER_SUBMISSION_FAILED" : "SKIP_FAILED");
      const read = await loadApplicationMockInterview(applicationId, sessionId, deps);
      return read.ok ? read : failure(fields ? "ANSWER_SUBMISSION_FAILED" : "SKIP_FAILED");
    } catch { return failure("REPOSITORY_ERROR"); }
  });
  pendingProgress = operation.catch(() => undefined);
  return operation;
}
export function submitApplicationMockInterviewAnswer(input: { applicationId: unknown; sessionId: unknown; expectedQuestionId: unknown; fields: MockInterviewAnswerFields }, dependencies?: MockInterviewProgressDependencies) {
  return progressApplicationMockInterview(input, input.fields, dependencies);
}
export function skipApplicationMockInterviewQuestion(input: { applicationId: unknown; sessionId: unknown; expectedQuestionId: unknown }, dependencies?: MockInterviewProgressDependencies) {
  return progressApplicationMockInterview(input, null, dependencies);
}
