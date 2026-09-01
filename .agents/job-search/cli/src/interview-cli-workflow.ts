import type { ApplicationRecord } from "./applications"
import type { CandidateDocumentInput, DocumentLanguage } from "./application-documents"
import { generateInterviewAIProposal, type InterviewAIGenerationResult, type InterviewAIGenerator } from "./interview-ai"
import { createInterviewSessionFeedback, type InterviewSessionFeedback } from "./interview-feedback"
import {
  createInterviewPreparationPlan,
  type InterviewPreparationPlan,
  type InterviewQuestion,
  type InterviewType,
} from "./interview-preparation"
import {
  skipCurrentInterviewQuestion,
  startInterviewSession,
  submitInterviewAnswer,
  type InterviewSession,
} from "./interview-session"

export interface InterviewCliWorkflowInput {
  application: ApplicationRecord
  documentEvidence: Omit<CandidateDocumentInput, "matchingProfile">
  questionId?: string
  language?: DocumentLanguage
  interviewType?: InterviewType
  answer?: { text: string; citedEvidenceIds?: string[] }
  generator?: InterviewAIGenerator
}

export interface InterviewCliPreparationSuccess {
  ok: true
  mode: "preparation"
  plan: InterviewPreparationPlan
  question: InterviewQuestion
}

export interface InterviewCliEvaluationSuccess {
  ok: true
  mode: "evaluation"
  plan: InterviewPreparationPlan
  question: InterviewQuestion
  session: InterviewSession
  deterministicFeedback: InterviewSessionFeedback
  ai?: InterviewAIGenerationResult
}

export type InterviewCliWorkflowErrorStage = "preparation" | "questionSelection" | "session" | "answerPreparation" | "feedback"
export interface InterviewCliWorkflowError {
  stage: InterviewCliWorkflowErrorStage
  code: string
  message: string
}

export type InterviewCliWorkflowResult =
  | InterviewCliPreparationSuccess
  | InterviewCliEvaluationSuccess
  | { ok: false; error: InterviewCliWorkflowError }

function failure(stage: InterviewCliWorkflowErrorStage, code: string, message: string): InterviewCliWorkflowResult {
  return { ok: false, error: { stage, code, message } }
}

/** One-shot, I/O-free composition of the existing immutable Phase 5 APIs. */
export async function runInterviewCliWorkflow(input: InterviewCliWorkflowInput): Promise<InterviewCliWorkflowResult> {
  const prepared = createInterviewPreparationPlan(input.application, input.documentEvidence, {
    ...(input.language ? { language: input.language } : {}),
    ...(input.interviewType ? { interviewType: input.interviewType } : {}),
  })
  if (!prepared.ok) return failure("preparation", prepared.error.code, prepared.error.message)

  const plan = prepared.value
  const question = input.questionId
    ? plan.questions.find((candidate) => candidate.id === input.questionId)
    : plan.questions[0]
  if (!question) return failure("questionSelection", "UNKNOWN_QUESTION_ID", "Selected question ID does not exist in the deterministic interview plan.")
  if (!input.answer) return { ok: true, mode: "preparation", plan, question }

  const started = startInterviewSession(plan, { sessionId: `phase-5.5c:${plan.applicationId}:${question.id}` })
  if (!started.ok) return failure("session", started.error.code, started.error.message)
  let session = started.value
  while (session.planQuestionIds[session.currentQuestionIndex] !== question.id) {
    const skipped = skipCurrentInterviewQuestion(session, plan)
    if (!skipped.ok) {
      const error = "stage" in skipped.error ? skipped.error.error : skipped.error
      return failure("session", error.code, error.message)
    }
    session = skipped.value
  }

  const answer = {
    questionId: question.id,
    format: "freeText" as const,
    text: input.answer.text,
    ...(input.answer.citedEvidenceIds ? { citedEvidenceIds: [...input.answer.citedEvidenceIds] } : {}),
  }
  const submitted = submitInterviewAnswer(session, plan, input.documentEvidence, answer)
  if (!submitted.ok) {
    if ("stage" in submitted.error) return failure("answerPreparation", submitted.error.error.code, submitted.error.error.message)
    return failure("session", submitted.error.code, submitted.error.message)
  }
  session = submitted.value

  const feedback = createInterviewSessionFeedback(plan, session)
  if (!feedback.ok) return failure("feedback", feedback.error.code, feedback.error.message)
  const ai = input.generator
    ? await generateInterviewAIProposal(plan, session, input.documentEvidence, answer, input.generator)
    : undefined
  return {
    ok: true,
    mode: "evaluation",
    plan,
    question,
    session,
    deterministicFeedback: feedback.value,
    ...(ai ? { ai } : {}),
  }
}
