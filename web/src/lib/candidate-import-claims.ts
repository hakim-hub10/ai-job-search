import "server-only";

export const MAX_CANDIDATE_IMPORT_CLAIMS_TEXT_LENGTH = 100_000;

export type CandidateImportClaimKind =
  | "technicalSkill"
  | "softSkill"
  | "workExperience"
  | "education"
  | "certification"
  | "language"
  | "headline";

export interface CandidateImportClaim {
  id: string;
  candidateId: string;
  importId: string;
  documentId: string;
  kind: CandidateImportClaimKind;
  value: string;
  source: string;
  status: "proposed";
  provenance: {
    section?: string;
    snippet: string;
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

function extractSectionClaims(lines: string[], sectionName: string, kind: CandidateImportClaimKind, candidateId: string, importId: string, documentId: string): CandidateImportClaim[] {
  const claims: CandidateImportClaim[] = [];
  let currentSection = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const normalized = line.toLowerCase();
    if (normalized.includes(sectionName.toLowerCase())) {
      currentSection = sectionLabel(line);
      continue;
    }
    if (!currentSection) continue;
    if (/^(technical skills|soft skills|certifications|languages|education|work experience|experience|skills)$/iu.test(line)) {
      currentSection = sectionLabel(line);
      continue;
    }
    if (/^[-•*] /u.test(line) || /^\d+\.?\s+/u.test(line)) {
      const value = line.replace(/^[-•*]\s*/u, "").replace(/^\d+\.?\s*/u, "").trim();
      if (!value) continue;
      claims.push({
        id: `claim-${candidateId}-${importId}-${documentId}-${kind}-${index}`,
        candidateId,
        importId,
        documentId,
        kind,
        value,
        source: "cv-text",
        status: "proposed",
        provenance: {
          section: currentSection,
          snippet: clampSnippet(value),
          line: index + 1,
        },
      });
    }
  }
  return dedupe(claims.map((claim) => claim.value)).map((value, index) => ({
    ...claims.find((claim) => claim.value === value)!,
    id: `claim-${candidateId}-${importId}-${documentId}-${kind}-${index}`,
  }));
}

function extractWorkExperienceClaims(lines: string[], candidateId: string, importId: string, documentId: string): CandidateImportClaim[] {
  const claims: CandidateImportClaim[] = [];
  let currentSection = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lower = line.toLowerCase();
    if (lower.includes("work experience") || lower.includes("experience")) {
      currentSection = "Work Experience";
      continue;
    }
    if (!currentSection) continue;
    if (/(^|\s)(education|skills|certifications|languages)($|\s)/iu.test(line)) {
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
    const lower = line.toLowerCase();
    if (lower.includes("education")) {
      currentSection = "Education";
      continue;
    }
    if (!currentSection) continue;
    if (/(^|\s)(work experience|skills|certifications|languages)($|\s)/iu.test(line)) {
      currentSection = "";
      continue;
    }
    if (/\b(B\.?Sc\.?|M\.?Sc\.?|Bachelor|Master|Diploma|PhD|Doctorate)\b/iu.test(line) || /\b(university|college|institute)\b/iu.test(line)) {
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

function extractLanguageClaims(lines: string[], candidateId: string, importId: string, documentId: string): CandidateImportClaim[] {
  const claims: CandidateImportClaim[] = [];
  let currentSection = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lower = line.toLowerCase();
    if (lower.includes("language") || lower.includes("languages")) {
      currentSection = "Languages";
      continue;
    }
    if (!currentSection) continue;
    if (/(^|\s)(skills|education|certifications|work experience)($|\s)/iu.test(line)) {
      currentSection = "";
      continue;
    }
    if (/^[-•*] /u.test(line) || /^\d+\.?\s+/u.test(line)) {
      const value = line.replace(/^[-•*]\s*/u, "").replace(/^\d+\.?\s*/u, "").trim();
      if (!value) continue;
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
    ...extractSectionClaims(lines, "Technical Skills", "technicalSkill", input.candidateId, input.importId, input.documentId),
    ...extractSectionClaims(lines, "Soft Skills", "softSkill", input.candidateId, input.importId, input.documentId),
    ...extractSectionClaims(lines, "Certifications", "certification", input.candidateId, input.importId, input.documentId),
    ...extractWorkExperienceClaims(lines, input.candidateId, input.importId, input.documentId),
    ...extractEducationClaims(lines, input.candidateId, input.importId, input.documentId),
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
