import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import { canonicalConcept, SOFT_SKILL_CONCEPTS, TECHNICAL_CONCEPTS, normalizedConceptText } from "../../../.agents/job-search/cli/src/concept-normalization";

export type SkillClassification = "VALID_SKILL" | "SOFT_SKILL" | "TECHNICAL_SKILL" | "EXPERIENCE_TEXT" | "EMPLOYER_OR_ROLE" | "DATE" | "LOCATION" | "PROJECT" | "CERTIFICATION" | "EDUCATION" | "PROSE" | "SUSPICIOUS" | "RAW_IMPORT_BLOCK";
export type ProfileEvidenceField = "technical" | "soft" | "certifications" | "summary";
export interface SkillReviewItem {
  field: ProfileEvidenceField; index: number; value: string;
  classification: SkillClassification; reason: string; suspicious: boolean;
}
/**
 * Repairs "mojibake": UTF-8 bytes that were misread as Latin-1/Windows-1252
 * during import (e.g. by a source PDF/DOCX exporter upstream of this app),
 * producing literal characters like "GÃ¶teborg" instead of "Göteborg" in the
 * stored profile. The two-character signature - "Â"/"Ã" (U+00C2/U+00C3)
 * followed by a Latin-1 continuation-range character - only appears from this
 * specific mis-decode, so each matched pair is re-encoded as Latin-1 and
 * decoded as UTF-8 to recover the original character. Repairing pair-by-pair
 * (rather than round-tripping the whole string) means text that mixes
 * already-correct characters with mojibake fragments still gets fixed,
 * instead of a single invalid byte anywhere aborting the entire repair. A
 * pair whose round-trip is invalid UTF-8 (stray U+FFFD) is left untouched
 * rather than risking further corruption.
 */
export function repairMojibake(text: string): string {
  if (!text) return text;
  return text.replace(/[ÂÃ][-¿]/gu, (pair) => {
    const decoded = Buffer.from(pair, "latin1").toString("utf8");
    return decoded.includes("�") ? pair : decoded;
  });
}
/** Recursively applies repairMojibake to every string field of a value, never mutating the input. */
export function deepRepairMojibake<T>(value: T): T {
  if (typeof value === "string") return repairMojibake(value) as T;
  if (Array.isArray(value)) return value.map((item) => deepRepairMojibake(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepRepairMojibake(item)])) as T;
  }
  return value;
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
/**
 * A handful of widely-known technical tools/platforms that are commonly
 * mis-filed under "soft skills" during import, plus a generic shape check:
 * a single word fusing two capitalized parts with no space ("ServiceNow",
 * "PowerBI", "GitHub") reads as a product name, never as an interpersonal
 * skill phrase (those are lowercase or capitalized-first-word phrases like
 * "Stakeholder management"). Never applied to the technical-skills field,
 * where such names are simply valid.
 */
const KNOWN_TECHNICAL_TOOL_NAMES = new Set(["servicenow", "jira", "confluence", "salesforce", "sap", "zendesk", "slack", "tableau", "photoshop", "autocad", "jenkins", "ansible", "sharepoint"]);
function looksLikeTechnicalToolName(text: string): boolean {
  if (KNOWN_TECHNICAL_TOOL_NAMES.has(text.toLocaleLowerCase())) return true;
  if (TECHNICAL_CONCEPTS.some(c => c.canonical === canonicalConcept(text, TECHNICAL_CONCEPTS))) return true;
  return /^[A-ZÅÄÖ][a-zåäö]+[A-Z][a-zA-Z]*$/u.test(text);
}
/** Conservative flags, never a deletion policy. Context matches are exact, not guessed geography. */
export function classifySkill(value: string, profile?: CandidateProfile, field?: "technical" | "soft"): { classification: SkillClassification; reason: string } {
  const text = value.trim();
  const key = normalizedConceptText(text);
  if (field === "soft" && looksLikeTechnicalToolName(text)) return { classification: "TECHNICAL_SKILL", reason: "Technical tool or platform, not an interpersonal skill" };
  if (!text || /[-–/:]$/u.test(text) || /^(?:support|och|and|it-)$/iu.test(text)) return { classification: "SUSPICIOUS", reason: "Incomplete or ambiguous fragment" };
  if (/(?:https?:\/\/|www\.|\S+@\S+|referen[cs]|telefon|phone|contact:)/iu.test(text) || /^\+?[\d][\d\s().-]{5,}$/u.test(text)) return { classification: "SUSPICIOUS", reason: "Link, contact or reference text" };
  if (/^\(?(?:\d{4}(?:[-/.]\d{1,2})?(?:\s*[-–/]\s*(?:\d{4}(?:[-/.]\d{1,2})?|present|pågående|nu))?|\d{1,2}[/.]\d{1,2}[/.]\d{2,4})\)?$/iu.test(text)) return { classification: "DATE", reason: "Date rather than a skill" };
  // A location, employer or role name with a trailing "(2022 – 2023)" is a
  // date range that leaked onto the end of another field during import - the
  // whole value is pollution regardless of what precedes the parenthesis.
  if (/\(\s*\d{4}(?:\s*[-–]\s*(?:\d{4}|present|pågående|nu))?\s*\)\s*$/iu.test(text)) return { classification: "DATE", reason: "Ends with a leaked date range" };
  if (profile?.workExperience.some(x => [x.company, x.title].some(v => normalizedConceptText(v) === key)) || /\b(?:AB|Ltd|GmbH|Inc)\.?$/u.test(text) || /\b(?:engineer|technician|coordinator|manager|tekniker|samordnare|chef)$/iu.test(text)) return { classification: "EMPLOYER_OR_ROLE", reason: "Employer or role text" };
  if (profile && [...profile.locationPreferences, ...profile.workExperience.map(x => x.location)].some(v => normalizedConceptText(v) === key)) return { classification: "LOCATION", reason: "Matches a stored location" };
  if (profile?.education.some(x => [x.institution, x.degree].some(v => normalizedConceptText(v) === key)) || /\b(?:B\.?Sc\.?|M\.?Sc\.?|Bachelor|Master|Diploma|PhD|Doctorate|YH-examen)\b/iu.test(text) || /\b(?:university|college|institute|universitet|högskola|akademi)\b/iu.test(text)) return { classification: "EDUCATION", reason: "Education institution or degree text" };
  if (isProjectLabelled(text)) return { classification: "PROJECT", reason: "Project description" };
  if (profile?.certifications.some(v => normalizedConceptText(v) === key) || /\b(?:certified|certifierad|certification|certifikat)\b/iu.test(text)) return { classification: "CERTIFICATION", reason: "Review under certifications" };
  if (/\b(?:worked|delivered|responsible for|arbetade|ansvarade|arbetat|ansvarig för)\b/iu.test(text)) return { classification: "EXPERIENCE_TEXT", reason: "Work description" };
  const wordCount = text.split(/\s+/u).length;
  // A genuine skill/concept is a short noun phrase; a Swedish "och"/"samt"
  // conjunction joining more than a couple of words is a clause fragment
  // (e.g. "Dokumentation av lösningar och incidenter"), not a discrete skill.
  if (wordCount > 3 && /\b(?:och|samt)\b/iu.test(text)) return { classification: "PROSE", reason: "Sentence fragment (conjunction)" };
  if (text.length > 65 || wordCount > 6 || /[.!?]\s+\p{Lu}/u.test(text)) return { classification: "PROSE", reason: "Sentence-length text" };
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
/** The technical field accepts recognized tool/platform names; only the soft field treats them as misplaced. */
const TECHNICAL_FIELD_ALLOWED: readonly SkillClassification[] = ["VALID_SKILL", "SOFT_SKILL", "TECHNICAL_SKILL"];
const SOFT_FIELD_ALLOWED: readonly SkillClassification[] = ["VALID_SKILL", "SOFT_SKILL"];
export function reviewProfileQuality(profile: CandidateProfile): SkillReviewItem[] {
  const skills = (["technical", "soft"] as const).flatMap(field => profile.skills[field].map((value, index) => {
    const result = classifySkill(value, profile, field);
    const allowed = field === "technical" ? TECHNICAL_FIELD_ALLOWED : SOFT_FIELD_ALLOWED;
    return { field, index, value, ...result, suspicious: !allowed.includes(result.classification) };
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
  /**
   * The Education model requires degree/field/institution as non-optional
   * strings (see CandidateProfile in .agents/job-search/cli/src/profile.ts) -
   * a flagged free-text value like "Gränsälvsgymnasiet (2016–2018)" cannot be
   * split into those three fields without guessing which part is which, and
   * this system never invents institution, degree, or dates. The candidate
   * must therefore supply the structured education fields themselves as part
   * of this decision; the flagged value only explains why the correction is
   * being offered, it is never itself parsed into education.
   */
  | { action: "move"; destination: "education"; education: { degree: string; field: string; institution: string; startYear?: number; endYear?: number } }
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
      } else if (decision.destination === "education") {
        const { degree, field, institution, startYear, endYear } = decision.education;
        if (!degree.trim() || !field.trim() || !institution.trim()) {
          throw new Error("Degree, field, and institution are required to move an item into education");
        }
        // Never invented from the flagged string - these are the candidate's
        // own explicitly-typed values, supplied as part of this decision.
        const duplicate = next.education.some((entry) =>
          normalizedConceptText(entry.institution) === normalizedConceptText(institution)
          && normalizedConceptText(entry.degree) === normalizedConceptText(degree),
        );
        if (!duplicate) {
          next.education.push({
            degree: degree.trim(), field: field.trim(), institution: institution.trim(),
            ...(startYear !== undefined ? { startYear } : {}),
            ...(endYear !== undefined ? { endYear } : {}),
          });
        }
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
