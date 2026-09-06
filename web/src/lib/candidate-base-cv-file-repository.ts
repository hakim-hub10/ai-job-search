import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { CandidateBaseCv } from "./candidate-base-cv";
import type {
  CandidateBaseCvRepository,
  CandidateBaseCvRepositoryErrorCode,
  CandidateBaseCvRepositoryResult,
} from "./candidate-base-cv-repository";

const SCHEMA_VERSION = 1;
const VISIBILITY_KEYS = [
  "certifications",
  "education",
  "headline",
  "languages",
  "softSkills",
  "summary",
  "technicalSkills",
  "workExperience",
] as const;

interface CandidateBaseCvEnvelope {
  schemaVersion: typeof SCHEMA_VERSION;
  baseCvs: CandidateBaseCv[];
}

function failure<T>(
  code: CandidateBaseCvRepositoryErrorCode,
  message: string,
): CandidateBaseCvRepositoryResult<T> {
  return { ok: false, error: { code, message } };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    && !Number.isNaN(Date.parse(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isLanguages(value: unknown): boolean {
  return Array.isArray(value)
    && value.every((language) => isObject(language)
      && hasText(language.name)
      && hasText(language.level)
      && Object.keys(language).every((key) => ["name", "level"].includes(key)));
}

function isWorkExperience(value: unknown): boolean {
  return Array.isArray(value)
    && value.every((experience) => isObject(experience)
      && hasText(experience.title)
      && hasText(experience.company)
      && hasText(experience.location)
      && ["title", "company", "location", "startDate", "endDate", "summary"].every((key) =>
        !(key in experience) || experience[key] === undefined || typeof experience[key] === "string"));
}

function isEducation(value: unknown): boolean {
  return Array.isArray(value)
    && value.every((education) => isObject(education)
      && hasText(education.degree)
      && hasText(education.field)
      && hasText(education.institution)
      && ["startYear", "endYear"].every((key) =>
        !(key in education) || education[key] === undefined || typeof education[key] === "number"));
}

function isVisibility(value: unknown): boolean {
  if (!isObject(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === VISIBILITY_KEYS.length
    && keys.every((key, index) => key === [...VISIBILITY_KEYS].sort()[index])
    && VISIBILITY_KEYS.every((key) => typeof value[key] === "boolean");
}

export function isCandidateBaseCv(value: unknown): value is CandidateBaseCv {
  if (!isObject(value)) return false;
  const keys = Object.keys(value).sort();
  const allowedKeys = [
    "candidateId", "source", "profileUpdatedAt", "headline", "summary",
    "workExperience", "education", "technicalSkills", "softSkills",
    "certifications", "languages", "visibility", "createdAt", "updatedAt",
  ].sort();

  const checks = [
    keys.every((key) => allowedKeys.includes(key)),
    keys.includes("candidateId"), keys.includes("source"), keys.includes("headline"),
    keys.includes("workExperience"), keys.includes("education"), keys.includes("technicalSkills"),
    keys.includes("softSkills"), keys.includes("certifications"), keys.includes("languages"),
    keys.includes("visibility"), keys.includes("createdAt"), keys.includes("updatedAt"),
    hasText(value.candidateId), value.source === "candidateProfile", hasText(value.headline),
    value.summary === undefined || typeof value.summary === "string",
    value.profileUpdatedAt === undefined || isTimestamp(value.profileUpdatedAt),
    isWorkExperience(value.workExperience), isEducation(value.education),
    isStringArray(value.technicalSkills), isStringArray(value.softSkills),
    isStringArray(value.certifications), isLanguages(value.languages), isVisibility(value.visibility),
    isTimestamp(value.createdAt), isTimestamp(value.updatedAt),
  ];
  return checks.every(Boolean);
}

function validateEnvelope(value: unknown): CandidateBaseCvRepositoryResult<CandidateBaseCvEnvelope> {
  if (!isObject(value) || value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.baseCvs)) {
    return failure("CORRUPT_STORAGE", "Grund-CV-lagringen har ett ogiltigt format.");
  }

  const candidateIds = new Set<string>();
  for (const baseCv of value.baseCvs) {
    if (!isCandidateBaseCv(baseCv)) {
      return failure("CORRUPT_STORAGE", "Grund-CV-lagringen innehåller en ogiltig post.");
    }
    if (candidateIds.has(baseCv.candidateId)) {
      return failure("CORRUPT_STORAGE", "Grund-CV-lagringen innehåller dubbla kandidat-ID:n.");
    }
    candidateIds.add(baseCv.candidateId);
  }

  return {
    ok: true,
    value: {
      schemaVersion: SCHEMA_VERSION,
      baseCvs: structuredClone(value.baseCvs).sort((a, b) => a.candidateId.localeCompare(b.candidateId)),
    },
  };
}

function errorCode(error: unknown): string | undefined {
  return isObject(error) && typeof error.code === "string" ? error.code : undefined;
}

export function createFileCandidateBaseCvRepository(filePath: string): CandidateBaseCvRepository {
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.tmp`);

  async function loadEnvelope(): Promise<CandidateBaseCvRepositoryResult<CandidateBaseCvEnvelope>> {
    let contents: string;
    try {
      contents = await readFile(filePath, "utf8");
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        return { ok: true, value: { schemaVersion: SCHEMA_VERSION, baseCvs: [] } };
      }
      return failure("READ_FAILURE", "Grund-CV-lagringen kunde inte läsas.");
    }

    if (!contents.trim()) return failure("CORRUPT_STORAGE", "Grund-CV-lagringen är tom.");
    try {
      return validateEnvelope(JSON.parse(contents));
    } catch {
      return failure("CORRUPT_STORAGE", "Grund-CV-lagringen innehåller ogiltig JSON.");
    }
  }

  async function writeEnvelope(envelope: CandidateBaseCvEnvelope): Promise<CandidateBaseCvRepositoryResult<void>> {
    const validated = validateEnvelope(envelope);
    if (!validated.ok) return validated;

    try {
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
      await writeFile(tempPath, `${JSON.stringify(validated.value, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      const handle = await open(tempPath, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(tempPath, filePath);
      return { ok: true, value: undefined };
    } catch {
      await rm(tempPath, { force: true }).catch(() => undefined);
      return failure("WRITE_FAILURE", "Grund-CV-lagringen kunde inte sparas.");
    }
  }

  return {
    async save(baseCv) {
      if (!isCandidateBaseCv(baseCv)) return failure("INVALID_RECORD", "Grund-CV-posten är ogiltig.");
      const loaded = await loadEnvelope();
      if (!loaded.ok) return loaded;
      const baseCvs = loaded.value.baseCvs.filter((item) => item.candidateId !== baseCv.candidateId);
      baseCvs.push(structuredClone(baseCv));
      const written = await writeEnvelope({ schemaVersion: SCHEMA_VERSION, baseCvs });
      return written.ok ? { ok: true, value: structuredClone(baseCv) } : written;
    },

    async getByCandidateId(candidateId) {
      const loaded = await loadEnvelope();
      if (!loaded.ok) return loaded;
      const baseCv = loaded.value.baseCvs.find((item) => item.candidateId === candidateId);
      return baseCv
        ? { ok: true, value: structuredClone(baseCv) }
        : failure("NOT_FOUND", "Grund-CV hittades inte.");
    },
  };
}
