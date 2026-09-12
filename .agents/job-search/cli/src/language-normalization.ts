import type { NormalizedJob } from "./types"

export interface LanguageRequirement {
  canonical: string
  aliases: readonly string[]
}

export const LANGUAGE_REQUIREMENTS: readonly LanguageRequirement[] = [
  { canonical: "English", aliases: ["english", "engelska"] },
  { canonical: "Swedish", aliases: ["swedish", "svenska"] },
  { canonical: "German", aliases: ["german", "deutsch", "tyska"] },
  { canonical: "French", aliases: ["french", "français", "francais", "franska"] },
  { canonical: "Spanish", aliases: ["spanish", "español", "espanol", "spanska"] },
] as const

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("en")
}

export function candidateHasLanguage(candidateLanguageNames: readonly string[], requirement: LanguageRequirement): boolean {
  return candidateLanguageNames.some((name) => requirement.aliases.includes(normalized(name)))
}

export function jobRequiresLanguage(text: string, requirement: LanguageRequirement): boolean {
  const normalizedText = normalized(text)
  return requirement.aliases.some((alias) => normalizedText.includes(alias))
}

/**
 * The single text a job's language requirement is read from. Deliberately
 * description-only: a job title is short and often incidental (e.g. a
 * Swedish-market posting titled in English), so title text is a weak signal
 * that must not, by itself, promote or fabricate a language requirement or a
 * language gap. Every caller that decides whether a job requires a language
 * must read from this function so matching and skill-gap analysis cannot
 * silently diverge on what counts as evidence.
 */
export function jobLanguageEvidenceText(job: Pick<NormalizedJob, "description">): string {
  return job.description ?? ""
}