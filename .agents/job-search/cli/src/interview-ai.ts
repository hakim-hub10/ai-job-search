import {
  buildCandidateEvidenceCatalog,
  type CandidateDocumentInput,
  type CandidateEvidence,
  type DocumentLanguage,
} from "./application-documents"
import {
  prepareInterviewAnswer,
  type AnswerEvidenceReference,
  type AnswerImprovementPromptCode,
  type AnswerStructuralChecks,
  type InterviewAnswerInput,
  type InterviewAnswerPreparation,
  type InterviewAnswerWarning,
  type InterviewAnswerWarningCode,
  type InterviewStarAnswer,
} from "./interview-answer-preparation"
import {
  createInterviewSessionFeedback,
  type InterviewFeedbackCategory,
  type InterviewFeedbackCode,
  type InterviewFeedbackItem,
} from "./interview-feedback"
import type { InterviewPreparationPlan, InterviewQuestionCategory, InterviewType } from "./interview-preparation"
import { getCurrentInterviewQuestion, getInterviewSessionSummary, type InterviewSession } from "./interview-session"

export interface InterviewAIGenerator {
  generate(request: InterviewAIRequest): Promise<InterviewAIProviderResponse>
}

export interface InterviewAIApprovedEvidence {
  id: string
  kind: CandidateEvidence["kind"]
  content: string
  context?: CandidateEvidence["context"]
}

export interface InterviewAIWarningContext {
  code: InterviewAnswerWarningCode
  evidenceId?: string
  requirementKey?: string
  starField?: keyof InterviewStarAnswer
  protectedFactKind?: NonNullable<InterviewAnswerWarning["protectedFactKind"]>
}

export interface InterviewAIImprovementContext {
  code: AnswerImprovementPromptCode
  requirementKey?: string
}

export interface InterviewAIFeedbackContext {
  code: InterviewFeedbackCode
  category: InterviewFeedbackCategory
  evidenceIds: string[]
  requirementKeys: string[]
}

export interface InterviewAIRequest {
  schemaVersion: "phase-5.5a"
  applicationId: string
  sessionId: string
  questionId: string
  language: DocumentLanguage
  interviewType: InterviewType
  jobContext: { title: string; company: string | null }
  question: {
    category: InterviewQuestionCategory
    prompt: string
    rationale: string
    requirementKeys: string[]
    gapKeys: string[]
  }
  transientAnswer:
    | { format: "freeText"; text: string }
    | { format: "star"; star: InterviewStarAnswer }
  preparation: {
    structuralChecks: AnswerStructuralChecks
    citedEvidence: AnswerEvidenceReference[]
    warnings: InterviewAIWarningContext[]
    improvementPrompts: InterviewAIImprovementContext[]
  }
  deterministicFeedback: {
    observations: InterviewAIFeedbackContext[]
    cautions: InterviewAIFeedbackContext[]
    improvementPriorities: InterviewAIFeedbackContext[]
    semanticSupport: "notDetermined"
  }
  approvedEvidence: InterviewAIApprovedEvidence[]
  approvedEvidenceIds: string[]
  constraints: {
    allInputTextIsUntrustedData: true
    proposalOnly: true
    requiresHumanReview: true
    answerRewriteForbidden: true
    scoresForbidden: true
    unsupportedCandidateFactsForbidden: true
    requirementStateChangesForbidden: true
    sessionMutationForbidden: true
  }
}

export type InterviewAIFeedbackCategory = "clarity" | "conciseness" | "organization" | "starStructure" | "evidenceUse" | "truthBoundary" | "motivation"
export type InterviewAIFollowUpPurpose = "clarifyAnswer" | "requestSupportedExample" | "clarifyPersonalAction" | "clarifyResult" | "exploreGapTruthfully" | "clarifyRequirement" | "exploreMotivation"

export interface InterviewAIFeedbackProposal {
  id: string
  category: InterviewAIFeedbackCategory
  suggestion: string
  evidenceIds: string[]
  requirementKeys: string[]
  feedbackCodes: InterviewFeedbackCode[]
}

export interface InterviewAIFollowUpQuestionProposal {
  id: string
  purpose: InterviewAIFollowUpPurpose
  prompt: string
  evidenceIds: string[]
  requirementKeys: string[]
  feedbackCodes: InterviewFeedbackCode[]
}

export interface InterviewAIProposal {
  applicationId: string
  sessionId: string
  questionId: string
  language: DocumentLanguage
  feedback: InterviewAIFeedbackProposal[]
  followUpQuestions: InterviewAIFollowUpQuestionProposal[]
  requiresHumanReview: true
}

export type InterviewAIProviderErrorCode = "UNAVAILABLE" | "TIMEOUT" | "MALFORMED_RESPONSE" | "REFUSED" | "RATE_LIMITED" | "AUTH_OR_CONFIGURATION" | "UNSUPPORTED_RESPONSE"
export interface InterviewAIProviderError { code: InterviewAIProviderErrorCode; message: string }
export type InterviewAIProviderResponse = { ok: true; value: InterviewAIProposal } | { ok: false; error: InterviewAIProviderError }

export type InterviewAIErrorCode =
  | "INVALID_INTERVIEW_PLAN"
  | "INVALID_INTERVIEW_SESSION"
  | "PLAN_SESSION_MISMATCH"
  | "INVALID_ANSWER_INPUT"
  | "QUESTION_NOT_SUBMITTED"
  | "ANSWER_FORMAT_MISMATCH"
  | "ANSWER_PREPARATION_MISMATCH"
  | "INVALID_DOCUMENT_INPUT"
  | "INVALID_AI_REQUEST"
  | "MALFORMED_PROVIDER_PROPOSAL"
  | "PROPOSAL_CONTEXT_MISMATCH"
  | "UNSUPPORTED_PROPOSAL_CATEGORY"
  | "UNSUPPORTED_FOLLOW_UP_PURPOSE"
  | "DUPLICATE_PROPOSAL_ID"
  | "UNAPPROVED_EVIDENCE_REFERENCE"
  | "UNAPPROVED_REQUIREMENT_REFERENCE"
  | "UNAPPROVED_FEEDBACK_CODE"
  | "UNSUPPORTED_PROTECTED_FACT"
  | "POTENTIAL_GAP_CONTRADICTION"

export interface InterviewAIError { code: InterviewAIErrorCode; message: string; itemId?: string; evidenceId?: string; requirementKey?: string }
export type InterviewAIRequestResult = { ok: true; value: InterviewAIRequest } | { ok: false; error: InterviewAIError }
export interface InterviewAIValidationResult { valid: boolean; requiresHumanReview: true; errors: InterviewAIError[] }
export type InterviewAIGenerationResult = { ok: true; value: { proposal: InterviewAIProposal; requiresHumanReview: true } } | { ok: false; error: InterviewAIError | InterviewAIProviderError }

// Provider output is deliberately small and reviewable.
const MAX_FEEDBACK_ITEMS = 5
const MAX_FOLLOW_UP_QUESTIONS = 3
const MAX_ID_LENGTH = 120
const MAX_SUGGESTION_LENGTH = 800
const MAX_FOLLOW_UP_PROMPT_LENGTH = 500
const MAX_REFERENCES_PER_ITEM = 20
const FEEDBACK_CATEGORIES: InterviewAIFeedbackCategory[] = ["clarity", "conciseness", "organization", "starStructure", "evidenceUse", "truthBoundary", "motivation"]
const FOLLOW_UP_PURPOSES: InterviewAIFollowUpPurpose[] = ["clarifyAnswer", "requestSupportedExample", "clarifyPersonalAction", "clarifyResult", "exploreGapTruthfully", "clarifyRequirement", "exploreMotivation"]
const PROVIDER_ERROR_CODES: InterviewAIProviderErrorCode[] = ["UNAVAILABLE", "TIMEOUT", "MALFORMED_RESPONSE", "REFUSED", "RATE_LIMITED", "AUTH_OR_CONFIGURATION", "UNSUPPORTED_RESPONSE"]
const PROPOSAL_KEYS = ["applicationId", "sessionId", "questionId", "language", "feedback", "followUpQuestions", "requiresHumanReview"]
const FEEDBACK_KEYS = ["id", "category", "suggestion", "evidenceIds", "requirementKeys", "feedbackCodes"]
const FOLLOW_UP_KEYS = ["id", "purpose", "prompt", "evidenceIds", "requirementKeys", "feedbackCodes"]

function freeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child)
  return value
}

function hasText(value: unknown, max = Number.POSITIVE_INFINITY): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= max }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value) }
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key)) }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.length <= MAX_REFERENCES_PER_ITEM && value.every((item) => hasText(item, MAX_ID_LENGTH)) }
function unique(values: string[]): boolean { return new Set(values).size === values.length }
function failure(code: InterviewAIErrorCode, message: string, details: Partial<Pick<InterviewAIError, "itemId" | "evidenceId" | "requirementKey">> = {}): InterviewAIRequestResult { return { ok: false, error: { code, message, ...details } } }
function validationError(code: InterviewAIErrorCode, message: string, details: Partial<Pick<InterviewAIError, "itemId" | "evidenceId" | "requirementKey">> = {}): InterviewAIError { return { code, message, ...details } }
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right) }

function safeProviderError(code: InterviewAIProviderErrorCode): InterviewAIProviderError {
  const messages: Record<InterviewAIProviderErrorCode, string> = {
    UNAVAILABLE: "Interview AI generator is unavailable.", TIMEOUT: "Interview AI generator timed out.",
    MALFORMED_RESPONSE: "Interview AI generator returned a malformed response.", REFUSED: "Interview AI generator refused the request.",
    RATE_LIMITED: "Interview AI generator rate limit reached.", AUTH_OR_CONFIGURATION: "Interview AI generator authentication or configuration failed.",
    UNSUPPORTED_RESPONSE: "Interview AI generator returned an unsupported response.",
  }
  return { code, message: messages[code] }
}

function feedbackProjection(items: InterviewFeedbackItem[]): InterviewAIFeedbackContext[] {
  return items.map((item) => ({ code: item.code, category: item.category, evidenceIds: [...item.evidenceIds], requirementKeys: [...item.requirementKeys] }))
}

function cloneEvidence(evidence: CandidateEvidence): InterviewAIApprovedEvidence {
  return { id: evidence.id, kind: evidence.kind, content: evidence.content, ...(evidence.context ? { context: structuredClone(evidence.context) } : {}) }
}

/** Builds a frozen one-question request after binding transient answer text to the retained submitted turn. */
export function buildInterviewAIRequest(
  plan: InterviewPreparationPlan,
  session: InterviewSession,
  documentInput: Omit<CandidateDocumentInput, "matchingProfile">,
  answer: InterviewAnswerInput,
): InterviewAIRequestResult {
  const summary = getInterviewSessionSummary(session)
  if (!summary.ok) return failure("INVALID_INTERVIEW_SESSION", summary.error.message)
  const compatible = getCurrentInterviewQuestion(session, plan)
  if (!compatible.ok) {
    const code = compatible.error.code === "PLAN_SESSION_MISMATCH" ? "PLAN_SESSION_MISMATCH" : compatible.error.code === "INVALID_INTERVIEW_PLAN" || compatible.error.code === "EMPTY_INTERVIEW_PLAN" ? "INVALID_INTERVIEW_PLAN" : "INVALID_INTERVIEW_SESSION"
    return failure(code, compatible.error.message)
  }
  if (!answer || typeof answer !== "object" || !hasText((answer as Partial<InterviewAnswerInput>).questionId)) return failure("INVALID_ANSWER_INPUT", "Transient answer input must identify a question.")
  const turn = session.turns.find((item) => item.questionId === answer.questionId)
  if (!turn || turn.status !== "submitted") return failure("QUESTION_NOT_SUBMITTED", "Phase 5.5A requires an already-submitted interview question.")
  if (turn.answerFormat !== answer.format) return failure("ANSWER_FORMAT_MISMATCH", "Transient answer format does not match the submitted turn.")
  const recreated = prepareInterviewAnswer(plan, documentInput, answer)
  if (!recreated.ok) return failure(recreated.error.code === "INVALID_ANSWER_INPUT" ? "INVALID_DOCUMENT_INPUT" : "INVALID_ANSWER_INPUT", recreated.error.message, recreated.error.evidenceId ? { evidenceId: recreated.error.evidenceId } : {})
  if (!same(recreated.value, turn.preparation)) return failure("ANSWER_PREPARATION_MISMATCH", "Transient answer does not recreate the retained structural preparation.")
  const deterministic = createInterviewSessionFeedback(plan, session)
  if (!deterministic.ok) return failure(deterministic.error.code, deterministic.error.message)
  const questionFeedback = deterministic.value.questionFeedback.find((item) => item.questionId === answer.questionId)
  const question = plan.questions.find((item) => item.id === answer.questionId)
  if (!questionFeedback || !question) return failure("QUESTION_NOT_SUBMITTED", "Submitted question context is unavailable.")
  const candidateOnly: Omit<CandidateDocumentInput, "matchingProfile"> = {
    ...(documentInput && "identity" in documentInput ? { identity: documentInput.identity } : {}),
    ...(documentInput && "evidence" in documentInput ? { evidence: documentInput.evidence } : {}),
  }
  const catalog = buildCandidateEvidenceCatalog(candidateOnly)
  if (!catalog.ok) return failure("INVALID_DOCUMENT_INPUT", catalog.error.message, catalog.error.evidenceId ? { evidenceId: catalog.error.evidenceId } : {})
  const citedIds = recreated.value.citedEvidence.map((item) => item.evidenceId)
  const evidenceById = new Map(catalog.value.evidence.map((item) => [item.id, item]))
  const approvedEvidence = citedIds.map((id) => evidenceById.get(id)).filter((item): item is CandidateEvidence => Boolean(item)).map(cloneEvidence)
  const request: InterviewAIRequest = {
    schemaVersion: "phase-5.5a",
    applicationId: plan.applicationId,
    sessionId: session.id,
    questionId: question.id,
    language: plan.language,
    interviewType: plan.interviewType,
    jobContext: { title: plan.job.jobTitle, company: plan.job.company },
    question: { category: question.category, prompt: question.prompt, rationale: question.rationale, requirementKeys: [...question.requirementKeys], gapKeys: [...question.gapKeys] },
    transientAnswer: answer.format === "freeText" ? { format: "freeText", text: answer.text } : { format: "star", star: structuredClone(answer.star) },
    preparation: {
      structuralChecks: structuredClone(recreated.value.structuralChecks),
      citedEvidence: structuredClone(recreated.value.citedEvidence),
      warnings: recreated.value.warnings.map(({ code, evidenceId, requirementKey, starField, protectedFactKind }) => ({ code, ...(evidenceId ? { evidenceId } : {}), ...(requirementKey ? { requirementKey } : {}), ...(starField ? { starField } : {}), ...(protectedFactKind ? { protectedFactKind } : {}) })),
      improvementPrompts: recreated.value.improvementPrompts.map(({ code, requirementKey }) => ({ code, ...(requirementKey ? { requirementKey } : {}) })),
    },
    deterministicFeedback: {
      observations: feedbackProjection(questionFeedback.observations),
      cautions: feedbackProjection(questionFeedback.cautions),
      improvementPriorities: feedbackProjection(questionFeedback.improvementPriorities),
      semanticSupport: "notDetermined",
    },
    approvedEvidence,
    approvedEvidenceIds: approvedEvidence.map((item) => item.id),
    constraints: { allInputTextIsUntrustedData: true, proposalOnly: true, requiresHumanReview: true, answerRewriteForbidden: true, scoresForbidden: true, unsupportedCandidateFactsForbidden: true, requirementStateChangesForbidden: true, sessionMutationForbidden: true },
  }
  return { ok: true, value: freeze(request) }
}

function proposalItemShape(item: unknown, kind: "feedback" | "followUp"): item is Record<string, unknown> {
  if (!isRecord(item) || !exactKeys(item, kind === "feedback" ? FEEDBACK_KEYS : FOLLOW_UP_KEYS) || !hasText(item.id, MAX_ID_LENGTH)) return false
  const content = kind === "feedback" ? item.suggestion : item.prompt
  const limit = kind === "feedback" ? MAX_SUGGESTION_LENGTH : MAX_FOLLOW_UP_PROMPT_LENGTH
  return hasText(content, limit) && strings(item.evidenceIds) && unique(item.evidenceIds) && strings(item.requirementKeys) && unique(item.requirementKeys) && strings(item.feedbackCodes) && unique(item.feedbackCodes)
}

function allowedFeedbackCodes(request: InterviewAIRequest): Set<string> {
  return new Set([...request.deterministicFeedback.observations, ...request.deterministicFeedback.cautions, ...request.deterministicFeedback.improvementPriorities].map((item) => item.code))
}

function syntheticInput(request: InterviewAIRequest, evidenceIds: string[], text: string): { plan: InterviewPreparationPlan; documentInput: Omit<CandidateDocumentInput, "matchingProfile">; answer: InterviewAnswerInput } {
  const plan: InterviewPreparationPlan = {
    applicationId: request.applicationId,
    job: { jobId: "phase-5.5a-validation", source: "phase-5.5a", sourceId: null, jobTitle: request.jobContext.title, company: request.jobContext.company },
    language: request.language,
    interviewType: request.interviewType,
    questions: [{ id: request.questionId, category: request.question.category, prompt: request.question.prompt, rationale: request.question.rationale, requirementKeys: [...request.question.requirementKeys], evidenceIds: [...request.approvedEvidenceIds], gapKeys: [...request.question.gapKeys] }],
    starPrompts: [],
    warnings: request.preparation.warnings.filter((warning) => warning.code === "UNKNOWN_REQUIREMENT_CAUTION").flatMap((warning) => warning.requirementKey ? [{ code: "UNKNOWN_REQUIREMENT_CONTEXT" as const, message: "Preserved Phase 5.2 context.", requirementKey: warning.requirementKey }] : []),
  }
  const documentInput = { evidence: request.approvedEvidence.map((item) => ({ id: item.id, kind: item.kind, content: item.content, ...(item.context ? { context: structuredClone(item.context) } : {}) })) }
  return { plan, documentInput, answer: { questionId: request.questionId, format: "freeText", text, citedEvidenceIds: [...evidenceIds] } }
}

/** Strictly validates an untrusted proposal; passing never implies semantic truth. */
export function validateInterviewAIProposal(request: InterviewAIRequest, proposal: InterviewAIProposal): InterviewAIValidationResult {
  const errors: InterviewAIError[] = []
  if (!isRecord(proposal) || !exactKeys(proposal, PROPOSAL_KEYS) || !Array.isArray(proposal.feedback) || !Array.isArray(proposal.followUpQuestions)) {
    return { valid: false, requiresHumanReview: true, errors: [validationError("MALFORMED_PROVIDER_PROPOSAL", "Provider proposal must use the strict Phase 5.5A schema.")] }
  }
  if (proposal.applicationId !== request.applicationId || proposal.sessionId !== request.sessionId || proposal.questionId !== request.questionId || proposal.language !== request.language) errors.push(validationError("PROPOSAL_CONTEXT_MISMATCH", "Provider proposal does not preserve the requested interview context."))
  if (proposal.requiresHumanReview !== true) errors.push(validationError("MALFORMED_PROVIDER_PROPOSAL", "Every provider proposal must require human review."))
  if (proposal.feedback.length > MAX_FEEDBACK_ITEMS || proposal.followUpQuestions.length > MAX_FOLLOW_UP_QUESTIONS) errors.push(validationError("MALFORMED_PROVIDER_PROPOSAL", "Provider proposal exceeds the bounded item limits."))
  const ids = new Set<string>()
  const approvedEvidence = new Set(request.approvedEvidenceIds)
  const approvedRequirements = new Set([...request.question.requirementKeys, ...request.question.gapKeys])
  const approvedCodes = allowedFeedbackCodes(request)
  const allItems: Array<{ kind: "feedback" | "followUp"; value: unknown }> = [
    ...proposal.feedback.map((value) => ({ kind: "feedback" as const, value })),
    ...proposal.followUpQuestions.map((value) => ({ kind: "followUp" as const, value })),
  ]
  for (const entry of allItems) {
    if (!proposalItemShape(entry.value, entry.kind)) { errors.push(validationError("MALFORMED_PROVIDER_PROPOSAL", "Provider proposal item has an invalid or oversized shape.")); continue }
    const item = entry.value
    const itemId = item.id as string
    if (ids.has(itemId)) errors.push(validationError("DUPLICATE_PROPOSAL_ID", "Provider proposal item IDs must be unique.", { itemId }))
    ids.add(itemId)
    if (entry.kind === "feedback" && !FEEDBACK_CATEGORIES.includes(item.category as InterviewAIFeedbackCategory)) errors.push(validationError("UNSUPPORTED_PROPOSAL_CATEGORY", "Provider feedback category is unsupported.", { itemId }))
    if (entry.kind === "followUp" && !FOLLOW_UP_PURPOSES.includes(item.purpose as InterviewAIFollowUpPurpose)) errors.push(validationError("UNSUPPORTED_FOLLOW_UP_PURPOSE", "Provider follow-up purpose is unsupported.", { itemId }))
    const evidenceId = (item.evidenceIds as string[]).find((id) => !approvedEvidence.has(id))
    if (evidenceId) errors.push(validationError("UNAPPROVED_EVIDENCE_REFERENCE", "Provider item references evidence outside the minimized approved set.", { itemId, evidenceId }))
    const requirementKey = (item.requirementKeys as string[]).find((key) => !approvedRequirements.has(key))
    if (requirementKey) errors.push(validationError("UNAPPROVED_REQUIREMENT_REFERENCE", "Provider item references a requirement outside the current question.", { itemId, requirementKey }))
    if ((item.feedbackCodes as string[]).some((code) => !approvedCodes.has(code))) errors.push(validationError("UNAPPROVED_FEEDBACK_CODE", "Provider item references feedback not present in deterministic Phase 5.4 context.", { itemId }))
    if (evidenceId || requirementKey) continue
    const text = String(entry.kind === "feedback" ? item.suggestion : item.prompt)
    const synthetic = syntheticInput(request, item.evidenceIds as string[], text)
    const checked = prepareInterviewAnswer(synthetic.plan, synthetic.documentInput, synthetic.answer)
    if (!checked.ok) { errors.push(validationError("MALFORMED_PROVIDER_PROPOSAL", "Provider item could not be checked against approved evidence.", { itemId })); continue }
    if (checked.value.warnings.some((warning) => warning.code === "UNVERIFIED_PROTECTED_FACT")) errors.push(validationError("UNSUPPORTED_PROTECTED_FACT", "Provider item contains a protected fact unsupported by its approved evidence.", { itemId }))
    if (checked.value.warnings.some((warning) => warning.code === "POTENTIAL_GAP_CONTRADICTION")) errors.push(validationError("POTENTIAL_GAP_CONTRADICTION", "Provider item may contradict a retained missing-requirement state.", { itemId }))
  }
  return { valid: errors.length === 0, requiresHumanReview: true, errors }
}

/** Invokes only the explicitly supplied provider, then validates and returns proposal data without raw input. */
export async function generateInterviewAIProposal(
  plan: InterviewPreparationPlan,
  session: InterviewSession,
  documentInput: Omit<CandidateDocumentInput, "matchingProfile">,
  answer: InterviewAnswerInput,
  generator: InterviewAIGenerator,
): Promise<InterviewAIGenerationResult> {
  const request = buildInterviewAIRequest(plan, session, documentInput, answer)
  if (!request.ok) return request
  let response: InterviewAIProviderResponse
  try { response = await generator.generate(request.value) } catch { return { ok: false, error: { code: "UNAVAILABLE", message: "Interview AI generator did not return a response." } } }
  if (!response || typeof response !== "object" || typeof response.ok !== "boolean") return { ok: false, error: safeProviderError("MALFORMED_RESPONSE") }
  if (!response.ok) {
    if (!response.error || typeof response.error !== "object" || !PROVIDER_ERROR_CODES.includes(response.error.code)) return { ok: false, error: safeProviderError("MALFORMED_RESPONSE") }
    return { ok: false, error: safeProviderError(response.error.code) }
  }
  const proposal = structuredClone(response.value)
  const validation = validateInterviewAIProposal(request.value, proposal)
  if (!validation.valid) return { ok: false, error: validation.errors[0] }
  return { ok: true, value: { proposal: freeze(proposal), requiresHumanReview: true } }
}
