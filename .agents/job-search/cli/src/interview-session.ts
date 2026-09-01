import type { CandidateDocumentInput, DocumentLanguage } from "./application-documents"
import {
  prepareInterviewAnswer,
  type InterviewAnswerInput,
  type InterviewAnswerPreparation,
  type InterviewAnswerPreparationError,
} from "./interview-answer-preparation"
import type { InterviewPreparationPlan, InterviewQuestion, InterviewType } from "./interview-preparation"

export type InterviewSessionStatus = "inProgress" | "completed"

export type InterviewTurn =
  | { status: "submitted"; questionId: string; answerFormat: InterviewAnswerInput["format"]; preparation: InterviewAnswerPreparation }
  | { status: "skipped"; questionId: string }

export interface InterviewSession {
  id: string
  applicationId: string
  language: DocumentLanguage
  interviewType: InterviewType
  status: InterviewSessionStatus
  planQuestionIds: string[]
  currentQuestionIndex: number
  turns: InterviewTurn[]
}

export interface StartInterviewSessionOptions {
  sessionId: string
}

export type InterviewSessionErrorCode =
  | "INVALID_INTERVIEW_PLAN"
  | "EMPTY_INTERVIEW_PLAN"
  | "INVALID_INTERVIEW_SESSION"
  | "PLAN_SESSION_MISMATCH"
  | "SESSION_ALREADY_COMPLETED"
  | "ANSWER_NOT_FOR_CURRENT_QUESTION"
  | "QUESTION_ALREADY_ANSWERED"

export interface InterviewSessionError {
  code: InterviewSessionErrorCode
  message: string
}

export interface InterviewAnswerPreparationStageError {
  stage: "answerPreparation"
  error: InterviewAnswerPreparationError
}

export type StartInterviewSessionResult = { ok: true; value: InterviewSession } | { ok: false; error: InterviewSessionError }
export type CurrentInterviewQuestionResult = { ok: true; value: InterviewQuestion | null } | { ok: false; error: InterviewSessionError }
export type InterviewSessionTransitionResult = { ok: true; value: InterviewSession } | { ok: false; error: InterviewSessionError | InterviewAnswerPreparationStageError }

export interface InterviewSessionWarningCount {
  code: string
  count: number
}

export interface InterviewSessionSummary {
  sessionId: string
  applicationId: string
  status: InterviewSessionStatus
  totalQuestions: number
  answeredQuestions: number
  skippedQuestions: number
  remainingQuestions: number
  warningCounts: InterviewSessionWarningCount[]
}

export type InterviewSessionSummaryResult = { ok: true; value: InterviewSessionSummary } | { ok: false; error: InterviewSessionError }

function failure(code: InterviewSessionErrorCode, message: string): { ok: false; error: InterviewSessionError } {
  return { ok: false, error: { code, message } }
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isInterviewType(value: unknown): value is InterviewType {
  return value === "recruiterScreening" || value === "hiringManager" || value === "behavioral" || value === "roleSpecific" || value === "situational"
}

function planQuestionIds(plan: unknown): { ok: true; value: string[] } | { ok: false; error: InterviewSessionError } {
  if (!plan || typeof plan !== "object") return failure("INVALID_INTERVIEW_PLAN", "Interview session requires a valid interview preparation plan.")
  const candidate = plan as Partial<InterviewPreparationPlan>
  if (!hasText(candidate.applicationId) || (candidate.language !== "en" && candidate.language !== "sv") || !isInterviewType(candidate.interviewType) || !Array.isArray(candidate.questions)) {
    return failure("INVALID_INTERVIEW_PLAN", "Interview session requires a valid interview preparation plan.")
  }
  const ids = candidate.questions.map((question) => question?.id)
  if (ids.some((id) => !hasText(id)) || new Set(ids).size !== ids.length) return failure("INVALID_INTERVIEW_PLAN", "Interview plan question IDs must be non-empty and unique.")
  if (ids.length === 0) return failure("EMPTY_INTERVIEW_PLAN", "Interview session cannot start from an empty interview plan.")
  return { ok: true, value: ids }
}

function compatiblePlan(session: InterviewSession, plan: unknown): { ok: true; value: string[] } | { ok: false; error: InterviewSessionError } {
  const planIds = planQuestionIds(plan)
  if (!planIds.ok) return planIds
  const candidate = plan as InterviewPreparationPlan
  if (session.applicationId !== candidate.applicationId || session.language !== candidate.language || session.interviewType !== candidate.interviewType || session.planQuestionIds.length !== planIds.value.length || session.planQuestionIds.some((id, index) => id !== planIds.value[index])) {
    return failure("PLAN_SESSION_MISMATCH", "Interview session does not match the supplied interview preparation plan.")
  }
  return planIds
}

function validPreparation(value: unknown, session: InterviewSession, questionId: string): value is InterviewAnswerPreparation {
  if (!value || typeof value !== "object") return false
  const preparation = value as Partial<InterviewAnswerPreparation>
  return preparation.applicationId === session.applicationId && preparation.questionId === questionId && preparation.language === session.language && Array.isArray(preparation.warnings)
}

function validateSession(session: unknown): { ok: true; value: InterviewSession } | { ok: false; error: InterviewSessionError } {
  if (!session || typeof session !== "object") return failure("INVALID_INTERVIEW_SESSION", "Interview session state must be an object.")
  const candidate = session as Partial<InterviewSession>
  if (!hasText(candidate.id) || !hasText(candidate.applicationId) || (candidate.language !== "en" && candidate.language !== "sv") || !isInterviewType(candidate.interviewType) || (candidate.status !== "inProgress" && candidate.status !== "completed") || !Array.isArray(candidate.planQuestionIds) || !Array.isArray(candidate.turns) || !Number.isInteger(candidate.currentQuestionIndex)) {
    return failure("INVALID_INTERVIEW_SESSION", "Interview session state has invalid required fields.")
  }
  if (candidate.planQuestionIds.length === 0 || candidate.planQuestionIds.some((id) => !hasText(id)) || new Set(candidate.planQuestionIds).size !== candidate.planQuestionIds.length) {
    return failure("INVALID_INTERVIEW_SESSION", "Interview session question IDs must be non-empty and unique.")
  }
  const ids = candidate.planQuestionIds
  const currentQuestionIndex = candidate.currentQuestionIndex as number
  if (candidate.turns.length > ids.length || currentQuestionIndex < 0 || currentQuestionIndex > ids.length) return failure("INVALID_INTERVIEW_SESSION", "Interview session position is invalid.")
  const turnIds = new Set<string>()
  for (let index = 0; index < candidate.turns.length; index += 1) {
    const turn = candidate.turns[index] as Partial<InterviewTurn>
    if (!turn || typeof turn !== "object" || (turn.status !== "submitted" && turn.status !== "skipped") || turn.questionId !== ids[index] || turnIds.has(turn.questionId)) {
      return failure("INVALID_INTERVIEW_SESSION", "Interview session turns must consume plan questions exactly once and in order.")
    }
    turnIds.add(turn.questionId)
    if (turn.status === "submitted" && ((turn.answerFormat !== "freeText" && turn.answerFormat !== "star") || !validPreparation(turn.preparation, candidate as InterviewSession, turn.questionId))) {
      return failure("INVALID_INTERVIEW_SESSION", "A submitted interview turn has invalid preparation data.")
    }
    if (turn.status === "skipped" && ("answerFormat" in turn || "preparation" in turn)) return failure("INVALID_INTERVIEW_SESSION", "A skipped interview turn must not contain answer preparation data.")
  }
  if (currentQuestionIndex !== candidate.turns.length) return failure("INVALID_INTERVIEW_SESSION", "Interview session position must equal the number of consumed turns.")
  if ((candidate.status === "completed") !== (currentQuestionIndex === ids.length)) return failure("INVALID_INTERVIEW_SESSION", "Interview session completion status does not match consumed questions.")
  return { ok: true, value: candidate as InterviewSession }
}

function validateForPlan(session: unknown, plan: unknown): { ok: true; value: { session: InterviewSession; questionIds: string[] } } | { ok: false; error: InterviewSessionError } {
  const valid = validateSession(session)
  if (!valid.ok) return valid
  const compatible = compatiblePlan(valid.value, plan)
  if (!compatible.ok) return compatible
  return { ok: true, value: { session: valid.value, questionIds: compatible.value } }
}

function nextSession(session: InterviewSession, turn: InterviewTurn): InterviewSession {
  const turns = [...session.turns, turn]
  const currentQuestionIndex = session.currentQuestionIndex + 1
  return {
    ...session,
    planQuestionIds: [...session.planQuestionIds],
    turns,
    currentQuestionIndex,
    status: currentQuestionIndex === session.planQuestionIds.length ? "completed" : "inProgress",
  }
}

/** Starts a deterministic, in-memory session from the fixed Phase 5.1 question order. */
export function startInterviewSession(plan: InterviewPreparationPlan, options: StartInterviewSessionOptions): StartInterviewSessionResult {
  const ids = planQuestionIds(plan)
  if (!ids.ok) return ids
  if (!options || !hasText(options.sessionId)) return failure("INVALID_INTERVIEW_SESSION", "Interview session requires a non-empty caller-supplied session ID.")
  return {
    ok: true,
    value: {
      id: options.sessionId,
      applicationId: plan.applicationId,
      language: plan.language,
      interviewType: plan.interviewType,
      status: "inProgress",
      planQuestionIds: [...ids.value],
      currentQuestionIndex: 0,
      turns: [],
    },
  }
}

export function getCurrentInterviewQuestion(session: InterviewSession, plan: InterviewPreparationPlan): CurrentInterviewQuestionResult {
  const checked = validateForPlan(session, plan)
  if (!checked.ok) return checked
  if (checked.value.session.status === "completed") return { ok: true, value: null }
  return { ok: true, value: plan.questions[checked.value.session.currentQuestionIndex] }
}

export function submitInterviewAnswer(
  session: InterviewSession,
  plan: InterviewPreparationPlan,
  documentInput: Omit<CandidateDocumentInput, "matchingProfile">,
  answer: InterviewAnswerInput,
): InterviewSessionTransitionResult {
  const checked = validateForPlan(session, plan)
  if (!checked.ok) return checked
  const current = checked.value.session
  if (current.status === "completed") return failure("SESSION_ALREADY_COMPLETED", "A completed interview session cannot accept another answer.")
  if (!answer || typeof answer !== "object" || !hasText((answer as Partial<InterviewAnswerInput>).questionId)) return { ok: false, error: { stage: "answerPreparation", error: { code: "INVALID_ANSWER_INPUT", message: "Answer input must include a non-empty question ID." } } }
  const currentQuestionId = checked.value.questionIds[current.currentQuestionIndex]
  if (answer.questionId !== currentQuestionId) {
    const consumed = current.turns.some((turn) => turn.questionId === answer.questionId)
    return failure(consumed ? "QUESTION_ALREADY_ANSWERED" : "ANSWER_NOT_FOR_CURRENT_QUESTION", consumed ? "A previously consumed interview question cannot be answered again." : "Answer input must target the current interview question.")
  }
  const preparation = prepareInterviewAnswer(plan, documentInput, answer)
  if (!preparation.ok) return { ok: false, error: { stage: "answerPreparation", error: preparation.error } }
  return { ok: true, value: nextSession(current, { status: "submitted", questionId: currentQuestionId, answerFormat: answer.format, preparation: preparation.value }) }
}

export function skipCurrentInterviewQuestion(session: InterviewSession, plan: InterviewPreparationPlan): InterviewSessionTransitionResult {
  const checked = validateForPlan(session, plan)
  if (!checked.ok) return checked
  const current = checked.value.session
  if (current.status === "completed") return failure("SESSION_ALREADY_COMPLETED", "A completed interview session cannot skip another question.")
  return { ok: true, value: nextSession(current, { status: "skipped", questionId: checked.value.questionIds[current.currentQuestionIndex] }) }
}

export function getInterviewSessionSummary(session: InterviewSession): InterviewSessionSummaryResult {
  const checked = validateSession(session)
  if (!checked.ok) return checked
  const warningCounts = new Map<string, number>()
  for (const turn of checked.value.turns) {
    if (turn.status !== "submitted") continue
    for (const warning of turn.preparation.warnings) warningCounts.set(warning.code, (warningCounts.get(warning.code) ?? 0) + 1)
  }
  const answeredQuestions = checked.value.turns.filter((turn) => turn.status === "submitted").length
  const skippedQuestions = checked.value.turns.length - answeredQuestions
  return {
    ok: true,
    value: {
      sessionId: checked.value.id,
      applicationId: checked.value.applicationId,
      status: checked.value.status,
      totalQuestions: checked.value.planQuestionIds.length,
      answeredQuestions,
      skippedQuestions,
      remainingQuestions: checked.value.planQuestionIds.length - checked.value.turns.length,
      warningCounts: [...warningCounts.entries()].map(([code, count]) => ({ code, count })).sort((left, right) => left.code.localeCompare(right.code)),
    },
  }
}
