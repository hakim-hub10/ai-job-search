import { explicitRequirementSegments } from "./requirement-context"
import type { NormalizedJob } from "./types"

export interface TechnicalRequirementTerm {
  canonical: string
  aliases?: readonly string[]
}

export interface JobRequirementExtraction {
  job: NormalizedJob
  extractedSkills: string[]
}

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
  { canonical: "Microsoft Entra ID", aliases: ["Entra ID", "Azure AD"] },
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

export function extractTechnicalRequirements(
  job: Readonly<NormalizedJob>,
  terms: readonly TechnicalRequirementTerm[] = DEFAULT_TECHNICAL_REQUIREMENT_TERMS,
): JobRequirementExtraction {
  const existing = [...job.skills]
  const extractedSkills: string[] = []

  if (job.description) {
    for (const term of terms) {
      const aliases = [term.canonical, ...(term.aliases ?? [])]
      const segments = explicitRequirementSegments(job.description, aliases)
      if (!segments.some(({ segment }) => aliases.some((alias) => containsIndependentTerm(segment, alias, terms)))) continue
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
  }
}
