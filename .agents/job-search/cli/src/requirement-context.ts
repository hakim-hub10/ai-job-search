import type { RequirementImportance } from "./requirements"

const REQUIRED_MARKERS = [
  /\brequir(?:e|es|ed|ement|ements)\b/i,
  /\bmust\b/i,
  /\b(?:mandatory|essential|critical|non-negotiable)\b/i,
  /\bneed(?:ed|s)?\b/i,
  /\bwe expect\b/i,
  /\bwe seek\b/i,
  /\bwe are looking for\b/i,
  /\byou (?:have|bring|possess)\b/i,
  /\bexperience (?:with|in|of)\b/i,
  /\bknowledge of\b/i,
  /\bproficien(?:t|cy) (?:with|in)\b/i,
  /\bfamiliarity with\b/i,
  /\bqualification(?:s)?\b/i,
  /\bkrav\b/i,
  /\bmåste\b/i,
  /\b(?:obligatorisk|avgörande|nödvändig)\b/i,
  /\bska ha\b/i,
  /\bvi söker (?:dig )?som\b/i,
  /\bdu har\b/i,
  /\berfarenhet av\b/i,
  /\bkunskap(?:er)? (?:om|inom|av)\b/i,
  /\bkvalifikation(?:er)?\b/i,
]

const PREFERRED_MARKERS = [
  /\bpreferred\b/i,
  /\bnice to have\b/i,
  /\badvantage(?:ous)?\b/i,
  /\bmerit(?:ing|orious)?\b/i,
  /\bmeriterande\b/i,
  /\bfördel\b/i,
]

const NEGATED_MARKERS = [
  /\bnot required\b/i,
  /\bno requirement\b/i,
  /\bnot necessary\b/i,
  /\binget krav\b/i,
  /\bkrävs inte\b/i,
]

export function descriptionSegments(description: string): string[] {
  return description
    .replace(/<\/?(?:p|li|ul|ol|div|h[1-6])\b[^>]*>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+(?=(?:due to|because of|på grund av)\b)/gi, "\n")
    .split(/(?:[.!?;]|\r?\n)+/)
    .map((segment) => segment.replace(/\s+/g, " ").trim())
    .filter(Boolean)
}

export function requirementImportanceForSegment(segment: string): RequirementImportance {
  if (NEGATED_MARKERS.some((marker) => marker.test(segment))) return "optional"
  if (PREFERRED_MARKERS.some((marker) => marker.test(segment))) return "preferred"
  if (REQUIRED_MARKERS.some((marker) => marker.test(segment))) return "required"
  return "unspecified"
}

export function explicitRequirementSegments(description: string, keywords: readonly string[]): Array<{ segment: string; importance: RequirementImportance }> {
  return classifiedRequirementSegments(description, keywords)
    .filter(({ importance }) => importance === "required")
}

export function classifiedRequirementSegments(
  description: string,
  keywords: readonly string[],
): Array<{ segment: string; importance: Extract<RequirementImportance, "required" | "preferred"> }> {
  const normalizedKeywords = keywords.map((keyword) => keyword.toLocaleLowerCase("en"))
  return descriptionSegments(description)
    .filter((segment) => normalizedKeywords.some((keyword) => segment.toLocaleLowerCase("en").includes(keyword)))
    .map((segment) => ({ segment, importance: requirementImportanceForSegment(segment) }))
    .filter((entry): entry is { segment: string; importance: "required" | "preferred" } =>
      entry.importance === "required" || entry.importance === "preferred",
    )
}
