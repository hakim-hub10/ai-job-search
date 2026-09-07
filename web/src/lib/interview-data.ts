// Pass only the returned plain read models to UI components.
import "server-only";
import { resolve } from "node:path";

import { createFileApplicationRepository } from "../../../.agents/job-search/cli/src/application-file-repository";
import type { ApplicationRepository } from "../../../.agents/job-search/cli/src/application-repository";
import { createFileInterviewSessionRepository } from "../../../.agents/job-search/cli/src/interview-session-file-repository";
import type { InterviewSessionRepository } from "../../../.agents/job-search/cli/src/interview-session-repository";
import { isPersistableInterviewSession } from "../../../.agents/job-search/cli/src/interview-session-storage-validation";
import { getInterviewSessionSummary, type InterviewSession, type InterviewSessionSummary } from "../../../.agents/job-search/cli/src/interview-session";

export interface InterviewReadDependencies {
  applicationRepository: Pick<ApplicationRepository, "getById">;
  sessionRepository: Pick<InterviewSessionRepository, "getById" | "listByApplicationId">;
}

export type InterviewReadErrorCode =
  | "CONFIGURATION_MISSING"
  | "INVALID_REQUEST"
  | "APPLICATION_NOT_FOUND"
  | "INTERVIEW_SESSION_NOT_FOUND"
  | "INVALID_INTERVIEW_DATA"
  | "REPOSITORY_ERROR";

export interface InterviewReadFailure {
  ok: false;
  code: InterviewReadErrorCode;
  message: string;
}
export type InterviewReadResult<T> = { ok: true; value: T } | InterviewReadFailure;

/** Persisted progress only: no answer bodies, warning tokens or derived feedback. */
export interface InterviewSessionReadModel extends Pick<InterviewSessionSummary,
  "sessionId" | "applicationId" | "status" | "totalQuestions" | "answeredQuestions" | "skippedQuestions" | "remainingQuestions"> {
  language: InterviewSession["language"];
  interviewType: InterviewSession["interviewType"];
  currentQuestionIndex: number;
}

export interface InterviewApplicationContext {
  applicationId: string;
  jobTitle: string;
  company: string | null;
}
export interface InterviewOverview extends InterviewApplicationContext {
  /** Deterministic repository order (ID order for file storage), never chronology. */
  sessions: InterviewSessionReadModel[];
}
export interface InterviewSessionDetail extends InterviewApplicationContext {
  session: InterviewSessionReadModel;
}

function failure(code: InterviewReadErrorCode): InterviewReadFailure {
  const messages: Record<InterviewReadErrorCode, string> = {
    CONFIGURATION_MISSING: "Intervjuarkivet är inte fullständigt konfigurerat.",
    INVALID_REQUEST: "Ansökans eller intervjusessionens ID är ogiltigt.",
    APPLICATION_NOT_FOUND: "Ansökan hittades inte.",
    INTERVIEW_SESSION_NOT_FOUND: "Intervjusessionen hittades inte för ansökan.",
    INVALID_INTERVIEW_DATA: "Intervjuunderlaget är ogiltigt.",
    REPOSITORY_ERROR: "Intervjuunderlaget kunde inte läsas.",
  };
  return { ok: false, code, message: messages[code] };
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Trusted server configuration only; identifiers are never used as file paths. */
function configuredDependencies(): InterviewReadDependencies | null {
  const applicationPath = process.env.APPLICATION_REPOSITORY;
  const sessionPath = process.env.INTERVIEW_SESSION_REPOSITORY;
  if (!applicationPath?.trim() || !sessionPath?.trim()) return null;
  return {
    applicationRepository: createFileApplicationRepository(resolve(applicationPath)),
    sessionRepository: createFileInterviewSessionRepository(resolve(sessionPath)),
  };
}

function repositoryFailure(code: string): InterviewReadFailure {
  return failure(["CORRUPT_STORAGE", "UNSUPPORTED_SCHEMA_VERSION", "INVALID_RECORD"].includes(code)
    ? "INVALID_INTERVIEW_DATA" : "REPOSITORY_ERROR");
}

async function applicationContext(
  applicationId: string,
  dependencies: InterviewReadDependencies,
): Promise<InterviewReadResult<InterviewApplicationContext>> {
  const result = await dependencies.applicationRepository.getById(applicationId);
  if (!result.ok) return result.error.code === "NOT_FOUND"
    ? failure("APPLICATION_NOT_FOUND") : repositoryFailure(result.error.code);
  const application = result.value;
  if (!application || application.id !== applicationId || !application.jobSnapshot
    || typeof application.jobSnapshot.title !== "string"
    || (application.jobSnapshot.company !== null && typeof application.jobSnapshot.company !== "string")) {
    return failure("INVALID_INTERVIEW_DATA");
  }
  return { ok: true, value: {
    applicationId: application.id,
    jobTitle: application.jobSnapshot.title,
    company: application.jobSnapshot.company,
  } };
}

function sessionModel(value: unknown): InterviewReadResult<InterviewSessionReadModel> {
  if (!isPersistableInterviewSession(value)) return failure("INVALID_INTERVIEW_DATA");
  const summary = getInterviewSessionSummary(value);
  if (!summary.ok) return failure("INVALID_INTERVIEW_DATA");
  const counts = summary.value;
  return { ok: true, value: {
    sessionId: counts.sessionId,
    applicationId: counts.applicationId,
    status: counts.status,
    language: value.language,
    interviewType: value.interviewType,
    currentQuestionIndex: value.currentQuestionIndex,
    totalQuestions: counts.totalQuestions,
    answeredQuestions: counts.answeredQuestions,
    skippedQuestions: counts.skippedQuestions,
    remainingQuestions: counts.remainingQuestions,
  } };
}

/** Reads only; does not derive preparation or feedback, or select a latest session. */
export async function loadInterviewOverview(
  applicationId: string,
  dependencies?: InterviewReadDependencies,
): Promise<InterviewReadResult<InterviewOverview>> {
  if (!validId(applicationId)) return failure("INVALID_REQUEST");
  try {
    const repositories = dependencies ?? configuredDependencies();
    if (!repositories) return failure("CONFIGURATION_MISSING");
    const application = await applicationContext(applicationId, repositories);
    if (!application.ok) return application;
    const result = await repositories.sessionRepository.listByApplicationId(applicationId);
    if (!result.ok) return repositoryFailure(result.error.code);
    if (!Array.isArray(result.value)) return failure("INVALID_INTERVIEW_DATA");
    const sessions: InterviewSessionReadModel[] = [];
    const ids = new Set<string>();
    for (const session of result.value) {
      const mapped = sessionModel(session);
      if (!mapped.ok) return mapped;
      if (mapped.value.applicationId !== applicationId || ids.has(mapped.value.sessionId)) return failure("INVALID_INTERVIEW_DATA");
      ids.add(mapped.value.sessionId);
      sessions.push(mapped.value);
    }
    return { ok: true, value: { ...application.value, sessions } };
  } catch {
    return failure("REPOSITORY_ERROR");
  }
}

/** Individual selection is by explicit ID and checked against the application. */
export async function loadInterviewSession(
  applicationId: string,
  sessionId: string,
  dependencies?: InterviewReadDependencies,
): Promise<InterviewReadResult<InterviewSessionDetail>> {
  if (!validId(applicationId) || !validId(sessionId)) return failure("INVALID_REQUEST");
  try {
    const repositories = dependencies ?? configuredDependencies();
    if (!repositories) return failure("CONFIGURATION_MISSING");
    const application = await applicationContext(applicationId, repositories);
    if (!application.ok) return application;
    const result = await repositories.sessionRepository.getById(sessionId);
    if (!result.ok) return result.error.code === "NOT_FOUND"
      ? failure("INTERVIEW_SESSION_NOT_FOUND") : repositoryFailure(result.error.code);
    const session = sessionModel(result.value);
    if (!session.ok) return session;
    if (session.value.sessionId !== sessionId) return failure("INVALID_INTERVIEW_DATA");
    if (session.value.applicationId !== applicationId) return failure("INTERVIEW_SESSION_NOT_FOUND");
    return { ok: true, value: { ...application.value, session: session.value } };
  } catch {
    return failure("REPOSITORY_ERROR");
  }
}
