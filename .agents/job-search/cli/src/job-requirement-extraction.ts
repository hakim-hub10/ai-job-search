import { classifiedRequirementSegments } from "./requirement-context"
import type { RequirementImportance } from "./requirements"
import type { NormalizedJob } from "./types"
import { TECHNICAL_CONCEPTS, canonicalConcept } from "./concept-normalization"

export interface TechnicalRequirementTerm {
  canonical: string
  aliases?: readonly string[]
}

export interface JobRequirementExtraction {
  job: NormalizedJob
  extractedSkills: string[]
  requirements: ExtractedTechnicalRequirement[]
}

export interface ExtractedTechnicalRequirement {
  canonical: string
  matchedAlias: string
  importance: Extract<RequirementImportance, "required" | "preferred">
  evidence: string
  jobId: string
  source: string
}

export const MAX_REQUIREMENT_EVIDENCE_LENGTH = 240

/**
 * Deliberately bounded vocabulary for deterministic MVP extraction. Terms are
 * recognized only inside explicit requirement context; arbitrary noun phrases
 * are never promoted to candidate gaps.
 */
export const DEFAULT_TECHNICAL_REQUIREMENT_TERMS: readonly TechnicalRequirementTerm[] = [
  { canonical: "Active Directory" },
  { canonical: "AWS", aliases: ["Amazon Web Services"] },
  { canonical: "Azure" },
  { canonical: "Bash" },
  { canonical: "Citrix" },
  { canonical: "DHCP" },
  { canonical: "DNS" },
  { canonical: "Docker" },
  { canonical: "Excel", aliases: ["Microsoft Excel"] },
  { canonical: "GCP", aliases: ["Google Cloud Platform"] },
  { canonical: "Intune", aliases: ["Microsoft Intune", "Endpoint Manager"] },
  { canonical: "ITIL" },
  { canonical: "Jira" },
  { canonical: "Kubernetes" },
  { canonical: "Linux" },
  { canonical: "macOS", aliases: ["Mac OS"] },
  { canonical: "Microsoft 365", aliases: ["Office 365", "M365", "O365"] },
  { canonical: "Active Directory", aliases: ["AD", "Azure AD", "Microsoft Entra ID", "Entra ID", "active-directory"] },
  { canonical: "Networking", aliases: ["network troubleshooting", "network administration"] },
  { canonical: "Power BI", aliases: ["PowerBI"] },
  { canonical: "PowerShell" },
  { canonical: "Python" },
  { canonical: "Salesforce" },
  { canonical: "SAP" },
  { canonical: "SCCM", aliases: ["Configuration Manager"] },
  { canonical: "ServiceNow" },
  { canonical: "SQL" },
  { canonical: "TCP/IP" },
  { canonical: "Terraform" },
  { canonical: "TypeScript" },
  { canonical: "VPN" },
  { canonical: "VMware" },
  { canonical: "Windows" },
] as const

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function containsTerm(text: string, term: string): boolean {
  const escaped = escapeRegex(term)
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, "iu").test(text)
}

function containsIndependentTerm(
  segment: string,
  alias: string,
  terms: readonly TechnicalRequirementTerm[],
): boolean {
  let remaining = segment
  for (const term of terms) {
    for (const longerAlias of [term.canonical, ...(term.aliases ?? [])]) {
      if (longerAlias.length <= alias.length || !containsTerm(longerAlias, alias)) continue
      remaining = remaining.replace(new RegExp(escapeRegex(longerAlias), "giu"), " ")
    }
  }
  return containsTerm(remaining, alias)
}

function boundedEvidence(segment: string, matchedAlias: string): string {
  const safe = segment.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
  if (safe.length <= MAX_REQUIREMENT_EVIDENCE_LENGTH) return safe
  const aliasIndex = safe.toLocaleLowerCase("en").indexOf(matchedAlias.toLocaleLowerCase("en"))
  const bodyLength = MAX_REQUIREMENT_EVIDENCE_LENGTH - 2
  let start = Math.max(0, aliasIndex - 100)
  let end = Math.min(safe.length, start + bodyLength)
  if (end === safe.length) start = Math.max(0, end - bodyLength)
  const body = safe.slice(start, end).trim()
  return `${start > 0 ? "…" : ""}${body}${end < safe.length ? "…" : ""}`
}

function importanceWeight(importance: ExtractedTechnicalRequirement["importance"]): number {
  return importance === "required" ? 2 : 1
}

export function extractTechnicalRequirements(
  job: Readonly<NormalizedJob>,
  terms: readonly TechnicalRequirementTerm[] = DEFAULT_TECHNICAL_REQUIREMENT_TERMS,
): JobRequirementExtraction {
  const existing = [...new Map(job.skills.map((skill) => {
    const canonical = canonicalConcept(skill, TECHNICAL_CONCEPTS)
    return [canonical.normalize("NFKC").toLocaleLowerCase("en"), canonical]
  })).values()]
  const extractedSkills: string[] = []
  const requirements: ExtractedTechnicalRequirement[] = []

  if (job.description) {
    for (const term of terms) {
      const aliases = [term.canonical, ...(term.aliases ?? [])]
      const candidates = classifiedRequirementSegments(job.description, aliases).flatMap(({ segment, importance }) => {
        const matchedAlias = aliases.find((alias) => containsIndependentTerm(segment, alias, terms))
        return matchedAlias ? [{ segment, importance, matchedAlias }] : []
      })
      const strongest = candidates.sort((left, right) =>
        importanceWeight(right.importance) - importanceWeight(left.importance),
      )[0]
      if (!strongest) continue
      requirements.push({
        canonical: term.canonical,
        matchedAlias: strongest.matchedAlias,
        importance: strongest.importance,
        evidence: boundedEvidence(strongest.segment, strongest.matchedAlias),
        jobId: job.id,
        source: job.source,
      })
      const alreadyKnown = [...existing, ...extractedSkills].some((skill) =>
        aliases.some((alias) => skill.localeCompare(alias, "en", { sensitivity: "accent" }) === 0),
      )
      if (alreadyKnown) continue
      extractedSkills.push(term.canonical)
    }
  }

  return {
    job: { ...job, skills: [...existing, ...extractedSkills] },
    extractedSkills,
    requirements,
  }
}
