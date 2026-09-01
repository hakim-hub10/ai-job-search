import { readFile } from "node:fs/promises"
import type {
  CandidateDocumentEvidence,
  CandidateDocumentInput,
  CandidateDocumentIdentity,
  CandidateEvidenceContext,
  CandidateEvidenceKind,
  CandidateEvidenceRequirement,
} from "./application-documents"
import type { RequirementCategory } from "./requirements"

export type CandidateDocumentEvidenceInputErrorCode =
  | "READ_FAILURE"
  | "MALFORMED_JSON"
  | "INVALID_ROOT"
  | "INVALID_FIELD"
  | "INVALID_ENTRY"
  | "UNSUPPORTED_VALUE"
  | "DUPLICATE_EVIDENCE_ID"

/** Safe, field-oriented input error that never includes candidate evidence contents. */
export class CandidateDocumentEvidenceInputError extends Error {
  readonly code: CandidateDocumentEvidenceInputErrorCode
  readonly path?: string
  override readonly cause?: unknown

  constructor(code: CandidateDocumentEvidenceInputErrorCode, message: string, path?: string, cause?: unknown) {
    super(message)
    this.name = "CandidateDocumentEvidenceInputError"
    this.code = code
    this.path = path
    this.cause = cause
  }
}

/** Local document facts only. MatchingProfile is deliberately loaded separately. */
export type CandidateDocumentEvidenceInput = Omit<CandidateDocumentInput, "matchingProfile">

const ROOT_FIELDS = new Set(["identity", "evidence"])
const IDENTITY_FIELDS = new Set(["fullName", "email", "phone", "location", "links"])
const EVIDENCE_FIELDS = new Set(["id", "kind", "content", "context", "relatedRequirements"])
const CONTEXT_FIELDS = new Set(["employer", "role", "location", "startDate", "endDate"])
const REQUIREMENT_FIELDS = new Set(["category", "value"])
const EVIDENCE_KINDS = new Set<CandidateEvidenceKind>([
  "identity", "summary", "experience", "skill", "education", "certification", "language", "project", "achievement", "motivation", "other",
])
const REQUIREMENT_CATEGORIES = new Set<RequirementCategory>(["skill", "certification", "language", "experience", "education", "other"])

function failure(code: CandidateDocumentEvidenceInputErrorCode, path: string, message: string): never {
  throw new CandidateDocumentEvidenceInputError(code, `${path} ${message}`, path)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function object(value: unknown, path: string, code: CandidateDocumentEvidenceInputErrorCode = "INVALID_FIELD"): Record<string, unknown> {
  if (!isRecord(value)) failure(code, path, "must be an object")
  return value
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: Set<string>, path: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) failure("UNSUPPORTED_VALUE", `${path}.${key}`, "is not supported")
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string") failure("INVALID_FIELD", path, "must be a string")
  if (value.trim().length === 0) failure("INVALID_FIELD", path, "must not be empty")
  return value
}

function optionalText(input: Record<string, unknown>, key: string, path: string): string | undefined {
  return key in input ? text(input[key], `${path}.${key}`) : undefined
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) failure("INVALID_FIELD", path, "must be an array")
  return value.map((item, index) => text(item, `${path}[${index}]`))
}

function parseIdentity(value: unknown): CandidateDocumentIdentity {
  const input = object(value, "documentEvidence.identity")
  rejectUnknownFields(input, IDENTITY_FIELDS, "documentEvidence.identity")
  const fullName = optionalText(input, "fullName", "documentEvidence.identity")
  const email = optionalText(input, "email", "documentEvidence.identity")
  const phone = optionalText(input, "phone", "documentEvidence.identity")
  const location = optionalText(input, "location", "documentEvidence.identity")
  const links = "links" in input ? stringArray(input.links, "documentEvidence.identity.links") : undefined
  return {
    ...(fullName === undefined ? {} : { fullName }),
    ...(email === undefined ? {} : { email }),
    ...(phone === undefined ? {} : { phone }),
    ...(location === undefined ? {} : { location }),
    ...(links === undefined ? {} : { links }),
  }
}

function parseContext(value: unknown, path: string): CandidateEvidenceContext {
  const input = object(value, path, "INVALID_ENTRY")
  rejectUnknownFields(input, CONTEXT_FIELDS, path)
  const employer = optionalText(input, "employer", path)
  const role = optionalText(input, "role", path)
  const location = optionalText(input, "location", path)
  // Phase 4.1 treats supplied date text as evidence and preserves it verbatim.
  const startDate = optionalText(input, "startDate", path)
  const endDate = optionalText(input, "endDate", path)
  return {
    ...(employer === undefined ? {} : { employer }),
    ...(role === undefined ? {} : { role }),
    ...(location === undefined ? {} : { location }),
    ...(startDate === undefined ? {} : { startDate }),
    ...(endDate === undefined ? {} : { endDate }),
  }
}

function parseRelatedRequirements(value: unknown, path: string): CandidateEvidenceRequirement[] {
  if (!Array.isArray(value)) failure("INVALID_FIELD", path, "must be an array")
  return value.map((entry, index) => {
    const entryPath = `${path}[${index}]`
    const input = object(entry, entryPath, "INVALID_ENTRY")
    rejectUnknownFields(input, REQUIREMENT_FIELDS, entryPath)
    if (!("category" in input)) failure("INVALID_FIELD", `${entryPath}.category`, "is required")
    if (!("value" in input)) failure("INVALID_FIELD", `${entryPath}.value`, "is required")
    const category = text(input.category, `${entryPath}.category`)
    if (!REQUIREMENT_CATEGORIES.has(category as RequirementCategory)) {
      failure("UNSUPPORTED_VALUE", `${entryPath}.category`, "has an unsupported value")
    }
    return { category: category as RequirementCategory, value: text(input.value, `${entryPath}.value`) }
  })
}

function parseEvidence(value: unknown): CandidateDocumentEvidence[] {
  if (!Array.isArray(value)) failure("INVALID_FIELD", "documentEvidence.evidence", "must be an array")
  const ids = new Set<string>()
  return value.map((entry, index) => {
    const path = `documentEvidence.evidence[${index}]`
    const input = object(entry, path, "INVALID_ENTRY")
    rejectUnknownFields(input, EVIDENCE_FIELDS, path)
    if (!("id" in input)) failure("INVALID_FIELD", `${path}.id`, "is required")
    if (!("kind" in input)) failure("INVALID_FIELD", `${path}.kind`, "is required")
    if (!("content" in input)) failure("INVALID_FIELD", `${path}.content`, "is required")
    const id = text(input.id, `${path}.id`)
    if (ids.has(id)) failure("DUPLICATE_EVIDENCE_ID", `${path}.id`, "is duplicated")
    ids.add(id)
    const kind = text(input.kind, `${path}.kind`)
    if (!EVIDENCE_KINDS.has(kind as CandidateEvidenceKind)) failure("UNSUPPORTED_VALUE", `${path}.kind`, "has an unsupported value")
    const context = "context" in input ? parseContext(input.context, `${path}.context`) : undefined
    const relatedRequirements = "relatedRequirements" in input
      ? parseRelatedRequirements(input.relatedRequirements, `${path}.relatedRequirements`)
      : undefined
    return {
      id,
      kind: kind as CandidateEvidenceKind,
      content: text(input.content, `${path}.content`),
      ...(context === undefined ? {} : { context }),
      ...(relatedRequirements === undefined ? {} : { relatedRequirements }),
    }
  })
}

function parseCandidateDocumentEvidence(value: unknown): CandidateDocumentEvidenceInput {
  const input = object(value, "documentEvidence", "INVALID_ROOT")
  rejectUnknownFields(input, ROOT_FIELDS, "documentEvidence")
  const identity = "identity" in input ? parseIdentity(input.identity) : undefined
  const evidence = "evidence" in input ? parseEvidence(input.evidence) : undefined
  return {
    ...(identity === undefined ? {} : { identity }),
    ...(evidence === undefined ? {} : { evidence }),
  }
}

/** Loads explicit local document identity/evidence without profile inference or network access. */
export async function loadCandidateDocumentEvidence(path: string): Promise<CandidateDocumentEvidenceInput> {
  let contents: string
  try {
    contents = await readFile(path, "utf8")
  } catch (error) {
    throw new CandidateDocumentEvidenceInputError("READ_FAILURE", "Candidate document evidence could not be read.", undefined, error)
  }
  let input: unknown
  try {
    input = JSON.parse(contents)
  } catch (error) {
    throw new CandidateDocumentEvidenceInputError("MALFORMED_JSON", "Candidate document evidence contains malformed JSON.", undefined, error)
  }
  return parseCandidateDocumentEvidence(input)
}
