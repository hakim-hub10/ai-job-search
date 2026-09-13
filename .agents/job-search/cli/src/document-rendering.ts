import { validateTailoringPlan, type TailoringPlan, type TailoringWarning } from "./document-tailoring"
import type { ApplicationDocumentFoundation, DocumentLanguage, DocumentType, DocumentWarning } from "./application-documents"
import type { GeneratedDocumentClaim, GeneratedDocumentSection } from "./document-generation"

export type RenderFormat = "markdown"
export type RenderWarningCode = "NO_SUMMARY" | "SPARSE_RENDERED_CV" | "MISSING_IDENTITY_HEADER" | "COVER_LETTER_OUTLINE_ONLY"
export interface RenderWarning { code: RenderWarningCode; message: string }
export interface RenderMapEntry { section: string; blockIndex: number; evidenceIds: string[] }
export interface RenderedDocument {
  applicationId: string; type: DocumentType; language: DocumentLanguage; format: RenderFormat; content: string
  renderMap: RenderMapEntry[]; warnings: Array<DocumentWarning | TailoringWarning | RenderWarning>
}
export interface GeneratedApplicationDocument {
  applicationId: string
  documentType: DocumentType
  language: DocumentLanguage
  sections: GeneratedDocumentSection[]
  requiresHumanReview: boolean
  warnings: Array<DocumentWarning | TailoringWarning>
}
export interface GeneratedRenderMapEntry {
  sectionId: string
  claimId: string
  blockIndex: number
  evidenceIds: string[]
  provenance: GeneratedDocumentClaim["provenance"]
}
export interface GeneratedDocumentRenderResult {
  applicationId: string
  documentType: DocumentType
  language: DocumentLanguage
  format: RenderFormat
  content: string
  renderMap: GeneratedRenderMapEntry[]
  requiresHumanReview: boolean
  warnings: Array<DocumentWarning | TailoringWarning>
}
export type RenderErrorCode = "INVALID_TAILORING_PLAN" | "INVALID_EVIDENCE_REFERENCE" | "UNSUPPORTED_DOCUMENT_TYPE" | "UNSUPPORTED_LANGUAGE" | "UNSUPPORTED_FORMAT" | "MALFORMED_RENDER_INPUT" | "INVALID_GENERATED_DOCUMENT"
export interface RenderError { code: RenderErrorCode; message: string }
export type RenderResult<T> = { ok: true; value: T } | { ok: false; error: RenderError }

const headings: Record<DocumentLanguage, Record<string, string>> = {
  en: { summary: "Professional Summary", skill: "Skills", experience: "Experience", achievement: "Achievements", project: "Projects", education: "Education", certification: "Certifications", language: "Languages", motivation: "Motivation", other: "Additional Information", outline: "Cover Letter Outline", context: "Application Context", strengths: "Selected Strengths" },
  sv: { summary: "Profil", skill: "Kompetenser", experience: "Erfarenhet", achievement: "Prestationer", project: "Projekt", education: "Utbildning", certification: "Certifieringar", language: "Språk", motivation: "Motivation", other: "Övrig information", outline: "Personligt brev – disposition", context: "Ansökningskontext", strengths: "Valda styrkor" },
}
function escape(text: string): string {
  const safe = text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;")
  return safe.replace(/^([#>*+-]+)(\s)/u, "\\$1$2")
}
function failure<T>(code: RenderErrorCode, message: string): RenderResult<T> { return { ok: false, error: { code, message } } }

/** Pure Markdown presentation of validated evidence and plan order. */
export function renderApplicationDocument(foundation: ApplicationDocumentFoundation, plan: TailoringPlan, format: RenderFormat = "markdown"): RenderResult<RenderedDocument> {
  if (format !== "markdown") return failure("UNSUPPORTED_FORMAT", "Phase 4.3 supports only markdown rendering.")
  if (!foundation?.catalog?.evidence || !plan) return failure("MALFORMED_RENDER_INPUT", "Rendering requires a document foundation and tailoring plan.")
  if (plan.type !== "cv" && plan.type !== "coverLetter") return failure("UNSUPPORTED_DOCUMENT_TYPE", "Unsupported document type.")
  if (plan.language !== "en" && plan.language !== "sv") return failure("UNSUPPORTED_LANGUAGE", "Unsupported document language.")
  const validation = validateTailoringPlan(foundation, plan)
  if (!validation.valid) return failure("INVALID_TAILORING_PLAN", validation.errors[0]?.message ?? "Tailoring plan is invalid.")
  const byId = new Map(foundation.catalog.evidence.map((evidence) => [evidence.id, evidence]))
  for (const selection of plan.selections) if (!byId.has(selection.evidenceId)) return failure("INVALID_EVIDENCE_REFERENCE", "Selected evidence is absent from the foundation catalog.")
  const labels = headings[plan.language]
  const warnings: Array<DocumentWarning | TailoringWarning | RenderWarning> = structuredClone(plan.warnings)
  const lines: string[] = []
  const renderMap: RenderMapEntry[] = []
  const selected = new Set(plan.selections.map((selection) => selection.evidenceId))
  const identity = plan.sections.find((section) => section.kind === "identity")
  if (identity?.evidenceIds.length) lines.push(`# ${identity.evidenceIds.map((id) => escape(byId.get(id)!.content)).join(" | ")}`)
  else warnings.push({ code: "MISSING_IDENTITY_HEADER", message: "No selected identity evidence is available for the document header." })
  if (plan.type === "coverLetter") {
    lines.push(`## ${labels.outline}`, `## ${labels.context}`, `- ${escape(foundation.applicationContext.jobTitle)}${foundation.applicationContext.company ? ` — ${escape(foundation.applicationContext.company)}` : ""}`, `## ${labels.strengths}`)
  }
  let blocks = 0
  for (const section of plan.sections) {
    if (section.kind === "identity") continue
    const ids = section.evidenceIds.filter((id) => selected.has(id))
    if (!ids.length) continue
    lines.push(`## ${labels[section.kind]}`)
    for (const id of ids) {
      const item = byId.get(id)!
      const context = item.context?.employer || item.context?.role || item.context?.startDate || item.context?.endDate
        ? ` (${[item.context?.role, item.context?.employer, [item.context?.startDate, item.context?.endDate].filter((value): value is string => Boolean(value)).join(" - ")].filter((value): value is string => Boolean(value)).map(escape).join(", ")})`
        : ""
      lines.push(`- ${escape(item.content)}${context}`)
      renderMap.push({ section: section.kind, blockIndex: blocks++, evidenceIds: [id] })
    }
  }
  if (!plan.sections.some((section) => section.kind === "summary" && section.evidenceIds.length)) warnings.push({ code: "NO_SUMMARY", message: "No selected summary evidence was rendered." })
  if (plan.type === "cv" && blocks < 3) warnings.push({ code: "SPARSE_RENDERED_CV", message: "Rendered CV contains limited selected evidence; no filler was added." })
  if (plan.type === "coverLetter") warnings.push({ code: "COVER_LETTER_OUTLINE_ONLY", message: "This is a structured outline, not a finished cover letter." })
  return { ok: true, value: { applicationId: plan.applicationId, type: plan.type, language: plan.language, format, content: lines.join("\n"), renderMap, warnings } }
}

/**
 * Renders only the validated generated-document domain model. Raw provider
 * responses must first pass Phase 4.4.1 validation and workflow conversion.
 */
export function renderGeneratedApplicationDocument(
  document: GeneratedApplicationDocument,
  format: RenderFormat = "markdown",
): RenderResult<GeneratedDocumentRenderResult> {
  if (format !== "markdown") return failure("UNSUPPORTED_FORMAT", "Phase 4.3 supports only markdown rendering.")
  if (!document || typeof document !== "object" || !Array.isArray(document.sections) || !Array.isArray(document.warnings)
    || typeof document.applicationId !== "string" || !document.applicationId.trim() || typeof document.requiresHumanReview !== "boolean") {
    return failure("INVALID_GENERATED_DOCUMENT", "Rendering requires a validated generated application document.")
  }
  if (document.documentType !== "cv" && document.documentType !== "coverLetter") return failure("UNSUPPORTED_DOCUMENT_TYPE", "Unsupported document type.")
  if (document.language !== "en" && document.language !== "sv") return failure("UNSUPPORTED_LANGUAGE", "Unsupported document language.")
  const labels = headings[document.language]
  const lines: string[] = []
  const renderMap: GeneratedRenderMapEntry[] = []
  let blocks = 0
  for (const section of document.sections) {
    if (!section || typeof section.id !== "string" || !Array.isArray(section.claims)) {
      return failure("INVALID_GENERATED_DOCUMENT", "Every generated document section must contain structured claims.")
    }
    const claims = section.claims
    if (!claims.every((claim) => claim && typeof claim.id === "string" && typeof claim.text === "string" && Array.isArray(claim.evidenceIds))) {
      return failure("INVALID_GENERATED_DOCUMENT", "Every generated document claim must be structured.")
    }
    if (section.id === "manual:content" && document.requiresHumanReview && claims.every(claim => claim.kind === "neutralContext" && claim.provenance === "neutral" && claim.evidenceIds.length === 0)) {
      // Explicitly user-edited Markdown remains review-required, with no promotion to candidate facts.
      for (const claim of claims) {
        lines.push(claim.text)
        renderMap.push({ sectionId: section.id, claimId: claim.id, blockIndex: blocks++, evidenceIds: [], provenance: "neutral" })
      }
    } else if (document.documentType === "coverLetter" && section.id === "professional:letter") {
      for (const claim of claims) {
        lines.push(escape(claim.text), "")
        renderMap.push({ sectionId: section.id, claimId: claim.id, blockIndex: blocks++, evidenceIds: [...claim.evidenceIds], provenance: claim.provenance })
      }
    } else if (section.kind === "identity") {
      if (claims.length) {
        lines.push(`# ${claims.map((claim) => escape(claim.text)).join(" | ")}`)
        for (const claim of claims) {
          renderMap.push({
            sectionId: section.id,
            claimId: claim.id,
            blockIndex: blocks++,
            evidenceIds: [...claim.evidenceIds],
            provenance: claim.provenance,
          })
        }
      }
    } else if (claims.length) {
      const presentationLabel = section.id === "professional:technicalSkills" ? (document.language === "sv" ? "Yrkeskompetenser" : "Professional skills")
        : section.id === "professional:softSkills" ? (document.language === "sv" ? "Personliga kompetenser" : "Interpersonal skills") : labels[section.kind] ?? labels.other
      lines.push(`## ${presentationLabel}`)
      for (const claim of claims) {
        lines.push(`- ${escape(claim.text)}`)
        renderMap.push({
          sectionId: section.id,
          claimId: claim.id,
          blockIndex: blocks++,
          evidenceIds: [...claim.evidenceIds],
          provenance: claim.provenance,
        })
      }
    }
  }
  return {
    ok: true,
    value: {
      applicationId: document.applicationId,
      documentType: document.documentType,
      language: document.language,
      format,
      content: lines.join("\n"),
      renderMap,
      requiresHumanReview: document.requiresHumanReview,
      warnings: structuredClone(document.warnings),
    },
  }
}
