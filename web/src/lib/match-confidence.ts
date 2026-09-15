import type { RankedJob } from "../../../.agents/job-search/cli/src/ranking";
import type { NormalizedJob } from "../../../.agents/job-search/cli/src/types";
import type { MatchDimension, MatchEvidence, MatchingResult } from "../../../.agents/job-search/cli/src/matching";
import type { SkillGapRecommendation, SkillGapResult } from "../../../.agents/job-search/cli/src/skillgaps";
import { extractTechnicalRequirements } from "../../../.agents/job-search/cli/src/job-requirement-extraction";
import { resolveDocumentLanguage } from "./professional-documents";

/** Shared Swedish dimension vocabulary - the single source other match-explanation UI reuses, so a dimension is never labeled differently in two places. */
export const DIMENSION_LABELS: Record<MatchDimension, string> = {
  targetRole: "Målroll",
  technicalSkills: "Tekniska kompetenser",
  softSkills: "Mjuka kompetenser",
  location: "Plats",
  remotePreference: "Arbetsform",
  employmentType: "Anställningsform",
  yearsOfExperience: "Erfarenhet",
  certifications: "Certifieringar",
  languages: "Språk",
  preferredIndustries: "Bransch",
};

export function formatDimension(dimension: string): string {
  return DIMENSION_LABELS[dimension as MatchDimension] ?? dimension;
}

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
    industryRequirementMentioned: /\b(?:bransch|branscherfarenhet|industry experience|sector experience)\b/iu.test(text),
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
/**
 * Distinguishes, per dimension: (A) the ad states a requirement but it
 * couldn't be matched against the candidate's profile, from (B) the ad
 * simply never stated a requirement for this dimension at all. Unknown
 * information must never read as a candidate weakness when it is really just
 * something the advertisement didn't specify.
 */
export function unknownEvidenceLabel(evidence: MatchEvidence, job?: NormalizedJob): string {
  if (job) {
    const audit = auditJobRequirements(job);
    if (evidence.dimension === "certifications") return audit.certificationsMentioned ? "Certifiering nämns i annonsen; matchningen mot din profil är ännu osäker" : "Inget certifieringskrav anges i annonsen.";
    if (evidence.dimension === "softSkills" && audit.softSkillsMentioned) return "Annonsen nämner mjuka kompetenser som inte säkert kunde matchas mot din profil.";
    if (evidence.dimension === "languages") return audit.languagesMentioned ? "Språkkrav nämns i annonsen; det kunde inte säkert matchas mot din profil" : "Inget språkkrav anges i annonsen.";
    if (evidence.dimension === "preferredIndustries" && !audit.industryRequirementMentioned) return "Ingen särskild branscherfarenhet anges som krav.";
    if (evidence.dimension === "yearsOfExperience") return audit.experienceMentioned ? "Ett erfarenhetskrav nämns men kunde inte säkert tolkas." : "Annonsen anger inget tydligt erfarenhetskrav.";
  }
  if (/candidate has not specified/i.test(evidence.detail)) return "Komplettera din profil för bedömning";
  if (/no industry restriction/i.test(evidence.detail)) return "Ingen branschbegränsning i din profil";
  if (/does not directly match preferences/i.test(evidence.detail)) return "Branschkopplingen är osäker; ingen konflikt har fastställts";
  return "Ej angivet i annonsen eller inte säkert extraherat";
}

export type UnknownEvidenceCase = "candidateUncertain" | "jobUnspecified";

/**
 * Case B ("candidateUncertain"): the job DOES state this requirement, but
 * candidate evidence cannot confidently confirm it either way. Case C
 * ("jobUnspecified"): the job never stated a requirement for this dimension
 * at all - this must never read as a candidate deficiency. Mirrors the exact
 * same audit conditions unknownEvidenceLabel already uses, so the two never
 * disagree about which case a dimension falls into.
 */
export function unknownEvidenceCase(evidence: MatchEvidence, job?: NormalizedJob): UnknownEvidenceCase {
  if (!job) return "jobUnspecified";
  const audit = auditJobRequirements(job);
  switch (evidence.dimension) {
    case "certifications": return audit.certificationsMentioned ? "candidateUncertain" : "jobUnspecified";
    case "softSkills": return audit.softSkillsMentioned ? "candidateUncertain" : "jobUnspecified";
    case "languages": return audit.languagesMentioned ? "candidateUncertain" : "jobUnspecified";
    case "preferredIndustries": return audit.industryRequirementMentioned ? "candidateUncertain" : "jobUnspecified";
    case "yearsOfExperience": return audit.experienceMentioned ? "candidateUncertain" : "jobUnspecified";
    default: return "jobUnspecified";
  }
}

/** Case A (verified gap) description for a whole missing dimension - never used for the per-skill technicalSkills breakdown, see missingGapItems. */
export function missingEvidenceLabel(evidence: MatchEvidence): string {
  if (evidence.dimension === "targetRole") return "Din angivna målroll matchar inte tydligt jobbets roll.";
  return "Krav i annonsen, saknas i din verifierade profil.";
}

/** A stated requirement your verified profile actively contradicts (not merely absent) - e.g. location, work mode, employment type, seniority level, or a required language you don't list. */
export function conflictingEvidenceLabel(evidence: MatchEvidence): string {
  switch (evidence.dimension) {
    case "location": return "Jobbets plats stämmer inte med dina angivna platspreferenser.";
    case "remotePreference": return "Jobbets arbetsform (distans/hybrid/på plats) stämmer inte med dina preferenser.";
    case "employmentType": return "Jobbets anställningsform stämmer inte med dina preferenser.";
    case "yearsOfExperience": return "Din angivna erfarenhetsnivå matchar inte jobbets angivna senioritetsnivå.";
    case "languages": return "Annonsen kräver ett språk som inte finns i din verifierade profil.";
    default: return "Denna uppgift står i konflikt med annonsens krav.";
  }
}

export interface MatchGapItem {
  title: string;
  description: string;
}

/** Case A (verified gap) items for one "missing" MatchEvidence entry - one item per specific missing skill when the requirement breakdown is available, otherwise one item for the whole dimension. Never shows a skill as missing unless the job evidence actually required it (requirementCoverage.missingRequirements only ever lists explicit job requirements). */
export function missingGapItems(evidence: MatchEvidence): MatchGapItem[] {
  const missingSkills = evidence.dimension === "technicalSkills" ? evidence.requirementCoverage?.missingRequirements : undefined;
  if (missingSkills && missingSkills.length > 0) {
    return missingSkills.map((skill) => ({ title: skill, description: "Krav i annonsen, saknas i din verifierade profil." }));
  }
  return [{ title: formatDimension(evidence.dimension), description: missingEvidenceLabel(evidence) }];
}

export function conflictingGapItems(evidence: MatchEvidence): MatchGapItem[] {
  return [{ title: formatDimension(evidence.dimension), description: conflictingEvidenceLabel(evidence) }];
}

export interface MatchExplanationSummary {
  scoreLabel: string;
  matched: string[];
  missingVerified: string[];
  candidateUncertain: string[];
  jobUnspecified: string[];
  conflicting: string[];
}

/**
 * A single, compact "why this score" breakdown grouped by the same three
 * cases the detailed sections use (verified gap / candidate uncertain / job
 * unspecified), plus what matched and what conflicts. Every list here is
 * built only from evidence the scoring engine actually used - it never
 * claims a dimension affected the score unless matchingResult places it in
 * that bucket.
 */
export function buildMatchExplanationSummary(ranked: RankedJob, job?: NormalizedJob): MatchExplanationSummary {
  const { matchingResult } = ranked;
  const matched = matchingResult.matched.map((evidence) =>
    evidence.dimension === "technicalSkills" && evidence.requirementCoverage?.matchedRequirements?.length
      ? evidence.requirementCoverage.matchedRequirements.join(", ")
      : formatDimension(evidence.dimension),
  );
  const missingVerified = matchingResult.missing.flatMap(missingGapItems).map((item) => item.title);
  const candidateUncertain = matchingResult.unknown
    .filter((evidence) => unknownEvidenceCase(evidence, job) === "candidateUncertain")
    .map((evidence) => formatDimension(evidence.dimension));
  const jobUnspecified = matchingResult.unknown
    .filter((evidence) => unknownEvidenceCase(evidence, job) === "jobUnspecified")
    .map((evidence) => formatDimension(evidence.dimension));
  const conflicting = matchingResult.conflicting.flatMap(conflictingGapItems).map((item) => item.title);
  return {
    scoreLabel: `${ranked.score}/100`,
    matched,
    missingVerified,
    candidateUncertain,
    jobUnspecified,
    conflicting,
  };
}

/**
 * Supplements the existing skill-gap recommendations (from analyzeSkillGaps,
 * unchanged) with domain-agnostic guidance for verified gaps that
 * analyzeSkillGaps never covers at all - most notably a missing target-role
 * match, which today produces zero entries in SkillGapResult.recommendations
 * even when it is the dominant reason the score is low. Never tells the
 * candidate to claim experience they don't have.
 */
export function deriveActionableRecommendations(
  matchingResult: Pick<MatchingResult, "missing">,
  skillGapResult: SkillGapResult,
): SkillGapRecommendation[] {
  const recommendations = [...skillGapResult.recommendations];
  const targetRoleGap = matchingResult.missing.find((evidence) => evidence.dimension === "targetRole");
  if (targetRoleGap) {
    recommendations.push({
      title: "Se över din angivna målroll",
      description: "Om du faktiskt siktar på en roll som liknar den här annonsen, komplettera din profil med den yrkesroll du söker. Ange aldrig en roll du inte har erfarenhet av eller genuint siktar på.",
      targetGaps: [formatDimension("targetRole")],
      priority: "medium",
    });
  }
  return recommendations;
}
