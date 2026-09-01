import type { DocumentLanguage } from "./application-documents"
import type {
  AnswerImprovementPromptCode,
  InterviewAnswerPreparation,
  InterviewAnswerWarning,
  InterviewAnswerWarningCode,
} from "./interview-answer-preparation"
import type { InterviewPreparationPlan, InterviewQuestion, InterviewQuestionCategory } from "./interview-preparation"
import {
  getCurrentInterviewQuestion,
  getInterviewSessionSummary,
  type InterviewSession,
  type InterviewSessionStatus,
  type InterviewSessionSummary,
  type InterviewTurn,
} from "./interview-session"

export type InterviewFeedbackCategory =
  | "evidenceUse"
  | "starStructure"
  | "requirementAlignment"
  | "gapHandling"
  | "factVerification"
  | "motivation"
  | "answerStructure"
  | "sessionCoverage"

export type InterviewFeedbackCode =
  | AnswerImprovementPromptCode
  | "COMPLETE_STAR_STRUCTURE"
  | "EXPAND_ANSWER_PREPARATION"
  | "PRACTICE_SKIPPED_QUESTION"
  | "QUESTION_LINKED_EVIDENCE_CITED"
  | "STAR_STRUCTURE_COMPLETE"
  | "STAR_STRUCTURE_PARTIAL"
  | "STAR_STRUCTURE_NOT_SUPPLIED"
  | "MOTIVATION_EVIDENCE_LINKED"

export interface InterviewFeedbackItem {
  code: InterviewFeedbackCode
  category: InterviewFeedbackCategory
  message: string
  questionIds: string[]
  requirementKeys: string[]
  evidenceIds: string[]
}

export type InterviewFeedbackObservation = InterviewFeedbackItem

export interface InterviewQuestionFeedback {
  questionId: string
  category: InterviewQuestionCategory
  turnStatus: "submitted" | "skipped"
  observations: InterviewFeedbackObservation[]
  structuralStrengths: InterviewFeedbackItem[]
  cautions: InterviewFeedbackItem[]
  improvementPriorities: InterviewFeedbackItem[]
}

export interface InterviewCategoryCoverage {
  category: InterviewQuestionCategory
  answeredQuestions: number
  skippedQuestions: number
  remainingQuestions: number
}

export interface RequirementPracticeCoverage {
  requirementKey: string
  status: "practiced" | "skipped" | "notPresentInSession"
  questionIds: string[]
}

export interface InterviewSessionFeedback {
  sessionId: string
  applicationId: string
  language: DocumentLanguage
  status: InterviewSessionStatus
  structuralSummary: InterviewSessionSummary
  questionFeedback: InterviewQuestionFeedback[]
  categoryCoverage: InterviewCategoryCoverage[]
  requirementPracticeCoverage: RequirementPracticeCoverage[]
  practicePriorities: InterviewFeedbackItem[]
  semanticSupport: "notDetermined"
}

export type InterviewFeedbackErrorCode = "INVALID_INTERVIEW_PLAN" | "INVALID_INTERVIEW_SESSION" | "PLAN_SESSION_MISMATCH"
export interface InterviewFeedbackError { code: InterviewFeedbackErrorCode; message: string }
export type InterviewSessionFeedbackResult = { ok: true; value: InterviewSessionFeedback } | { ok: false; error: InterviewFeedbackError }

const CATEGORY_ORDER: InterviewQuestionCategory[] = ["roleSpecific", "gapFocused", "behavioral", "competency", "general", "situational", "motivation", "closing"]
const PRIORITY_ORDER: InterviewFeedbackCode[] = [
  "VERIFY_OR_REMOVE_PROTECTED_FACT",
  "ACKNOWLEDGE_DIRECT_EXPERIENCE_GAP",
  "EXPLAIN_CONFLICT_TRUTHFULLY",
  "DISTINGUISH_SUPPORTED_AND_DEVELOPING_AREAS",
  "CLARIFY_UNKNOWN_REQUIREMENT",
  "ADD_LINKED_EVIDENCE",
  "COMPLETE_STAR_STRUCTURE",
  "CLARIFY_PERSONAL_ACTION",
  "ADD_TRUTHFUL_RESULT_OR_OMIT_IT",
  "PRACTICE_SKIPPED_QUESTION",
  "FORMULATE_OWN_MOTIVATION",
  "EXPAND_ANSWER_PREPARATION",
]

const PRIORITY = new Map(PRIORITY_ORDER.map((code, index) => [code, index]))

function text(language: DocumentLanguage, en: string, sv: string): string { return language === "sv" ? sv : en }
function sorted(values: Iterable<string>): string[] { return [...new Set(values)].sort((a, b) => a.localeCompare(b)) }
function failure(code: InterviewFeedbackErrorCode, message: string): InterviewSessionFeedbackResult { return { ok: false, error: { code, message } } }

function validPlan(plan: unknown): plan is InterviewPreparationPlan {
  if (!plan || typeof plan !== "object") return false
  const value = plan as Partial<InterviewPreparationPlan>
  if (typeof value.applicationId !== "string" || !value.applicationId.trim() || (value.language !== "en" && value.language !== "sv") || !Array.isArray(value.questions)) return false
  const ids = new Set<string>()
  return value.questions.length > 0 && value.questions.every((question) => {
    if (!question || typeof question !== "object" || typeof question.id !== "string" || !question.id.trim() || ids.has(question.id)) return false
    ids.add(question.id)
    return CATEGORY_ORDER.includes(question.category) && Array.isArray(question.requirementKeys) && question.requirementKeys.every((key) => typeof key === "string" && key.trim())
      && Array.isArray(question.evidenceIds) && question.evidenceIds.every((id) => typeof id === "string" && id.trim())
      && Array.isArray(question.gapKeys) && question.gapKeys.every((key) => typeof key === "string" && key.trim())
  })
}

function validPreparationForFeedback(value: unknown): value is InterviewAnswerPreparation {
  if (!value || typeof value !== "object") return false
  const preparation = value as Partial<InterviewAnswerPreparation>
  const checks = preparation.structuralChecks
  return Array.isArray(preparation.citedEvidence) && preparation.citedEvidence.every((reference) => reference && typeof reference.evidenceId === "string" && (reference.status === "questionLinked" || reference.status === "candidateEvidenceOnly"))
    && Array.isArray(preparation.requirementKeys) && preparation.requirementKeys.every((key) => typeof key === "string")
    && Array.isArray(preparation.warnings) && preparation.warnings.every((warning) => warning && typeof warning.code === "string")
    && Array.isArray(preparation.improvementPrompts) && preparation.improvementPrompts.every((prompt) => prompt && typeof prompt.code === "string")
    && !!checks && typeof checks.hasQuestionLinkedEvidence === "boolean" && checks.semanticSupport === "notDetermined"
    && ["notApplicable", "notStructured", "partial", "complete"].includes(checks.star as string)
}

function item(
  code: InterviewFeedbackCode,
  category: InterviewFeedbackCategory,
  message: string,
  question: InterviewQuestion,
  requirementKeys: string[] = question.requirementKeys,
  evidenceIds: string[] = [],
): InterviewFeedbackItem {
  return { code, category, message, questionIds: [question.id], requirementKeys: sorted(requirementKeys), evidenceIds: sorted(evidenceIds) }
}

function priorityMessage(code: InterviewFeedbackCode, language: DocumentLanguage): string {
  const messages: Record<string, [string, string]> = {
    VERIFY_OR_REMOVE_PROTECTED_FACT: ["Verify or remove the unsupported protected fact before using this answer.", "Verifiera eller ta bort den obekräftade uppgiften innan du använder svaret."],
    ACKNOWLEDGE_DIRECT_EXPERIENCE_GAP: ["Acknowledge the direct-experience gap and distinguish supported adjacent experience.", "Bekräfta gapet i direkt erfarenhet och skilj ut styrkt närliggande erfarenhet."],
    EXPLAIN_CONFLICT_TRUTHFULLY: ["Clarify the conflicting requirement without choosing an unsupported interpretation.", "Förtydliga det motstridiga kravet utan att välja en tolkning som saknar stöd."],
    DISTINGUISH_SUPPORTED_AND_DEVELOPING_AREAS: ["Distinguish supported experience from development areas.", "Skilj styrkt erfarenhet från utvecklingsområden."],
    CLARIFY_UNKNOWN_REQUIREMENT: ["Clarify the unknown requirement and use careful wording.", "Förtydliga det okända kravet och använd försiktiga formuleringar."],
    ADD_LINKED_EVIDENCE: ["Add question-linked evidence where available.", "Lägg till frågeanknuten evidens där sådan finns."],
    COMPLETE_STAR_STRUCTURE: ["Complete the missing explicit STAR fields.", "Komplettera de saknade explicita STAR-fälten."],
    CLARIFY_PERSONAL_ACTION: ["Clarify the action you personally took.", "Förtydliga den åtgärd du själv vidtog."],
    ADD_TRUTHFUL_RESULT_OR_OMIT_IT: ["Add a supported result or explicitly omit it.", "Lägg till ett styrkt resultat eller utelämna det uttryckligen."],
    PRACTICE_SKIPPED_QUESTION: ["Practice the skipped question; it is currently unpracticed.", "Öva på den överhoppade frågan; den är för närvarande inte övad."],
    FORMULATE_OWN_MOTIVATION: ["Prepare your own truthful motivation for the role.", "Förbered din egen sanningsenliga motivation för rollen."],
    EXPAND_ANSWER_PREPARATION: ["Expand the answer preparation with relevant supported detail.", "Utöka svarsförberedelsen med relevant styrkt detalj."],
  }
  const value = messages[code] ?? ["Review this structural preparation signal.", "Granska denna strukturella förberedelsesignal."]
  return text(language, value[0], value[1])
}

function warningPriority(warning: InterviewAnswerWarning): { code: InterviewFeedbackCode; category: InterviewFeedbackCategory } | null {
  const map: Partial<Record<InterviewAnswerWarningCode, [InterviewFeedbackCode, InterviewFeedbackCategory]>> = {
    UNVERIFIED_PROTECTED_FACT: ["VERIFY_OR_REMOVE_PROTECTED_FACT", "factVerification"],
    POTENTIAL_GAP_CONTRADICTION: ["ACKNOWLEDGE_DIRECT_EXPERIENCE_GAP", "gapHandling"],
    MISSING_REQUIREMENT_TRUTH_REMINDER: ["ACKNOWLEDGE_DIRECT_EXPERIENCE_GAP", "gapHandling"],
    CONFLICTING_REQUIREMENT_CAUTION: ["EXPLAIN_CONFLICT_TRUTHFULLY", "requirementAlignment"],
    UNKNOWN_REQUIREMENT_CAUTION: ["CLARIFY_UNKNOWN_REQUIREMENT", "requirementAlignment"],
    NO_EVIDENCE_CITED: ["ADD_LINKED_EVIDENCE", "evidenceUse"],
    CANDIDATE_EVIDENCE_NOT_QUESTION_LINKED: ["ADD_LINKED_EVIDENCE", "evidenceUse"],
    STAR_FIELD_MISSING: ["COMPLETE_STAR_STRUCTURE", "starStructure"],
    MOTIVATION_NOT_EVIDENCE_GROUNDED: ["FORMULATE_OWN_MOTIVATION", "motivation"],
    EMPTY_ANSWER: ["EXPAND_ANSWER_PREPARATION", "answerStructure"],
    SPARSE_ANSWER: ["EXPAND_ANSWER_PREPARATION", "answerStructure"],
  }
  const mapped = map[warning.code]
  return mapped ? { code: mapped[0], category: mapped[1] } : null
}

function promptCategory(code: AnswerImprovementPromptCode): InterviewFeedbackCategory {
  if (code === "VERIFY_OR_REMOVE_PROTECTED_FACT") return "factVerification"
  if (code === "ACKNOWLEDGE_DIRECT_EXPERIENCE_GAP") return "gapHandling"
  if (code === "CLARIFY_UNKNOWN_REQUIREMENT" || code === "EXPLAIN_CONFLICT_TRUTHFULLY" || code === "DISTINGUISH_SUPPORTED_AND_DEVELOPING_AREAS") return "requirementAlignment"
  if (code === "FORMULATE_OWN_MOTIVATION") return "motivation"
  if (code === "CLARIFY_PERSONAL_ACTION" || code === "ADD_TRUTHFUL_RESULT_OR_OMIT_IT") return "starStructure"
  return "evidenceUse"
}

function dedupe(items: InterviewFeedbackItem[]): InterviewFeedbackItem[] {
  const seen = new Set<string>()
  return items.filter((value) => {
    const key = `${value.code}\u0000${value.category}\u0000${value.requirementKeys.join("\u0000")}`
    if (seen.has(key)) return false
    seen.add(key); return true
  })
}

function prioritySort(items: InterviewFeedbackItem[], questionOrder: Map<string, number>): InterviewFeedbackItem[] {
  return [...items].sort((left, right) => (PRIORITY.get(left.code) ?? 999) - (PRIORITY.get(right.code) ?? 999)
    || Math.min(...left.questionIds.map((id) => questionOrder.get(id) ?? 999)) - Math.min(...right.questionIds.map((id) => questionOrder.get(id) ?? 999))
    || left.code.localeCompare(right.code) || left.requirementKeys.join("\u0000").localeCompare(right.requirementKeys.join("\u0000")))
}

function submittedFeedback(question: InterviewQuestion, preparation: InterviewAnswerPreparation, answerFormat: "freeText" | "star", language: DocumentLanguage): InterviewQuestionFeedback {
  const observations: InterviewFeedbackItem[] = []
  const structuralStrengths: InterviewFeedbackItem[] = []
  const cautions: InterviewFeedbackItem[] = []
  const priorities: InterviewFeedbackItem[] = []
  if (preparation.structuralChecks.hasQuestionLinkedEvidence) {
    const signal = item("QUESTION_LINKED_EVIDENCE_CITED", "evidenceUse", text(language, "Structural preparation signal: question-linked evidence was cited.", "Strukturell förberedelsesignal: frågeanknuten evidens citerades."), question, preparation.requirementKeys, preparation.citedEvidence.filter((e) => e.status === "questionLinked").map((e) => e.evidenceId))
    observations.push(signal); structuralStrengths.push(signal)
  }
  if (question.category === "motivation" && preparation.structuralChecks.hasQuestionLinkedEvidence) {
    const signal = item("MOTIVATION_EVIDENCE_LINKED", "motivation", text(language, "Structural preparation signal: motivation evidence is explicitly linked.", "Strukturell förberedelsesignal: motivationsevidens är explicit länkad."), question, preparation.requirementKeys, preparation.citedEvidence.filter((e) => e.status === "questionLinked").map((e) => e.evidenceId))
    observations.push(signal); structuralStrengths.push(signal)
  }
  const star = preparation.structuralChecks.star
  if (star === "complete") {
    const signal = item("STAR_STRUCTURE_COMPLETE", "starStructure", text(language, "Structural preparation signal: explicit STAR structure is complete.", "Strukturell förberedelsesignal: explicit STAR-struktur är komplett."), question)
    observations.push(signal); structuralStrengths.push(signal)
  } else if (star === "partial") {
    observations.push(item("STAR_STRUCTURE_PARTIAL", "starStructure", text(language, "Explicit STAR structure is partial.", "Explicit STAR-struktur är partiell."), question))
  } else if (answerFormat === "freeText" && star === "notStructured") {
    observations.push(item("STAR_STRUCTURE_NOT_SUPPLIED", "starStructure", text(language, "Explicit STAR structure was not supplied; no STAR fields were inferred from prose.", "Explicit STAR-struktur angavs inte; inga STAR-fält härleddes från prosa."), question))
  }
  for (const warning of preparation.warnings) {
    const mapped = warningPriority(warning)
    if (!mapped) continue
    const caution = item(mapped.code, mapped.category, priorityMessage(mapped.code, language), question, warning.requirementKey ? [warning.requirementKey] : preparation.requirementKeys, warning.evidenceId ? [warning.evidenceId] : [])
    cautions.push(caution); priorities.push(caution)
  }
  for (const prompt of preparation.improvementPrompts) priorities.push(item(prompt.code, promptCategory(prompt.code), priorityMessage(prompt.code, language), question, prompt.requirementKey ? [prompt.requirementKey] : preparation.requirementKeys))
  return { questionId: question.id, category: question.category, turnStatus: "submitted", observations: dedupe(observations), structuralStrengths: dedupe(structuralStrengths), cautions: dedupe(cautions), improvementPriorities: dedupe(priorities) }
}

function skippedFeedback(question: InterviewQuestion, language: DocumentLanguage): InterviewQuestionFeedback {
  const priority = item("PRACTICE_SKIPPED_QUESTION", "sessionCoverage", priorityMessage("PRACTICE_SKIPPED_QUESTION", language), question)
  return { questionId: question.id, category: question.category, turnStatus: "skipped", observations: [], structuralStrengths: [], cautions: [], improvementPriorities: [priority] }
}

function aggregate(items: InterviewFeedbackItem[], language: DocumentLanguage, questionOrder: Map<string, number>): InterviewFeedbackItem[] {
  const groups = new Map<string, InterviewFeedbackItem>()
  for (const value of items) {
    const key = `${value.code}\u0000${value.category}\u0000${value.requirementKeys.join("\u0000")}`
    const existing = groups.get(key)
    if (!existing) groups.set(key, { ...value, message: priorityMessage(value.code, language), questionIds: [...value.questionIds], requirementKeys: [...value.requirementKeys], evidenceIds: [...value.evidenceIds] })
    else {
      existing.questionIds = sorted([...existing.questionIds, ...value.questionIds]).sort((a, b) => (questionOrder.get(a) ?? 999) - (questionOrder.get(b) ?? 999))
      existing.evidenceIds = sorted([...existing.evidenceIds, ...value.evidenceIds])
    }
  }
  return prioritySort([...groups.values()], questionOrder)
}

/** Derives deterministic structural practice feedback from Phase 5.1 and caller-held Phase 5.3 state. */
export function createInterviewSessionFeedback(plan: InterviewPreparationPlan, session: InterviewSession): InterviewSessionFeedbackResult {
  if (!validPlan(plan)) return failure("INVALID_INTERVIEW_PLAN", "Interview feedback requires a valid non-empty interview preparation plan.")
  const summary = getInterviewSessionSummary(session)
  if (!summary.ok) return failure("INVALID_INTERVIEW_SESSION", summary.error.message)
  const compatible = getCurrentInterviewQuestion(session, plan)
  if (!compatible.ok) return failure(compatible.error.code === "PLAN_SESSION_MISMATCH" ? "PLAN_SESSION_MISMATCH" : compatible.error.code === "INVALID_INTERVIEW_PLAN" || compatible.error.code === "EMPTY_INTERVIEW_PLAN" ? "INVALID_INTERVIEW_PLAN" : "INVALID_INTERVIEW_SESSION", compatible.error.message)
  if (session.turns.some((turn) => turn.status === "submitted" && !validPreparationForFeedback(turn.preparation))) return failure("INVALID_INTERVIEW_SESSION", "A submitted interview turn lacks required structured preparation data.")

  const questionOrder = new Map(plan.questions.map((question, index) => [question.id, index]))
  const questions = new Map(plan.questions.map((question) => [question.id, question]))
  const questionFeedback = session.turns.map((turn: InterviewTurn) => {
    const question = questions.get(turn.questionId) as InterviewQuestion
    return turn.status === "skipped" ? skippedFeedback(question, plan.language) : submittedFeedback(question, turn.preparation, turn.answerFormat, plan.language)
  })
  for (const feedback of questionFeedback) feedback.improvementPriorities = prioritySort(feedback.improvementPriorities, questionOrder)

  const turnByQuestion = new Map(session.turns.map((turn) => [turn.questionId, turn.status]))
  const categoryCoverage = CATEGORY_ORDER.filter((category) => plan.questions.some((question) => question.category === category)).map((category) => {
    const categoryQuestions = plan.questions.filter((question) => question.category === category)
    return {
      category,
      answeredQuestions: categoryQuestions.filter((question) => turnByQuestion.get(question.id) === "submitted").length,
      skippedQuestions: categoryQuestions.filter((question) => turnByQuestion.get(question.id) === "skipped").length,
      remainingQuestions: categoryQuestions.filter((question) => !turnByQuestion.has(question.id)).length,
    }
  })
  const requirementKeys = sorted(plan.questions.flatMap((question) => question.requirementKeys))
  const requirementPracticeCoverage = requirementKeys.map((requirementKey) => {
    const linked = plan.questions.filter((question) => question.requirementKeys.includes(requirementKey))
    const practiced = linked.some((question) => turnByQuestion.get(question.id) === "submitted")
    const skipped = !practiced && linked.some((question) => turnByQuestion.get(question.id) === "skipped")
    return { requirementKey, status: practiced ? "practiced" as const : skipped ? "skipped" as const : "notPresentInSession" as const, questionIds: linked.map((question) => question.id) }
  })
  const practicePriorities = aggregate(questionFeedback.flatMap((feedback) => feedback.improvementPriorities), plan.language, questionOrder)
  return { ok: true, value: { sessionId: session.id, applicationId: session.applicationId, language: plan.language, status: session.status, structuralSummary: summary.value, questionFeedback, categoryCoverage, requirementPracticeCoverage, practicePriorities, semanticSupport: "notDetermined" } }
}
