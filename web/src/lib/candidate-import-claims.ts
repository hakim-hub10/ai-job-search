import "server-only";

import { classifySkill, type SkillClassification } from "./profile-quality";

export const MAX_CANDIDATE_IMPORT_CLAIMS_TEXT_LENGTH = 100_000;

export type CandidateImportClaimKind =
  | "technicalSkill"
  | "softSkill"
  | "workExperience"
  | "education"
  | "certification"
  | "language"
  | "headline"
  | "project";

export type CandidateImportClaimSource = "cv-text" | "user";

export interface CandidateImportClaim {
  id: string;
  candidateId: string;
  importId: string;
  documentId: string;
  kind: CandidateImportClaimKind;
  value: string;
  source: CandidateImportClaimSource;
  status: "proposed";
  provenance: {
    section?: string;
    snippet?: string;
    line?: number;
  };
}

export type CandidateImportClaimsErrorCode =
  | "INVALID_INPUT"
  | "TEXT_LIMIT_EXCEEDED"
  | "NO_CLAIMS";

export type CandidateImportClaimsResult =
  | { ok: true; value: { claims: CandidateImportClaim[] } }
  | { ok: false; error: { code: CandidateImportClaimsErrorCode; message: string } };

const messages = {
  INVALID_INPUT: "The upload data is missing required linkage or text.",
  TEXT_LIMIT_EXCEEDED: "The extracted text exceeds the claim-extraction limit.",
  NO_CLAIMS: "No proposed claims were extracted from the supplied text.",
} as const;

function failure(code: CandidateImportClaimsErrorCode): CandidateImportClaimsResult {
  return { ok: false, error: { code, message: messages[code] } };
}

function normalize(text: string): string {
  return text.replace(/\r\n?/gu, "\n").replace(/\0/gu, "").replace(/\u0000/gu, "").trim();
}

function clampSnippet(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 240) return trimmed;
  return `${trimmed.slice(0, 237).trim()}...`;
}

function splitLines(text: string): string[] {
  return normalize(text).split(/\n+/u).map((line) => line.trim()).filter(Boolean);
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.trim();
    if (!key) continue;
    if (!seen.has(key.toLowerCase())) {
      seen.add(key.toLowerCase());
      result.push(key);
    }
  }
  return result;
}

function sectionLabel(section: string): string {
  return section.trim().replace(/\s+/gu, " ");
}

type ImportSection = "technicalSkill" | "softSkill" | "certification" | "language" | "workExperience" | "education" | "project";

const sectionNames: Record<ImportSection, readonly string[]> = {
  technicalSkill: ["technical skills", "skills", "kompetenser", "tekniska kompetenser", "tekniska färdigheter", "tekniska kunskaper", "it-kompetenser"],
  softSkill: ["soft skills", "mjuka kompetenser", "personliga egenskaper"],
  certification: ["certifications", "certificates", "certifieringar"],
  language: ["languages", "language", "språk"],
  workExperience: ["work experience", "experience", "employment", "arbetslivserfarenhet", "yrkeserfarenhet", "erfarenhet"],
  education: ["education", "utbildning"],
  project: ["projects", "project", "projekt"],
};

function normalizedHeading(value: string): string {
  return value.normalize("NFKC").trim().replace(/:+$/u, "").replace(/\s+/gu, " ").toLocaleLowerCase("sv-SE");
}

function sectionForHeading(line: string): ImportSection | null {
  const heading = normalizedHeading(line);
  return (Object.keys(sectionNames) as ImportSection[]).find((kind) => sectionNames[kind].includes(heading)) ?? null;
}

function splitListValues(line: string): string[] {
  const trimmed = line.replace(/^[-•*]\s*/u, "").replace(/^\d+[.)]\s*/u, "").trim();
  if (!trimmed || trimmed.length > 160 || /[.!?]$/u.test(trimmed)) return [];
  const values = trimmed.split(/[;|,]/u).map((value) => value.trim()).filter(Boolean);
  return values.length > 0 && values.every((value) => value.length <= 100) ? values : [];
}

/**
 * Reuses profile-quality.ts's classifySkill - the same classifier that later
 * screens document generation - so import time and generation time can never
 * disagree about what counts as a plausible skill/certification. A line is
 * never accepted into a section just because it appeared after that
 * section's heading; it must also look plausible for that category.
 */
const REJECTED_FOR_SKILL: readonly SkillClassification[] = ["SUSPICIOUS", "DATE", "LOCATION", "EMPLOYER_OR_ROLE", "EDUCATION", "PROSE", "EXPERIENCE_TEXT", "PROJECT", "CERTIFICATION"];
const REJECTED_FOR_CERTIFICATION: readonly SkillClassification[] = ["SUSPICIOUS", "DATE", "LOCATION", "EMPLOYER_OR_ROLE", "EDUCATION", "PROSE", "EXPERIENCE_TEXT", "PROJECT"];

function isPlausibleForSection(value: string, kind: "technicalSkill" | "softSkill" | "certification"): boolean {
  if (!value.trim() || value.length > 80) return false;
  const classification = classifySkill(value).classification;
  const rejected = kind === "certification" ? REJECTED_FOR_CERTIFICATION : REJECTED_FOR_SKILL;
  return !rejected.includes(classification);
}

function inlineValues(line: string, kind: ImportSection): string[] {
  const separator = line.indexOf(":");
  if (separator < 1 || sectionForHeading(line.slice(0, separator)) !== kind) return [];
  return splitListValues(line.slice(separator + 1));
}

type SectionClaimKind = "technicalSkill" | "softSkill" | "certification";

function makeClaim(kind: CandidateImportClaimKind, value: string, section: string, index: number, candidateId: string, importId: string, documentId: string): CandidateImportClaim {
  return {
    id: `claim-${candidateId}-${importId}-${documentId}-${kind}-${index}`,
    candidateId, importId, documentId, kind, value, source: "cv-text", status: "proposed",
    provenance: { section, snippet: clampSnippet(value), line: index + 1 },
  };
}

/**
 * A value that is plausible for the section it appeared in becomes that
 * kind's claim. A value that instead looks like a project description (see
 * isProjectLabelled in profile-quality.ts, e.g. "GITHUB-PROJEKT: ...") is
 * rerouted to a project claim instead of being forced into the wrong
 * category or silently dropped - projects have nowhere else to go until the
 * candidate reviews and completes a structured entry.
 *
 * IDs are always namespaced by this call's own scanKind (technicalSkill,
 * softSkill or certification), never by a claim's possibly-rerouted actual
 * kind: three separate calls (one per scanKind) run over the same lines, and
 * only the call whose heading currently governs a given line produces a
 * claim for it, so per-call sequential IDs under a fixed, distinct namespace
 * can never collide with another call's IDs - even when both reroute some
 * of their values to "project".
 */
function extractSectionClaims(lines: string[], scanKind: SectionClaimKind, candidateId: string, importId: string, documentId: string): CandidateImportClaim[] {
  const claims: CandidateImportClaim[] = [];
  let currentSection = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const section = sectionForHeading(line);
    if (section === scanKind) {
      currentSection = sectionLabel(line);
      continue;
    }
    const inline = inlineValues(line, scanKind);
    if (inline.length > 0) {
      const inlineSection = sectionLabel(line.slice(0, line.indexOf(":")));
      for (const value of inline) {
        const target = classifySkill(value).classification === "PROJECT" ? "project" : scanKind;
        claims.push(makeClaim(target, value, inlineSection, index, candidateId, importId, documentId));
      }
      continue;
    }
    if (!currentSection) continue;
    if (section) { currentSection = ""; continue; }
    for (const value of splitListValues(line)) {
      if (classifySkill(value).classification === "PROJECT") {
        claims.push(makeClaim("project", value, currentSection, index, candidateId, importId, documentId));
      } else if (isPlausibleForSection(value, scanKind)) {
        claims.push(makeClaim(scanKind, value, currentSection, index, candidateId, importId, documentId));
      }
    }
  }
  return dedupe(claims.map((claim) => `${claim.kind}:${claim.value}`)).map((key, index) => {
    const match = claims.find((claim) => `${claim.kind}:${claim.value}` === key)!;
    return { ...match, id: `claim-${candidateId}-${importId}-${documentId}-${scanKind}-${index}` };
  });
}

function extractWorkExperienceClaims(lines: string[], candidateId: string, importId: string, documentId: string): CandidateImportClaim[] {
  const claims: CandidateImportClaim[] = [];
  let currentSection = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const section = sectionForHeading(line);
    if (section === "workExperience") {
      currentSection = "Work Experience";
      continue;
    }
    if (!currentSection) continue;
    if (section) {
      currentSection = "";
      continue;
    }

    const next = lines[index + 1] ?? "";
    if (/,/u.test(line) && /\d{4}/u.test(next) && !/^[-•*] /u.test(line)) {
      const value = `${line} ${next}`.trim();
      claims.push({
        id: `claim-${candidateId}-${importId}-${documentId}-workExperience-${index}`,
        candidateId,
        importId,
        documentId,
        kind: "workExperience",
        value,
        source: "cv-text",
        status: "proposed",
        provenance: { section: currentSection, snippet: clampSnippet(value), line: index + 1 },
      });
      index += 1;
    }
  }
  return dedupe(claims.map((claim) => claim.value)).map((value, index) => ({
    ...claims.find((claim) => claim.value === value)!,
    id: `claim-${candidateId}-${importId}-${documentId}-workExperience-${index}`,
  }));
}

function extractEducationClaims(lines: string[], candidateId: string, importId: string, documentId: string): CandidateImportClaim[] {
  const claims: CandidateImportClaim[] = [];
  let currentSection = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const section = sectionForHeading(line);
    if (section === "education") {
      currentSection = "Education";
      continue;
    }
    if (!currentSection) continue;
    if (section) {
      currentSection = "";
      continue;
    }
    if (/\b(B\.?Sc\.?|M\.?Sc\.?|Bachelor|Master|Diploma|PhD|Doctorate|YH)\b/iu.test(line) || /\b(university|college|institute|universitet|högskola|academy|akademi)\b/iu.test(line)) {
      const value = line.trim();
      claims.push({
        id: `claim-${candidateId}-${importId}-${documentId}-education-${index}`,
        candidateId,
        importId,
        documentId,
        kind: "education",
        value,
        source: "cv-text",
        status: "proposed",
        provenance: { section: currentSection, snippet: clampSnippet(value), line: index + 1 },
      });
    }
  }
  return dedupe(claims.map((claim) => claim.value)).map((value, index) => ({
    ...claims.find((claim) => claim.value === value)!,
    id: `claim-${candidateId}-${importId}-${documentId}-education-${index}`,
  }));
}

/** An explicit "Projects"/"Projekt" heading: each bullet becomes a proposed project title, not a skill or certification. */
function extractProjectClaims(lines: string[], candidateId: string, importId: string, documentId: string): CandidateImportClaim[] {
  const claims: CandidateImportClaim[] = [];
  let currentSection = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const section = sectionForHeading(line);
    if (section === "project") {
      currentSection = sectionLabel(line);
      continue;
    }
    if (!currentSection) continue;
    if (section) { currentSection = ""; continue; }
    // Lenient by design: a project's own section legitimately contains
    // longer descriptions and URLs that would be rejected elsewhere. Only
    // reject the same unambiguous non-project fragments used everywhere else
    // (a bare date, or contact/reference boilerplate).
    for (const value of splitListValues(line)) {
      if (!["DATE", "SUSPICIOUS"].includes(classifySkill(value).classification)) {
        claims.push(makeClaim("project", value, currentSection, index, candidateId, importId, documentId));
      }
    }
  }
  return dedupe(claims.map((claim) => claim.value)).map((value, index) => ({
    ...claims.find((claim) => claim.value === value)!,
    id: `claim-${candidateId}-${importId}-${documentId}-project-${index}`,
  }));
}

function extractLanguageClaims(lines: string[], candidateId: string, importId: string, documentId: string): CandidateImportClaim[] {
  const claims: CandidateImportClaim[] = [];
  let currentSection = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const section = sectionForHeading(line);
    if (section === "language") {
      currentSection = "Languages";
      continue;
    }
    if (!currentSection) continue;
    if (section) {
      currentSection = "";
      continue;
    }
    for (const value of splitListValues(line)) {
      claims.push({
        id: `claim-${candidateId}-${importId}-${documentId}-language-${index}`,
        candidateId,
        importId,
        documentId,
        kind: "language",
        value,
        source: "cv-text",
        status: "proposed",
        provenance: { section: currentSection, snippet: clampSnippet(value), line: index + 1 },
      });
    }
  }
  return dedupe(claims.map((claim) => claim.value)).map((value, index) => ({
    ...claims.find((claim) => claim.value === value)!,
    id: `claim-${candidateId}-${importId}-${documentId}-language-${index}`,
  }));
}

/** Extracts proposed, unverified claims from already extracted CV text. */
export async function extractCandidateImportClaims(input: {
  candidateId: string;
  importId: string;
  documentId: string;
  text: string;
}): Promise<CandidateImportClaimsResult> {
  if (!input || typeof input.candidateId !== "string" || typeof input.importId !== "string" || typeof input.documentId !== "string" || typeof input.text !== "string") {
    return failure("INVALID_INPUT");
  }

  const normalized = normalize(input.text);
  if (!normalized) {
    return { ok: true, value: { claims: [] } };
  }
  if (normalized.length > MAX_CANDIDATE_IMPORT_CLAIMS_TEXT_LENGTH) {
    return failure("TEXT_LIMIT_EXCEEDED");
  }

  const lines = splitLines(normalized);
  const claims: CandidateImportClaim[] = [
    ...extractSectionClaims(lines, "technicalSkill", input.candidateId, input.importId, input.documentId),
    ...extractSectionClaims(lines, "softSkill", input.candidateId, input.importId, input.documentId),
    ...extractSectionClaims(lines, "certification", input.candidateId, input.importId, input.documentId),
    ...extractWorkExperienceClaims(lines, input.candidateId, input.importId, input.documentId),
    ...extractEducationClaims(lines, input.candidateId, input.importId, input.documentId),
    ...extractProjectClaims(lines, input.candidateId, input.importId, input.documentId),
    ...extractLanguageClaims(lines, input.candidateId, input.importId, input.documentId),
  ];

  const unique = dedupe(claims.map((claim) => `${claim.kind}:${claim.value}`)).map((key) => {
    const match = claims.find((claim) => `${claim.kind}:${claim.value}` === key);
    return match!;
  });

  if (unique.length === 0) {
    return { ok: true, value: { claims: [] } };
  }

  return { ok: true, value: { claims: unique } };
}
