import { readFile } from "node:fs/promises"
import type { CandidateProfile, EmploymentType, WorkMode } from "./profile"

export type CandidateProfileInputErrorCode =
  | "READ_FAILURE"
  | "MALFORMED_JSON"
  | "INVALID_ROOT"
  | "INVALID_FIELD"
  | "INVALID_ENTRY"
  | "UNSUPPORTED_VALUE"

/** Safe, field-oriented input error that never includes profile contents. */
export class CandidateProfileInputError extends Error {
  readonly code: CandidateProfileInputErrorCode
  readonly path?: string
  override readonly cause?: unknown

  constructor(code: CandidateProfileInputErrorCode, message: string, path?: string, cause?: unknown) {
    super(message)
    this.name = "CandidateProfileInputError"
    this.code = code
    this.path = path
    this.cause = cause
  }
}

const WORK_MODES = new Set<WorkMode>(["remote", "hybrid", "onsite", "open"])
const EMPLOYMENT_TYPES = new Set<EmploymentType>(["full-time", "part-time", "contract", "temporary", "internship", "open"])
const PROFILE_FIELDS = new Set([
  "headline", "targetRoles", "locationPreferences", "workMode", "remotePreference",
  "preferredIndustries", "preferredEmploymentType", "skills", "workExperience", "education",
  "certifications", "languages", "yearsOfExperience", "careerGoals", "summary", "updatedAt",
])
const SKILL_FIELDS = new Set(["technical", "soft"])
const EXPERIENCE_FIELDS = new Set(["title", "company", "location", "startDate", "endDate", "summary"])
const EDUCATION_FIELDS = new Set(["degree", "field", "institution", "startYear", "endYear"])
const LANGUAGE_FIELDS = new Set(["name", "level"])

function failure(code: CandidateProfileInputErrorCode, path: string, message: string): never {
  throw new CandidateProfileInputError(code, `${path} ${message}`, path)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function object(value: unknown, path: string, code: CandidateProfileInputErrorCode = "INVALID_FIELD"): Record<string, unknown> {
  if (!isRecord(value)) failure(code, path, "must be an object")
  return value
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: Set<string>, path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) failure("UNSUPPORTED_VALUE", `${path}.${key}`, "is not supported")
  }
}

function required(value: Record<string, unknown>, key: string, path: string): unknown {
  if (!(key in value)) failure("INVALID_FIELD", `${path}.${key}`, "is required")
  return value[key]
}

function text(value: unknown, path: string, nonEmpty = false): string {
  if (typeof value !== "string") failure("INVALID_FIELD", path, "must be a string")
  if (nonEmpty && value.trim().length === 0) failure("INVALID_FIELD", path, "must not be empty")
  return value
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) failure("INVALID_FIELD", path, "must be an array")
  return value.map((item, index) => text(item, `${path}[${index}]`, true))
}

function finiteNumber(value: unknown, path: string, nonNegative = false): number {
  if (typeof value !== "number" || !Number.isFinite(value)) failure("INVALID_FIELD", path, "must be a finite number")
  if (nonNegative && value < 0) failure("INVALID_FIELD", path, "must be non-negative")
  return value
}

function optionalText(value: Record<string, unknown>, key: string, path: string): string | undefined {
  return key in value ? text(value[key], `${path}.${key}`) : undefined
}

function parseSkills(value: unknown): CandidateProfile["skills"] {
  const input = object(value, "profile.skills")
  rejectUnknownFields(input, SKILL_FIELDS, "profile.skills")
  return {
    technical: stringArray(required(input, "technical", "profile.skills"), "profile.skills.technical"),
    soft: stringArray(required(input, "soft", "profile.skills"), "profile.skills.soft"),
  }
}

function parseExperience(value: unknown): CandidateProfile["workExperience"] {
  if (!Array.isArray(value)) failure("INVALID_FIELD", "profile.workExperience", "must be an array")
  return value.map((entry, index) => {
    const path = `profile.workExperience[${index}]`
    const input = object(entry, path, "INVALID_ENTRY")
    rejectUnknownFields(input, EXPERIENCE_FIELDS, path)
    const result = {
      title: text(required(input, "title", path), `${path}.title`, true),
      company: text(required(input, "company", path), `${path}.company`, true),
      location: text(required(input, "location", path), `${path}.location`, true),
    }
    const startDate = optionalText(input, "startDate", path)
    const endDate = optionalText(input, "endDate", path)
    const summary = optionalText(input, "summary", path)
    return {
      ...result,
      ...(startDate === undefined ? {} : { startDate }),
      ...(endDate === undefined ? {} : { endDate }),
      ...(summary === undefined ? {} : { summary }),
    }
  })
}

function parseEducation(value: unknown): CandidateProfile["education"] {
  if (!Array.isArray(value)) failure("INVALID_FIELD", "profile.education", "must be an array")
  return value.map((entry, index) => {
    const path = `profile.education[${index}]`
    const input = object(entry, path, "INVALID_ENTRY")
    rejectUnknownFields(input, EDUCATION_FIELDS, path)
    const result = {
      degree: text(required(input, "degree", path), `${path}.degree`, true),
      field: text(required(input, "field", path), `${path}.field`, true),
      institution: text(required(input, "institution", path), `${path}.institution`, true),
    }
    const startYear = "startYear" in input ? finiteNumber(input.startYear, `${path}.startYear`) : undefined
    const endYear = "endYear" in input ? finiteNumber(input.endYear, `${path}.endYear`) : undefined
    return {
      ...result,
      ...(startYear === undefined ? {} : { startYear }),
      ...(endYear === undefined ? {} : { endYear }),
    }
  })
}

function parseLanguages(value: unknown): CandidateProfile["languages"] {
  if (!Array.isArray(value)) failure("INVALID_FIELD", "profile.languages", "must be an array")
  return value.map((entry, index) => {
    const path = `profile.languages[${index}]`
    const input = object(entry, path, "INVALID_ENTRY")
    rejectUnknownFields(input, LANGUAGE_FIELDS, path)
    return {
      name: text(required(input, "name", path), `${path}.name`, true),
      level: text(required(input, "level", path), `${path}.level`, true),
    }
  })
}

/** Validates untrusted input and creates a CandidateProfile without defaults or inference. */
export function parseCandidateProfile(value: unknown): CandidateProfile {
  const input = object(value, "profile", "INVALID_ROOT")
  rejectUnknownFields(input, PROFILE_FIELDS, "profile")
  const workMode = text(required(input, "workMode", "profile"), "profile.workMode")
  if (!WORK_MODES.has(workMode as WorkMode)) failure("UNSUPPORTED_VALUE", "profile.workMode", "must be remote, hybrid, onsite, or open")
  const preferredEmploymentType = stringArray(required(input, "preferredEmploymentType", "profile"), "profile.preferredEmploymentType")
  for (const [index, employmentType] of preferredEmploymentType.entries()) {
    if (!EMPLOYMENT_TYPES.has(employmentType as EmploymentType)) failure("UNSUPPORTED_VALUE", `profile.preferredEmploymentType[${index}]`, "has an unsupported value")
  }
  const remotePreference = required(input, "remotePreference", "profile")
  if (typeof remotePreference !== "boolean") failure("INVALID_FIELD", "profile.remotePreference", "must be a boolean")

  const result: CandidateProfile = {
    headline: text(required(input, "headline", "profile"), "profile.headline", true),
    targetRoles: stringArray(required(input, "targetRoles", "profile"), "profile.targetRoles"),
    locationPreferences: stringArray(required(input, "locationPreferences", "profile"), "profile.locationPreferences"),
    workMode: workMode as WorkMode,
    remotePreference,
    preferredIndustries: stringArray(required(input, "preferredIndustries", "profile"), "profile.preferredIndustries"),
    preferredEmploymentType: preferredEmploymentType as EmploymentType[],
    skills: parseSkills(required(input, "skills", "profile")),
    workExperience: parseExperience(required(input, "workExperience", "profile")),
    education: parseEducation(required(input, "education", "profile")),
    certifications: stringArray(required(input, "certifications", "profile"), "profile.certifications"),
    languages: parseLanguages(required(input, "languages", "profile")),
    yearsOfExperience: finiteNumber(required(input, "yearsOfExperience", "profile"), "profile.yearsOfExperience", true),
    careerGoals: stringArray(required(input, "careerGoals", "profile"), "profile.careerGoals"),
  }
  const summary = optionalText(input, "summary", "profile")
  const updatedAt = optionalText(input, "updatedAt", "profile")
  if (summary !== undefined) result.summary = summary
  if (updatedAt !== undefined) result.updatedAt = updatedAt
  return result
}

/** Loads one caller-supplied UTF-8 JSON file without any default or fallback profile. */
export async function loadCandidateProfile(path: string): Promise<CandidateProfile> {
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch (error) {
    throw new CandidateProfileInputError("READ_FAILURE", "Candidate profile could not be read.", undefined, error)
  }
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch (error) {
    throw new CandidateProfileInputError("MALFORMED_JSON", "Candidate profile contains malformed JSON.", undefined, error)
  }
  return parseCandidateProfile(input)
}
