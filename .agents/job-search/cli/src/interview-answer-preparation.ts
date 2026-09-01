import {
  buildCandidateEvidenceCatalog,
  type CandidateEvidence,
  type CandidateDocumentInput,
  type DocumentLanguage,
} from "./application-documents"
import type { InterviewPreparationPlan, InterviewQuestion, InterviewQuestionCategory } from "./interview-preparation"

export interface InterviewStarAnswer {
  situation?: string
  task?: string
  action?: string
  result?: string
}

export type InterviewAnswerInput =
  | { questionId: string; format: "freeText"; text: string; citedEvidenceIds?: string[] }
  | { questionId: string; format: "star"; star: InterviewStarAnswer; citedEvidenceIds?: string[] }

export type AnswerEvidenceReferenceStatus = "questionLinked" | "candidateEvidenceOnly"
export interface AnswerEvidenceReference {
  evidenceId: string
  status: AnswerEvidenceReferenceStatus
}

export interface AnswerStructuralChecks {
  hasAnswerContent: boolean
  hasEvidenceCitation: boolean
  hasQuestionLinkedEvidence: boolean
  star: "notApplicable" | "notStructured" | "partial" | "complete"
  semanticSupport: "notDetermined"
}

export type InterviewAnswerWarningCode =
  | "EMPTY_ANSWER"
  | "SPARSE_ANSWER"
  | "NO_EVIDENCE_CITED"
  | "CANDIDATE_EVIDENCE_NOT_QUESTION_LINKED"
  | "UNVERIFIED_PROTECTED_FACT"
  | "STAR_FIELD_MISSING"
  | "MISSING_REQUIREMENT_TRUTH_REMINDER"
  | "POTENTIAL_GAP_CONTRADICTION"
  | "UNKNOWN_REQUIREMENT_CAUTION"
  | "CONFLICTING_REQUIREMENT_CAUTION"
  | "MOTIVATION_NOT_EVIDENCE_GROUNDED"
  | "SEMANTIC_SUPPORT_NOT_DETERMINED"

export interface InterviewAnswerWarning {
  code: InterviewAnswerWarningCode
  message: string
  evidenceId?: string
  requirementKey?: string
  starField?: keyof InterviewStarAnswer
  protectedFactKind?: "percentage" | "currency" | "date" | "duration" | "number" | "named"
  protectedFactToken?: string
}

export type AnswerImprovementPromptCode =
  | "ADD_LINKED_EVIDENCE"
  | "CLARIFY_PERSONAL_ACTION"
  | "ADD_TRUTHFUL_RESULT_OR_OMIT_IT"
  | "VERIFY_OR_REMOVE_PROTECTED_FACT"
  | "ACKNOWLEDGE_DIRECT_EXPERIENCE_GAP"
  | "CLARIFY_UNKNOWN_REQUIREMENT"
  | "EXPLAIN_CONFLICT_TRUTHFULLY"
  | "FORMULATE_OWN_MOTIVATION"
  | "DISTINGUISH_SUPPORTED_AND_DEVELOPING_AREAS"

export interface AnswerImprovementPrompt {
  code: AnswerImprovementPromptCode
  message: string
  requirementKey?: string
}

export interface InterviewAnswerPreparation {
  applicationId: string
  questionId: string
  language: DocumentLanguage
  questionCategory: InterviewQuestionCategory
  citedEvidence: AnswerEvidenceReference[]
  questionEvidenceIds: string[]
  requirementKeys: string[]
  gapKeys: string[]
  structuralChecks: AnswerStructuralChecks
  warnings: InterviewAnswerWarning[]
  improvementPrompts: AnswerImprovementPrompt[]
}

export type InterviewAnswerPreparationErrorCode =
  | "INVALID_INTERVIEW_PLAN"
  | "UNKNOWN_QUESTION_ID"
  | "INVALID_ANSWER_INPUT"
  | "UNKNOWN_EVIDENCE_ID"
  | "DUPLICATE_EVIDENCE_ID"

export interface InterviewAnswerPreparationError {
  code: InterviewAnswerPreparationErrorCode
  message: string
  evidenceId?: string
}

export type InterviewAnswerPreparationResult =
  | { ok: true; value: InterviewAnswerPreparation }
  | { ok: false; error: InterviewAnswerPreparationError }

/** A short answer is a preparation signal, not a quality judgment. */
const SPARSE_ANSWER_LENGTH = 40
const NAMED_EVIDENCE_KINDS = new Set<string>(["certification", "education", "language"])

function text(language: DocumentLanguage, en: string, sv: string): string {
  return language === "sv" ? sv : en
}

function failure(code: InterviewAnswerPreparationErrorCode, message: string, evidenceId?: string): InterviewAnswerPreparationResult {
  return { ok: false, error: { code, message, ...(evidenceId ? { evidenceId } : {}) } }
}

function isPlan(value: unknown): value is InterviewPreparationPlan {
  if (!value || typeof value !== "object") return false
  const plan = value as Partial<InterviewPreparationPlan>
  return typeof plan.applicationId === "string" && plan.applicationId.trim().length > 0
    && (plan.language === "en" || plan.language === "sv") && Array.isArray(plan.questions)
}

function answerText(answer: InterviewAnswerInput): string {
  return answer.format === "freeText"
    ? answer.text
    : [answer.star.situation, answer.star.task, answer.star.action, answer.star.result].filter((value): value is string => typeof value === "string").join("\n")
}

function validAnswer(answer: unknown): answer is InterviewAnswerInput {
  if (!answer || typeof answer !== "object") return false
  const input = answer as Partial<InterviewAnswerInput>
  if (typeof input.questionId !== "string" || !input.questionId.trim()) return false
  if (input.format === "freeText") return typeof input.text === "string" && (input.citedEvidenceIds === undefined || Array.isArray(input.citedEvidenceIds))
  if (input.format !== "star" || !input.star || typeof input.star !== "object" || (input.citedEvidenceIds !== undefined && !Array.isArray(input.citedEvidenceIds))) return false
  return [input.star.situation, input.star.task, input.star.action, input.star.result].every((value) => value === undefined || typeof value === "string")
}

function canonicalToken(value: string): string {
  return value.toLowerCase().replace(/\s+/gu, "").replace(",", ".")
}

function protectedTokens(value: string): Array<{ kind: NonNullable<InterviewAnswerWarning["protectedFactKind"]>; token: string }> {
  const patterns: Array<[NonNullable<InterviewAnswerWarning["protectedFactKind"]>, RegExp]> = [
    ["percentage", /\b\d+(?:[.,]\d+)?\s*%/gu],
    ["currency", /(?:€|\$|£)\s*\d+(?:[.,]\d+)?(?:\s?(?:k|m))?|\b(?:SEK|EUR|USD|DKK|kr)\s*\d+(?:[.,]\d+)?/giu],
    ["date", /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/gu],
    ["duration", /\b\d+(?:[.,]\d+)?\s+(?:years?|months?|weeks?|days?|år|månader|veckor|dagar)\b/giu],
    ["number", /\b\d+(?:[.,]\d+)?\b/gu],
  ]
  const tokens = patterns.flatMap(([kind, pattern]) => [...value.matchAll(pattern)].map((match) => ({ kind, token: match[0] })))
  const specific = tokens.filter((item) => item.kind !== "number").map((item) => canonicalToken(item.token))
  return tokens.filter((item) => item.kind !== "number" || !specific.some((token) => token.includes(canonicalToken(item.token)))).sort((left, right) => left.kind.localeCompare(right.kind) || left.token.localeCompare(right.token))
}

/** Only values explicitly structured as candidate facts are compared; this is not NER. */
function namedStructuredFacts(evidence: CandidateEvidence[]): string[] {
  return [...new Set(evidence.flatMap((item) => [
    ...(item.context ? [item.context.employer, item.context.role, item.context.location].filter((value): value is string => typeof value === "string") : []),
    ...(NAMED_EVIDENCE_KINDS.has(item.kind) ? [item.content] : []),
  ]).filter((value) => value.trim().length >= 4))].sort((left, right) => left.localeCompare(right))
}

function questionHasWarning(plan: InterviewPreparationPlan, question: InterviewQuestion, code: string): boolean {
  return question.requirementKeys.some((key) => plan.warnings.some((warning) => warning.code === code && warning.requirementKey === key))
}

function gapContradiction(answer: string, key: string): boolean {
  const requirement = key.slice(key.indexOf(":") + 1).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  if (!requirement) return false
  const patterns = [
    new RegExp(`\\b(?:i have|i worked with|i have worked with|i used|jag har|jag har arbetat med|jag har använt)\\b[^.!?]{0,100}\\b${requirement}\\b`, "iu"),
  ]
  return patterns.some((pattern) => {
    const match = pattern.exec(answer)
    return Boolean(match && !/\b(?:not|no direct|never|inte|ingen)\b/iu.test(match[0]))
  })
}

function warning(code: InterviewAnswerWarningCode, message: string, details: Omit<InterviewAnswerWarning, "code" | "message"> = {}): InterviewAnswerWarning {
  return { code, message, ...details }
}

function prompt(code: AnswerImprovementPromptCode, message: string, requirementKey?: string): AnswerImprovementPrompt {
  return { code, message, ...(requirementKey ? { requirementKey } : {}) }
}

/**
 * Validates answer references and returns deterministic preparation guidance.
 * Candidate answer text remains untrusted, transient input and is never evidence.
 */
export function prepareInterviewAnswer(
  plan: InterviewPreparationPlan,
  documentInput: Omit<CandidateDocumentInput, "matchingProfile">,
  answer: InterviewAnswerInput,
): InterviewAnswerPreparationResult {
  if (!isPlan(plan)) return failure("INVALID_INTERVIEW_PLAN", "Interview answer preparation requires a valid interview preparation plan.")
  if (!validAnswer(answer)) return failure("INVALID_ANSWER_INPUT", "Answer input must use a supported format with valid text fields.")
  const question = plan.questions.find((item) => item.id === answer.questionId)
  if (!question) return failure("UNKNOWN_QUESTION_ID", "Answer input references a question that does not exist in the plan.")
  if (!documentInput || typeof documentInput !== "object") return failure("INVALID_ANSWER_INPUT", "Candidate document evidence must be an object.")

  // Matching profiles signal job relevance only; they are never interview-answer evidence.
  const candidateOnly: Omit<CandidateDocumentInput, "matchingProfile"> = {
    ...("identity" in documentInput ? { identity: documentInput.identity } : {}),
    ...("evidence" in documentInput ? { evidence: documentInput.evidence } : {}),
  }
  const catalogResult = buildCandidateEvidenceCatalog(candidateOnly)
  if (!catalogResult.ok) return failure("INVALID_ANSWER_INPUT", catalogResult.error.message)
  const cited = answer.citedEvidenceIds ?? []
  if (cited.some((id) => typeof id !== "string" || !id.trim())) return failure("INVALID_ANSWER_INPUT", "Cited evidence IDs must be non-empty strings.")
  const duplicate = cited.find((id, index) => cited.indexOf(id) !== index)
  if (duplicate) return failure("DUPLICATE_EVIDENCE_ID", "Cited evidence IDs must not be duplicated.", duplicate)
  const evidenceById = new Map(catalogResult.value.evidence.map((item) => [item.id, item]))
  const unknown = cited.find((id) => !evidenceById.has(id))
  if (unknown) return failure("UNKNOWN_EVIDENCE_ID", "Cited evidence ID does not exist in explicit candidate evidence.", unknown)

  const language = plan.language
  const content = answerText(answer).trim()
  const warnings: InterviewAnswerWarning[] = []
  const prompts: AnswerImprovementPrompt[] = []
  const questionEvidence = new Set(question.evidenceIds)
  const citedEvidence = [...cited].sort().map((evidenceId) => ({ evidenceId, status: questionEvidence.has(evidenceId) ? "questionLinked" as const : "candidateEvidenceOnly" as const }))
  const hasQuestionLinkedEvidence = citedEvidence.some((item) => item.status === "questionLinked")

  if (!content) warnings.push(warning("EMPTY_ANSWER", text(language, "No answer content was provided; prepare a truthful response before the interview.", "Inget svarsinnehåll angavs; förbered ett sanningsenligt svar före intervjun.")))
  else if (content.length < SPARSE_ANSWER_LENGTH) warnings.push(warning("SPARSE_ANSWER", text(language, "The answer is brief; consider adding a concrete supported example if appropriate.", "Svaret är kort; överväg att lägga till ett konkret styrkt exempel om det passar.")))
  if (citedEvidence.length === 0) {
    warnings.push(warning("NO_EVIDENCE_CITED", text(language, "No candidate evidence was cited; a citation can help you prepare a grounded example.", "Ingen kandidatevidens citerades; en hänvisning kan hjälpa dig att förbereda ett förankrat exempel.")))
    if (question.evidenceIds.length > 0) prompts.push(prompt("ADD_LINKED_EVIDENCE", text(language, "Consider using relevant linked candidate evidence; do not invent an example.", "Överväg att använda relevant länkad kandidatevidens; hitta inte på ett exempel.")))
  }
  for (const reference of citedEvidence.filter((item) => item.status === "candidateEvidenceOnly")) {
    warnings.push(warning("CANDIDATE_EVIDENCE_NOT_QUESTION_LINKED", text(language, "Cited candidate evidence exists but is not explicitly linked to this question.", "Den citerade kandidatevidensen finns men är inte explicit länkad till denna fråga."), { evidenceId: reference.evidenceId }))
  }

  if (content) warnings.push(warning("SEMANTIC_SUPPORT_NOT_DETERMINED", text(language, "Evidence references do not by themselves prove the meaning of candidate-authored answer text.", "Evidenshänvisningar bevisar inte i sig innebörden i kandidatens eget svar.")))
  const citedEntries = citedEvidence.map((item) => evidenceById.get(item.evidenceId)!)
  const eligibleEvidenceText = citedEntries.map((item) => item.content).join("\n")
  const supportedTokens = new Set(protectedTokens(eligibleEvidenceText).map((item) => `${item.kind}\u0001${canonicalToken(item.token)}`))
  for (const token of protectedTokens(content)) {
    if (!supportedTokens.has(`${token.kind}\u0001${canonicalToken(token.token)}`)) {
      warnings.push(warning("UNVERIFIED_PROTECTED_FACT", text(language, "A protected factual token is not found in cited candidate evidence; verify it or remove it.", "En skyddad faktauppgift finns inte i citerad kandidatevidens; verifiera eller ta bort den."), { protectedFactKind: token.kind, protectedFactToken: token.token }))
      prompts.push(prompt("VERIFY_OR_REMOVE_PROTECTED_FACT", text(language, "Verify or remove unsupported protected facts; do not replace them with invented values.", "Verifiera eller ta bort ostyrkta skyddade faktauppgifter; ersätt dem inte med påhittade värden.")))
    }
  }
  const citedNamedFacts = new Set(namedStructuredFacts(citedEntries).map(canonicalToken))
  for (const fact of namedStructuredFacts(catalogResult.value.evidence)) {
    if (content.toLocaleLowerCase().includes(fact.toLocaleLowerCase()) && !citedNamedFacts.has(canonicalToken(fact))) {
      warnings.push(warning("UNVERIFIED_PROTECTED_FACT", text(language, "A structured named candidate fact is not found in cited candidate evidence; verify it or add the relevant citation.", "En strukturerad namngiven kandidatfaktauppgift finns inte i citerad kandidatevidens; verifiera den eller lägg till relevant hänvisning."), { protectedFactKind: "named", protectedFactToken: fact }))
      prompts.push(prompt("VERIFY_OR_REMOVE_PROTECTED_FACT", text(language, "Verify or remove unsupported protected facts; do not replace them with invented values.", "Verifiera eller ta bort ostyrkta skyddade faktauppgifter; ersätt dem inte med påhittade värden.")))
    }
  }

  if (answer.format === "star") {
    const fields: Array<keyof InterviewStarAnswer> = ["situation", "task", "action", "result"]
    for (const field of fields.filter((field) => !answer.star[field]?.trim())) {
      warnings.push(warning("STAR_FIELD_MISSING", text(language, `The STAR ${field} field is absent; add it only if you can do so truthfully.`, `STAR-fältet ${field} saknas; lägg till det endast om du kan göra det sanningsenligt.`), { starField: field }))
    }
    if (!answer.star.action?.trim()) prompts.push(prompt("CLARIFY_PERSONAL_ACTION", text(language, "Clarify only actions you personally took and can support.", "Förtydliga endast åtgärder du själv vidtog och kan styrka.")))
    if (!answer.star.result?.trim()) prompts.push(prompt("ADD_TRUTHFUL_RESULT_OR_OMIT_IT", text(language, "Add a result only if you can support it; otherwise state that no measurable result is available.", "Lägg till ett resultat endast om du kan styrka det; ange annars att inget mätbart resultat finns tillgängligt.")))
  }

  if (question.id.startsWith("coverage:")) prompts.push(prompt("DISTINGUISH_SUPPORTED_AND_DEVELOPING_AREAS", text(language, "Distinguish supported requirements from development areas; do not present partial coverage as complete experience.", "Skilj mellan styrkta krav och utvecklingsområden; framställ inte partiell täckning som full erfarenhet.")))
  if (question.id.startsWith("requirement:missing:")) {
    for (const key of question.gapKeys) {
      warnings.push(warning("MISSING_REQUIREMENT_TRUTH_REMINDER", text(language, "This question concerns a known gap; acknowledge direct-experience limits truthfully.", "Den här frågan gäller ett känt gap; erkänn begränsningar i direkt erfarenhet sanningsenligt."), { requirementKey: key }))
      prompts.push(prompt("ACKNOWLEDGE_DIRECT_EXPERIENCE_GAP", text(language, "Acknowledge the direct-experience gap, use only supported adjacent evidence, and describe learning readiness without claiming prior use.", "Erkänn gapet i direkt erfarenhet, använd endast styrkt närliggande evidens och beskriv lärberedskap utan att påstå tidigare användning."), key))
      if (gapContradiction(content, key)) warnings.push(warning("POTENTIAL_GAP_CONTRADICTION", text(language, "The answer may assert direct experience with a requirement recorded as missing; review the wording truthfully.", "Svaret kan påstå direkt erfarenhet av ett krav som är registrerat som saknat; granska formuleringen sanningsenligt."), { requirementKey: key }))
    }
  }
  if (question.id.startsWith("requirement:conflicting:") || questionHasWarning(plan, question, "CONFLICTING_REQUIREMENT_PREPARATION")) {
    warnings.push(warning("CONFLICTING_REQUIREMENT_CAUTION", text(language, "The requirement context is conflicting; clarify the discrepancy rather than resolving it automatically.", "Kravsammanhanget är motstridigt; förtydliga avvikelsen i stället för att lösa den automatiskt.")))
    prompts.push(prompt("EXPLAIN_CONFLICT_TRUTHFULLY", text(language, "Explain the apparent conflict truthfully and ask for clarification where needed.", "Förklara den uppenbara konflikten sanningsenligt och be om förtydligande vid behov.")))
  }
  if (questionHasWarning(plan, question, "UNKNOWN_REQUIREMENT_CONTEXT")) {
    warnings.push(warning("UNKNOWN_REQUIREMENT_CAUTION", text(language, "Requirement information is unknown; use careful wording and seek clarification rather than assuming a gap.", "Kravinformationen är okänd; använd försiktig formulering och be om förtydligande i stället för att anta ett gap.")))
    prompts.push(prompt("CLARIFY_UNKNOWN_REQUIREMENT", text(language, "Clarify the uncertain requirement; do not describe it as a known deficiency.", "Förtydliga det osäkra kravet; beskriv det inte som en känd brist.")))
  }
  if (question.category === "motivation" && !question.evidenceIds.some((id) => evidenceById.get(id)?.kind === "motivation")) {
    warnings.push(warning("MOTIVATION_NOT_EVIDENCE_GROUNDED", text(language, "No explicit motivation evidence is linked; candidate-authored motivation remains transient input.", "Ingen explicit motivationsevidens är länkad; kandidatens egen motivation förblir tillfällig indata.")))
    prompts.push(prompt("FORMULATE_OWN_MOTIVATION", text(language, "Formulate your own truthful reason for the role without treating it as stored evidence.", "Formulera ditt eget sanningsenliga skäl för rollen utan att behandla det som lagrad evidens.")))
  }

  const starFields = answer.format === "star" ? [answer.star.situation, answer.star.task, answer.star.action, answer.star.result].filter((value) => value?.trim()).length : 0
  const structuralChecks: AnswerStructuralChecks = {
    hasAnswerContent: Boolean(content),
    hasEvidenceCitation: citedEvidence.length > 0,
    hasQuestionLinkedEvidence,
    star: answer.format === "freeText" ? "notStructured" : starFields === 4 ? "complete" : "partial",
    semanticSupport: "notDetermined",
  }
  warnings.sort((left, right) => left.code.localeCompare(right.code) || (left.requirementKey ?? "").localeCompare(right.requirementKey ?? "") || (left.evidenceId ?? "").localeCompare(right.evidenceId ?? "") || (left.protectedFactToken ?? "").localeCompare(right.protectedFactToken ?? "") || (left.starField ?? "").localeCompare(right.starField ?? ""))
  const uniquePrompts = [...new Map(prompts.map((item) => [`${item.code}\u0001${item.requirementKey ?? ""}`, item])).values()]
    .sort((left, right) => left.code.localeCompare(right.code) || (left.requirementKey ?? "").localeCompare(right.requirementKey ?? ""))

  return {
    ok: true,
    value: {
      applicationId: plan.applicationId,
      questionId: question.id,
      language,
      questionCategory: question.category,
      citedEvidence,
      questionEvidenceIds: [...question.evidenceIds].sort(),
      requirementKeys: [...question.requirementKeys].sort(),
      gapKeys: [...question.gapKeys].sort(),
      structuralChecks,
      warnings,
      improvementPrompts: uniquePrompts,
    },
  }
}
