export interface ConceptDefinition {
  canonical: string
  aliases: readonly string[]
}

function surface(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/gu, " ")
}

export function canonicalConcept(value: string, concepts: readonly ConceptDefinition[]): string {
  const normalized = surface(value)
  return concepts.find((concept) => [concept.canonical, ...concept.aliases].some((alias) => surface(alias) === normalized))?.canonical ?? value.trim()
}

export function equivalentConcepts(left: string, right: string, concepts: readonly ConceptDefinition[]): boolean {
  return surface(canonicalConcept(left, concepts)) === surface(canonicalConcept(right, concepts))
}

/**
 * Whole-phrase containment, bounded to a curated concept's own alias list -
 * NOT arbitrary substring matching on free text. `value` must itself
 * canonicalize to a known concept (e.g. a candidate's "IT Support" target
 * role); `text` (e.g. a job title) matches only if it contains that exact
 * concept phrase - such as "English IT Support Technician" containing the
 * curated alias "IT Support Technician" - as a whole word/phrase.
 *
 * This deliberately does NOT extend to arbitrary candidate text: a target
 * role like "Assistant" has no curated concept definition here, so it never
 * reaches the containment check below and cannot fabricate a match against
 * an unrelated title like "Assistant Nurse" that merely contains the same
 * word. Only recognized concept phrases get this benefit of the doubt.
 */
export function conceptAliasInText(value: string, text: string, concepts: readonly ConceptDefinition[]): boolean {
  const canonical = canonicalConcept(value, concepts)
  const concept = concepts.find((definition) => definition.canonical === canonical)
  if (!concept) return false
  const normalizedText = ` ${surface(text)} `
  return [concept.canonical, ...concept.aliases].some((alias) => {
    const normalizedAlias = surface(alias)
    return normalizedAlias.length > 0 && normalizedText.includes(` ${normalizedAlias} `)
  })
}

// Deliberately broader than web/src/lib/skill-presentation.ts's aliases:
// matching favors recall (does the candidate plausibly have this skill area
// at all?), so on-prem Active Directory and cloud Microsoft Entra ID are
// folded into one canonical concept here. Presentation favors precision (do
// not claim the specific flavor of directory service the candidate did not
// list), so it keeps Entra ID and Azure AD distinct from on-prem Active
// Directory. This is an intentional split of concerns between the two
// modules, not drift - keep both comments in sync if either list changes.
export const TECHNICAL_CONCEPTS: readonly ConceptDefinition[] = [
  { canonical: "Active Directory", aliases: ["AD", "Azure AD", "Microsoft Entra ID", "Entra ID", "active-directory"] },
  { canonical: "Microsoft 365", aliases: ["M365", "Office 365", "O365"] },
  { canonical: "Azure", aliases: ["Microsoft Azure"] },
  { canonical: "AWS", aliases: ["Amazon Web Services"] },
  { canonical: "Wazuh", aliases: ["Wazuh SIEM"] },
  { canonical: "Suricata", aliases: ["Suricata IDS", "Suricata IPS"] },
] as const

export const SUPPORT_ROLE_CONCEPTS: readonly ConceptDefinition[] = [
  { canonical: "IT Support", aliases: ["IT-support", "IT Support Technician", "IT-supporttekniker", "support technician", "technical support", "helpdesk", "help desk", "service desk", "service desk technician"] },
] as const

export const SOFT_SKILL_CONCEPTS: readonly ConceptDefinition[] = [
  { canonical: "communication", aliases: ["kommunikation"] },
  { canonical: "problem solving", aliases: ["problemlösning", "problemlosning"] },
  { canonical: "collaboration", aliases: ["samarbete"] },
  { canonical: "ownership", aliases: ["ansvarstagande", "eget ansvar"] },
  { canonical: "leadership", aliases: ["ledarskap"] },
] as const

export function normalizedConceptText(value: string): string {
  return surface(value)
}

// Job-ad titles routinely append or prepend a punctuation-delimited
// annotation - seniority, location, department, employment type - to an
// otherwise plain core title: "Data Analyst (Junior)", "Systemutvecklare -
// Java", "Ekonomiassistent, Stockholm". Stripping only a *punctuation
// bounded* segment (never a bare space-separated word) is safe for any
// domain: it can never turn an unrelated compound title into a false match,
// because a title like "Assistant Nurse" has no such delimiter between
// "Assistant" and "Nurse" and is left untouched.
const TRAILING_PARENTHETICAL = /\s*\([^()]*\)\s*$/u
const LEADING_PARENTHETICAL = /^\s*\([^()]*\)\s*/u
const TRAILING_DELIMITED_CLAUSE = /\s+[-–|,]\s+\S.*$/u

function stripDelimitedAnnotations(value: string): string {
  return value.trim().replace(TRAILING_PARENTHETICAL, "").replace(LEADING_PARENTHETICAL, "").replace(TRAILING_DELIMITED_CLAUSE, "").trim()
}

// A seniority modifier describes level, not role identity, and is
// universal across every industry - not specific to any one domain. Unlike
// a role-name alias (which asserts two different words mean the same job),
// this only ever removes a level qualifier that applies equally to a Nurse,
// an Analyst, or a Systemutvecklare, so it carries no domain-specific
// assumption about what the role itself is.
const SENIORITY_MODIFIERS: readonly string[] = [
  "junior", "senior", "lead", "principal", "entry level", "entry-level", "trainee", "biträdande", "ledande",
]

function stripSeniorityModifier(value: string): string {
  const normalized = value.trim()
  for (const modifier of SENIORITY_MODIFIERS) {
    const leading = new RegExp(`^${modifier}\\b\\s+`, "iu")
    const trailing = new RegExp(`\\s+${modifier}\\b$`, "iu")
    if (leading.test(normalized)) return normalized.replace(leading, "").trim()
    if (trailing.test(normalized)) return normalized.replace(trailing, "").trim()
  }
  return normalized
}

/**
 * The "core" of a job or role title with one punctuation-delimited
 * annotation and/or one generic seniority modifier removed. Used only to
 * offer a second, still-conservative comparison alongside the existing
 * equivalentConcepts/conceptAliasInText checks - never as a replacement for
 * them, and never as bare substring matching on unpunctuated free text.
 */
export function coreRoleTitle(value: string): string {
  return stripSeniorityModifier(stripDelimitedAnnotations(value))
}