import type { RankedJob } from "../../../.agents/job-search/cli/src/ranking";
import type { NormalizedJob } from "../../../.agents/job-search/cli/src/types";
import type { MatchEvidence } from "../../../.agents/job-search/cli/src/matching";
import { extractTechnicalRequirements } from "../../../.agents/job-search/cli/src/job-requirement-extraction";
import { resolveDocumentLanguage } from "./professional-documents";

export type MatchDiagnosis = "SOURCE_DATA_SPARSE" | "DESCRIPTION_MISSING" | "EXTRACTION_FAILED" | "GENUINE_LOW_MATCH" | "SUFFICIENT_INFORMATION";
/** Structural diagnostics only; no full description, identity or candidate values in the report. */
export function auditJobRequirements(job: NormalizedJob) {
  const text = job.description?.trim() ?? "";
  const extraction = extractTechnicalRequirements(job);
  const requirementCue = /\b(?:required|requirements|must|krav|måste|qualifications|kvalifikationer)\b/iu.test(text);
  return {
    source: job.source, descriptionPresent: Boolean(text), descriptionLength: text.length,
    titlePresent: Boolean(job.title.trim()), language: text ? resolveDocumentLanguage(undefined, text) : "unknown",
    technicalRequirements: extraction.job.skills.length,
    softSkillsMentioned: /\b(?:communication|teamwork|collaboration|kommunikation|samarbete|problemlösning)\b/iu.test(text),
    experienceMentioned: /\b(?:experience|erfarenhet)\b/iu.test(text),
    certificationsMentioned: /\b(?:certified|certification|certifications|certifikat|certifiering|certifieringar)\b/iu.test(text),
    languagesMentioned: /\b(?:english|swedish|svenska|engelska)\b/iu.test(text),
    workArrangementPresent: Boolean(job.remote), employmentTypePresent: Boolean(job.employmentType),
    extractionNeedsReview: requirementCue && extraction.job.skills.length === 0,
  };
}
export function presentMatch(ranked: RankedJob) {
  const audit = auditJobRequirements(ranked.job);
  const coverage = Math.round(ranked.scoringBreakdown.confidence * 100);
  // Confidence is evidence coverage, not a probability of success. Preserve numeric ranking score.
  const insufficient = ranked.scoringBreakdown.confidenceLabel === "low" || (!audit.descriptionPresent && audit.technicalRequirements === 0) || audit.extractionNeedsReview;
  const diagnosis: MatchDiagnosis = !audit.descriptionPresent ? "DESCRIPTION_MISSING"
    : audit.extractionNeedsReview ? "EXTRACTION_FAILED"
    : insufficient ? "SOURCE_DATA_SPARSE"
    : ranked.score < 40 ? "GENUINE_LOW_MATCH" : "SUFFICIENT_INFORMATION";
  return {
    scoreLabel: insufficient ? "Otillräckligt underlag" : `${ranked.score}/100`,
    confidenceLabel: insufficient ? "Låg" : ranked.scoringBreakdown.confidenceLabel === "high" ? "Hög" : "Medel",
    coverage, diagnosis, audit, insufficient,
    explanation: insufficient ? "Annonsen ger för lite information för en säker matchbedömning. Det betyder inte att du saknar kompetensen. Rangordningen använder fortfarande det beräknade underlaget." : "Matchpoängen bedömer kända uppgifter. Täckningen visar hur mycket underlag bedömningen bygger på.",
  };
}
export function unknownEvidenceLabel(evidence: MatchEvidence, job?: NormalizedJob): string {
  if (job) {
    const audit = auditJobRequirements(job);
    if (evidence.dimension === "certifications") return audit.certificationsMentioned ? "Certifiering nämns i annonsen; matchningen mot din profil är ännu osäker" : "Ej angivet i annonsen";
    if (evidence.dimension === "softSkills" && audit.softSkillsMentioned) return "Annonsen nämner mjuka kompetenser som inte har kunnat matchas mot din profil";
  }
  if (/candidate has not specified/i.test(evidence.detail)) return "Komplettera din profil för bedömning";
  if (/no industry restriction/i.test(evidence.detail)) return "Ingen branschbegränsning i din profil";
  if (/does not directly match preferences/i.test(evidence.detail)) return "Branschkopplingen är osäker; ingen konflikt har fastställts";
  return "Ej angivet i annonsen eller inte säkert extraherat";
}
