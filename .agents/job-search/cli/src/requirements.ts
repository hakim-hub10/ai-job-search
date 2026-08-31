import type { GapType } from "./skillgaps"

export type RequirementCategory = "skill" | "certification" | "language" | "experience" | "education" | "other"
export type RequirementImportance = "required" | "preferred" | "optional" | "useful" | "unspecified"

export interface RequirementIdentity {
  key: string
  original: string
  normalized: string
  category: RequirementCategory
}

export interface RequirementDescriptor {
  identity: RequirementIdentity
  importance: RequirementImportance
}

/** Conservative, mechanical normalization only; semantic variants stay distinct. */
export function normalizeRequirementText(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase()
}

export function createRequirementIdentity(category: RequirementCategory, original: string): RequirementIdentity {
  const normalized = normalizeRequirementText(original)
  return { key: `${category}:${normalized}`, original, normalized, category }
}

export function createRequirementDescriptor(
  category: RequirementCategory,
  original: string,
  importance: RequirementImportance = "unspecified",
): RequirementDescriptor {
  return { identity: createRequirementIdentity(category, original), importance }
}

export function requirementCategoryForGapType(type: GapType): RequirementCategory {
  if (type === "missing_skill" || type === "insufficient_skill") return "skill"
  if (type === "missing_certification") return "certification"
  if (type === "missing_language") return "language"
  if (type === "experience_gap") return "experience"
  if (type === "education_gap") return "education"
  return "other"
}

/** Parses only existing explicit prefixes; unmarked text remains unspecified. */
export function parseLegacyRequirement(requirement: string): { original: string; importance: RequirementImportance } {
  const trimmed = requirement.trim().replace(/\s+/g, " ")
  const match = /^(?:job )?(required|requires|preferred|optional|useful)\s*:\s*(.+)$/i.exec(trimmed)
  if (!match) return { original: trimmed, importance: "unspecified" }

  const marker = match[1].toLowerCase()
  const importance: RequirementImportance = marker === "requires"
    ? "required"
    : marker as RequirementImportance
  return { original: match[2].trim(), importance }
}
