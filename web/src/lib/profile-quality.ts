import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import { canonicalConcept, SOFT_SKILL_CONCEPTS, normalizedConceptText } from "../../../.agents/job-search/cli/src/concept-normalization";

export type SkillClassification = "VALID_SKILL" | "SOFT_SKILL" | "EXPERIENCE_TEXT" | "EMPLOYER_OR_ROLE" | "DATE" | "LOCATION" | "PROJECT" | "CERTIFICATION" | "EDUCATION" | "PROSE" | "SUSPICIOUS" | "RAW_IMPORT_BLOCK";
export type ProfileEvidenceField = "technical" | "soft" | "certifications" | "summary";
export interface SkillReviewItem {
  field: ProfileEvidenceField; index: number; value: string;
  classification: SkillClassification; reason: string; suspicious: boolean;
}
/**
 * A professional summary is a handful of authored sentences, not a pasted CV.
 * Multiple blank-line-separated blocks or implausible length are the
 * fingerprint of raw imported text (dates, contact details, education and
 * certifications re-stated as prose) landing in the summary field verbatim -
 * exactly the kind of pollution documentQualityProfile already screens skills
 * for. This never edits the stored profile; it only flags the value so a
 * generated document falls back to a composed summary instead of dumping it.
 */
export function looksLikeRawImportBlock(value: string): boolean {
  const text = value.trim()
  if (!text) return false
  if (text.length > 600) return true
  if (text.split(/\n\s*\n/u).filter((block) => block.trim()).length > 2) return true
  return false
}
/**
 * A "label: rest" line where the label names a project (e.g. the observed
 * real-world "GITHUB-PROJEKT: Migrated 200 users...") is a project
 * description, not a certification or skill - checked on the label only
 * (text before the first colon) so a genuine skill phrase like "Project
 * management" (no colon) is never caught by this.
 */
function isProjectLabelled(text: string): boolean {
  const colonIndex = text.indexOf(":")
  if (colonIndex <= 0) return false
  return /\b(?:github[\s-]?projekt|github[\s-]?project|projekt|project)s?\b/iu.test(text.slice(0, colonIndex))
}
/** Conservative flags, never a deletion policy. Context matches are exact, not guessed geography. */
export function classifySkill(value: string, profile?: CandidateProfile): { classification: SkillClassification; reason: string } {
  const text = value.trim();
  const key = normalizedConceptText(text);
  if (!text || /[-–/:]$/u.test(text) || /^(?:support|och|and|it-)$/iu.test(text)) return { classification: "SUSPICIOUS", reason: "Incomplete or ambiguous fragment" };
  if (/(?:https?:\/\/|www\.|\S+@\S+|referen[cs]|telefon|phone|contact:)/iu.test(text) || /^\+?[\d][\d\s().-]{5,}$/u.test(text)) return { classification: "SUSPICIOUS", reason: "Link, contact or reference text" };
  if (/^(?:\d{4}(?:[-/.]\d{1,2})?(?:\s*[-–/]\s*(?:\d{4}(?:[-/.]\d{1,2})?|present|pågående|nu))?|\d{1,2}[/.]\d{1,2}[/.]\d{2,4})$/iu.test(text)) return { classification: "DATE", reason: "Date rather than a skill" };
  if (profile?.workExperience.some(x => [x.company, x.title].some(v => normalizedConceptText(v) === key)) || /\b(?:AB|Ltd|GmbH|Inc)\.?$/u.test(text) || /\b(?:engineer|technician|coordinator|manager|tekniker|samordnare|chef)$/iu.test(text)) return { classification: "EMPLOYER_OR_ROLE", reason: "Employer or role text" };
  if (profile && [...profile.locationPreferences, ...profile.workExperience.map(x => x.location)].some(v => normalizedConceptText(v) === key)) return { classification: "LOCATION", reason: "Matches a stored location" };
  if (profile?.education.some(x => [x.institution, x.degree].some(v => normalizedConceptText(v) === key)) || /\b(?:B\.?Sc\.?|M\.?Sc\.?|Bachelor|Master|Diploma|PhD|Doctorate|YH-examen)\b/iu.test(text) || /\b(?:university|college|institute|universitet|högskola|akademi)\b/iu.test(text)) return { classification: "EDUCATION", reason: "Education institution or degree text" };
  if (isProjectLabelled(text)) return { classification: "PROJECT", reason: "Project description" };
  if (profile?.certifications.some(v => normalizedConceptText(v) === key) || /\b(?:certified|certifierad|certification|certifikat)\b/iu.test(text)) return { classification: "CERTIFICATION", reason: "Review under certifications" };
  if (/\b(?:worked|delivered|responsible for|arbetade|ansvarade|arbetat|ansvarig för)\b/iu.test(text)) return { classification: "EXPERIENCE_TEXT", reason: "Work description" };
  if (text.length > 65 || text.split(/\s+/u).length > 7 || /[.!?]\s+\p{Lu}/u.test(text)) return { classification: "PROSE", reason: "Sentence-length text" };
  if (SOFT_SKILL_CONCEPTS.some(c => c.canonical === canonicalConcept(text, SOFT_SKILL_CONCEPTS))) return { classification: "SOFT_SKILL", reason: "Recognized interpersonal skill" };
  return { classification: "VALID_SKILL", reason: "No deterministic warning; user review remains authoritative" };
}
/** Diagnostic-only (see looksLikeRawImportBlock) - not part of the technical/soft skill review-decision flow. */
export function summaryReviewItem(profile: CandidateProfile): SkillReviewItem | null {
  if (!profile.summary || !looksLikeRawImportBlock(profile.summary)) return null;
  return { field: "summary", index: 0, value: profile.summary, classification: "RAW_IMPORT_BLOCK", reason: "Looks like pasted CV text rather than an authored professional summary", suspicious: true };
}
/** A certification list is lenient about plausible credential/skill names; it only flags what is clearly not a certification. */
const CERTIFICATION_FIELD_ALLOWED: readonly SkillClassification[] = ["VALID_SKILL", "SOFT_SKILL", "CERTIFICATION"];
export function reviewProfileQuality(profile: CandidateProfile): SkillReviewItem[] {
  const skills = (["technical", "soft"] as const).flatMap(field => profile.skills[field].map((value, index) => {
    const result = classifySkill(value, profile);
    return { field, index, value, ...result, suspicious: !["VALID_SKILL", "SOFT_SKILL"].includes(result.classification) };
  }));
  const certifications = profile.certifications.map((value, index) => {
    const result = classifySkill(value, profile);
    return { field: "certifications" as const, index, value, ...result, suspicious: !CERTIFICATION_FIELD_ALLOWED.includes(result.classification) };
  });
  return [...skills, ...certifications];
}
export type SkillReviewDecision = { field: "technical" | "soft" | "certifications"; index: number; expectedValue: string } & (
  { action: "keep" | "remove" }
  | { action: "move"; destination: "technical" | "soft" | "certifications" }
  | { action: "move"; destination: "experience"; experienceIndex: number }
  | { action: "move"; destination: "projects" }
);
/** Pure preview: caller must authorize, explicitly confirm and save through the existing profile workflow. */
export function previewSkillReview(profile: CandidateProfile, decisions: SkillReviewDecision[]): CandidateProfile {
  const next = structuredClone(profile);
  const seen = new Set<string>();
  for (const decision of decisions) {
    const key = `${decision.field}:${decision.index}`;
    const source = decision.field === "certifications" ? profile.certifications : profile.skills[decision.field];
    if (seen.has(key) || source[decision.index] !== decision.expectedValue) throw new Error("Stale or duplicate review decision");
    seen.add(key);
    if (decision.action === "move") {
      if (decision.destination === "experience") {
        const experience = next.workExperience[decision.experienceIndex];
        if (!experience) throw new Error("Select an existing experience");
        experience.summary = [experience.summary, decision.expectedValue].filter(Boolean).join("\n");
      } else if (decision.destination === "projects") {
        next.projects = [...(next.projects ?? []), { title: decision.expectedValue }];
      } else if (decision.destination === "certifications") {
        if (decision.field === "certifications") throw new Error("Choose a different destination");
        next.certifications.push(decision.expectedValue);
      } else if (decision.destination !== decision.field) {
        next.skills[decision.destination].push(decision.expectedValue);
      } else {
        throw new Error("Choose a different destination");
      }
    }
  }
  for (const field of ["technical", "soft"] as const) {
    const removed = new Set(decisions.filter(d => d.field === field && d.action !== "keep").map(d => d.index));
    next.skills[field] = next.skills[field].filter((_, index) => !removed.has(index));
  }
  const removedCertifications = new Set(decisions.filter(d => d.field === "certifications" && d.action !== "keep").map(d => d.index));
  next.certifications = next.certifications.filter((_, index) => !removedCertifications.has(index));
  return next;
}
