import type { ApplicationRecord } from "./applications"
import {
  buildApplicationDocumentFoundation,
  type CandidateDocumentInput,
  type CandidateEvidence,
  type DocumentLanguage,
  type DocumentRequirementStatus,
} from "./application-documents"
import type { RequirementImportance } from "./requirements"

export type InterviewType = "recruiterScreening" | "hiringManager" | "behavioral" | "roleSpecific" | "situational"
export type InterviewQuestionCategory = "general" | "behavioral" | "competency" | "roleSpecific" | "situational" | "gapFocused" | "motivation" | "closing"

export interface InterviewPreparationOptions {
  language?: DocumentLanguage
  interviewType?: InterviewType
}

export interface InterviewJobContext {
  jobId: string
  source: string
  sourceId: string | null
  jobTitle: string
  company: string | null
}

export interface InterviewQuestion {
  id: string
  category: InterviewQuestionCategory
  prompt: string
  rationale: string
  requirementKeys: string[]
  evidenceIds: string[]
  gapKeys: string[]
}

export interface StarPreparationPrompt {
  questionId: string
  evidenceIds: string[]
  situationPrompt: string
  taskPrompt: string
  actionPrompt: string
  resultPrompt: string
  warnings: string[]
}

export type InterviewPreparationWarningCode =
  | "SPARSE_CANDIDATE_EVIDENCE"
  | "LOW_JOB_EVIDENCE_CONFIDENCE"
  | "PARTIAL_REQUIREMENT_COVERAGE"
  | "MISSING_REQUIREMENT_PREPARATION"
  | "CONFLICTING_REQUIREMENT_PREPARATION"
  | "UNKNOWN_REQUIREMENT_CONTEXT"
  | "UNSUPPORTED_MATCHED_REQUIREMENT"
  | "MISSING_MOTIVATION"
  | "NO_SUPPORTED_STAR_RESULT"

export interface InterviewPreparationWarning {
  code: InterviewPreparationWarningCode
  message: string
  requirementKey?: string
  evidenceId?: string
}

export interface InterviewPreparationPlan {
  applicationId: string
  job: InterviewJobContext
  language: DocumentLanguage
  interviewType: InterviewType
  questions: InterviewQuestion[]
  starPrompts: StarPreparationPrompt[]
  warnings: InterviewPreparationWarning[]
}

export type InterviewPreparationErrorCode = "INVALID_APPLICATION_CONTEXT" | "INVALID_DOCUMENT_INPUT" | "UNSUPPORTED_LANGUAGE" | "UNSUPPORTED_INTERVIEW_TYPE"
export interface InterviewPreparationError {
  code: InterviewPreparationErrorCode
  message: string
}
export type InterviewPreparationResult = { ok: true; value: InterviewPreparationPlan } | { ok: false; error: InterviewPreparationError }

const IMPORTANCE_ORDER: Record<RequirementImportance, number> = {
  required: 0, preferred: 1, useful: 2, optional: 3, unspecified: 4,
}

const QUESTION_ORDER: Record<InterviewQuestionCategory, number> = {
  roleSpecific: 0, gapFocused: 1, behavioral: 2, competency: 3, general: 4, situational: 5, motivation: 6, closing: 7,
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function failure(code: InterviewPreparationErrorCode, message: string): InterviewPreparationResult {
  return { ok: false, error: { code, message } }
}

function languageText(language: DocumentLanguage, en: string, sv: string): string {
  return language === "sv" ? sv : en
}

function requirementImportance(record: ApplicationRecord, key: string): RequirementImportance {
  return record.analysisSnapshot.skillGapResult.gaps
    .find((gap) => gap.requirement?.identity.key === key)?.requirement?.importance ?? "unspecified"
}

function technicalCoverage(record: ApplicationRecord): number | undefined {
  return [...record.analysisSnapshot.matchingResult.matched, ...record.analysisSnapshot.matchingResult.missing]
    .find((entry) => entry.dimension === "technicalSkills")?.requirementCoverage?.coverageRatio
}

function question(
  id: string,
  category: InterviewQuestionCategory,
  prompt: string,
  rationale: string,
  requirementKeys: string[] = [],
  evidenceIds: string[] = [],
  gapKeys: string[] = [],
): InterviewQuestion {
  return { id, category, prompt, rationale, requirementKeys: [...requirementKeys].sort(), evidenceIds: [...evidenceIds].sort(), gapKeys: [...gapKeys].sort() }
}

function starPrompt(questionId: string, evidence: CandidateEvidence, language: DocumentLanguage): StarPreparationPrompt {
  return {
    questionId,
    evidenceIds: [evidence.id],
    situationPrompt: languageText(language, "Describe the situation using only the documented context and facts.", "Beskriv situationen med endast det dokumenterade sammanhanget och fakta."),
    taskPrompt: languageText(language, "Explain your responsibility in that situation truthfully.", "Förklara ditt ansvar i situationen sanningsenligt."),
    actionPrompt: languageText(language, "Describe only actions you personally took and can support.", "Beskriv endast åtgärder du själv vidtog och kan styrka."),
    resultPrompt: languageText(language, "State a result only if you can support it; otherwise say that no measurable result is available.", "Ange endast ett resultat om du kan styrka det; säg annars att inget mätbart resultat finns tillgängligt."),
    warnings: [languageText(language, "Do not invent metrics, outcomes, or business impact.", "Hitta inte på mått, resultat eller verksamhetseffekt.")],
  }
}

/**
 * Builds offline interview preparation from the immutable application snapshot
 * and explicit candidate document evidence. It produces prompts, never answers.
 */
export function createInterviewPreparationPlan(
  application: ApplicationRecord,
  documentInput: Omit<CandidateDocumentInput, "matchingProfile">,
  options: InterviewPreparationOptions = {},
): InterviewPreparationResult {
  const language = options.language ?? "en"
  if (language !== "en" && language !== "sv") return failure("UNSUPPORTED_LANGUAGE", "Interview preparation supports only \"en\" and \"sv\".")
  const interviewType = options.interviewType ?? "hiringManager"
  if (!["recruiterScreening", "hiringManager", "behavioral", "roleSpecific", "situational"].includes(interviewType)) {
    return failure("UNSUPPORTED_INTERVIEW_TYPE", "Interview type is not supported.")
  }
  if (!documentInput || typeof documentInput !== "object") {
    return failure("INVALID_DOCUMENT_INPUT", "Candidate document evidence must be an object.")
  }

  // Deliberately copy only explicit document evidence. This also prevents an
  // untyped JavaScript caller from smuggling matchingProfile facts into answers.
  const candidateEvidenceInput: Omit<CandidateDocumentInput, "matchingProfile"> = {
    ...("identity" in documentInput ? { identity: documentInput.identity } : {}),
    ...("evidence" in documentInput ? { evidence: documentInput.evidence } : {}),
  }
  const foundation = buildApplicationDocumentFoundation(application, candidateEvidenceInput)
  if (!foundation.ok) {
    return failure(
      foundation.error.code === "MALFORMED_APPLICATION_CONTEXT" ? "INVALID_APPLICATION_CONTEXT" : "INVALID_DOCUMENT_INPUT",
      foundation.error.message,
    )
  }

  const questions: InterviewQuestion[] = []
  const warnings: InterviewPreparationWarning[] = []
  const matchedEvidence = new Map<string, CandidateEvidence>()
  const contexts = [...new Map(
    foundation.value.requirements.map((context) => [context.requirement.identity.key, context]),
  ).values()]
    .sort((left, right) => IMPORTANCE_ORDER[requirementImportance(application, left.requirement.identity.key)] - IMPORTANCE_ORDER[requirementImportance(application, right.requirement.identity.key)]
      || left.requirement.identity.key.localeCompare(right.requirement.identity.key))

  for (const context of contexts) {
    const { key, original } = context.requirement.identity
    const status: DocumentRequirementStatus = context.status
    if (status === "matched") {
      if (context.evidenceIds.length === 0) {
        warnings.push({ code: "UNSUPPORTED_MATCHED_REQUIREMENT", message: languageText(language, "A matched job requirement has no explicit document evidence for interview preparation.", "Ett matchat jobbkrav saknar explicit dokumentbevis för intervjuförberedelse."), requirementKey: key })
        continue
      }
      questions.push(question(
        `requirement:matched:${key}`,
        "roleSpecific",
        languageText(language, `How would you discuss your supported experience with ${original}?`, `Hur skulle du beskriva din styrkta erfarenhet av ${original}?`),
        languageText(language, "This requirement is matched by explicit candidate document evidence.", "Detta krav matchas av explicit kandidatdokumentation."),
        [key], context.evidenceIds,
      ))
      for (const id of context.evidenceIds) {
        const evidence = foundation.value.catalog.evidence.find((item) => item.id === id)
        if (evidence && ["experience", "project", "achievement"].includes(evidence.kind)) matchedEvidence.set(evidence.id, evidence)
      }
    } else if (status === "missing") {
      warnings.push({ code: "MISSING_REQUIREMENT_PREPARATION", message: languageText(language, "Prepare a truthful bridge response for a missing requirement; do not claim direct experience.", "Förbered ett sanningsenligt bryggsvar för ett saknat krav; påstå inte direkt erfarenhet."), requirementKey: key })
      questions.push(question(
        `requirement:missing:${key}`,
        "gapFocused",
        languageText(language, `How will you acknowledge the gap in ${original}, discuss only supported adjacent evidence, and explain your learning approach?`, `Hur kommer du att erkänna gapet inom ${original}, diskutera endast styrkt närliggande evidens och förklara ditt sätt att lära?`),
        languageText(language, "The job requirement is missing and needs truthful preparation, not a positive claim.", "Jobbkravet saknas och kräver sanningsenlig förberedelse, inte ett positivt påstående."),
        [key], [], [key],
      ))
    } else if (status === "conflicting") {
      warnings.push({ code: "CONFLICTING_REQUIREMENT_PREPARATION", message: languageText(language, "Prepare to clarify the apparent requirement conflict truthfully.", "Förbered dig på att sanningsenligt förklara den uppenbara kravkonflikten."), requirementKey: key })
      questions.push(question(
        `requirement:conflicting:${key}`,
        "gapFocused",
        languageText(language, `How would you clarify the apparent conflict regarding ${original}?`, `Hur skulle du förklara den uppenbara konflikten kring ${original}?`),
        languageText(language, "The analysis preserves a conflicting requirement status.", "Analysen bevarar en motstridig kravstatus."),
        [key], [], [key],
      ))
    } else {
      warnings.push({ code: "UNKNOWN_REQUIREMENT_CONTEXT", message: languageText(language, "Job information is insufficient to assess this requirement; clarify it rather than treating it as a gap.", "Jobbinformationen är otillräcklig för att bedöma detta krav; be om förtydligande i stället för att behandla det som ett gap."), requirementKey: key })
    }
  }

  const coverage = technicalCoverage(application)
  if (coverage !== undefined && coverage > 0 && coverage < 1) {
    const requirementKeys = contexts.map((context) => context.requirement.identity.key)
    warnings.push({ code: "PARTIAL_REQUIREMENT_COVERAGE", message: languageText(language, "Listed requirement coverage is partial; distinguish supported requirements from gaps.", "Täckningen av listade krav är partiell; skilj mellan styrkta krav och gap.") })
    questions.push(question(
      "coverage:technical-skills:partial",
      "roleSpecific",
      languageText(language, "Which listed requirements can you support with evidence, and which should you discuss as development areas?", "Vilka listade krav kan du styrka med evidens, och vilka bör du beskriva som utvecklingsområden?"),
      languageText(language, "Technical requirement coverage is partial; individual requirement statuses remain unchanged.", "Täckningen av tekniska krav är partiell; enskilda kravstatusar förblir oförändrade."),
      requirementKeys,
    ))
  }

  const behavioralEvidence = foundation.value.catalog.evidence
    .filter((item) => ["experience", "project", "achievement"].includes(item.kind))
    .sort((left, right) => left.id.localeCompare(right.id))
  for (const evidence of behavioralEvidence) {
    if (matchedEvidence.has(evidence.id)) continue
    questions.push(question(
      `evidence:behavioral:${evidence.id}`,
      "behavioral",
      languageText(language, "Choose this documented experience as a truthful example of how you work.", "Välj denna dokumenterade erfarenhet som ett sanningsenligt exempel på hur du arbetar."),
      languageText(language, "This is candidate-supplied experience evidence, not an inferred qualification.", "Detta är kandidatens egen erfarenhetsevidens, inte en härledd kvalifikation."),
      evidence.requirementKeys, [evidence.id],
    ))
  }

  const motivation = foundation.value.catalog.evidence.filter((item) => item.kind === "motivation").sort((left, right) => left.id.localeCompare(right.id))
  if (motivation.length > 0) {
    questions.push(question(
      `motivation:${motivation[0].id}`,
      "motivation",
      languageText(language, "How would you explain your motivation using your own documented motivation?", "Hur skulle du förklara din motivation med utgångspunkt i din egen dokumenterade motivation?"),
      languageText(language, "Candidate-supplied motivation is available.", "Kandidatspecificerad motivation finns tillgänglig."),
      motivation[0].requirementKeys, [motivation[0].id],
    ))
  } else {
    warnings.push({ code: "MISSING_MOTIVATION", message: languageText(language, "No candidate-supplied motivation is available; formulate your own truthful reason for the role.", "Ingen kandidatstyrkt motivation finns tillgänglig; formulera ditt eget sanningsenliga skäl för rollen.") })
    questions.push(question(
      "motivation:prepare-own",
      "motivation",
      languageText(language, "What is your truthful reason for wanting this role?", "Vilket är ditt sanningsenliga skäl för att vilja ha den här rollen?"),
      languageText(language, "No motivation was inferred from the job or profile.", "Ingen motivation har härletts från jobbet eller profilen."),
    ))
  }

  questions.push(
    question("closing:success-expectations", "closing", languageText(language, "What would success in this role look like during the first months?", "Hur skulle framgång i rollen se ut under de första månaderna?"), languageText(language, "Ask about success expectations without assuming company facts.", "Fråga om förväntningar på framgång utan att anta företagsfakta.")),
    question("closing:requirement-priorities", "closing", languageText(language, "How are the listed responsibilities and requirements prioritized in day-to-day work?", "Hur prioriteras de listade ansvarsområdena och kraven i det dagliga arbetet?"), languageText(language, "Ask for clarification about job requirements rather than inferring their meaning.", "Be om förtydligande av jobbkraven i stället för att tolka dem.")),
  )

  if (foundation.value.catalog.evidence.length < 3) warnings.push({ code: "SPARSE_CANDIDATE_EVIDENCE", message: languageText(language, "Candidate evidence is sparse; preparation does not infer missing facts.", "Kandidatevidensen är begränsad; förberedelsen härleder inte saknade fakta.") })
  if (foundation.value.applicationContext.confidence < 0.5) warnings.push({ code: "LOW_JOB_EVIDENCE_CONFIDENCE", message: languageText(language, "Job evidence coverage is low; confirm uncertain requirements with the employer.", "Täckningen av jobbevidens är låg; bekräfta osäkra krav med arbetsgivaren.") })

  const starPrompts = [...matchedEvidence.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((evidence) => {
      const linkedQuestion = questions.find((item) => item.evidenceIds.includes(evidence.id))
      return linkedQuestion ? [starPrompt(linkedQuestion.id, evidence, language)] : []
    })
  for (const evidence of matchedEvidence.values()) {
    warnings.push({ code: "NO_SUPPORTED_STAR_RESULT", message: languageText(language, "No result is inferred from evidence; supply one only if truthful and supportable.", "Inget resultat härleds från evidensen; ange endast ett om det är sanningsenligt och kan styrkas."), evidenceId: evidence.id })
  }

  questions.sort((left, right) => QUESTION_ORDER[left.category] - QUESTION_ORDER[right.category] || left.id.localeCompare(right.id))
  warnings.sort((left, right) => left.code.localeCompare(right.code) || (left.requirementKey ?? "").localeCompare(right.requirementKey ?? "") || (left.evidenceId ?? "").localeCompare(right.evidenceId ?? ""))

  return {
    ok: true,
    value: {
      applicationId: foundation.value.applicationContext.applicationId,
      job: {
        jobId: foundation.value.applicationContext.jobId,
        source: foundation.value.applicationContext.source,
        sourceId: foundation.value.applicationContext.sourceId,
        jobTitle: foundation.value.applicationContext.jobTitle,
        company: foundation.value.applicationContext.company,
      },
      language,
      interviewType,
      questions,
      starPrompts,
      warnings,
    },
  }
}
