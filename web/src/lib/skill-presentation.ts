import { canonicalConcept, type ConceptDefinition, normalizedConceptText } from "../../../.agents/job-search/cli/src/concept-normalization";
import { classifySkill } from "./profile-quality";
// Presentation vocabulary is deliberately separate from matching's TECHNICAL_CONCEPTS
// (.agents/job-search/cli/src/concept-normalization.ts): matching favors recall and folds
// on-prem Active Directory and cloud Microsoft Entra ID into one concept, but a generated
// document must not claim the specific flavor of directory service the candidate did not
// list, so presentation keeps them distinct. This is an intentional split, not drift -
// keep both comments in sync if either list changes.
const aliases: readonly ConceptDefinition[] = [
  { canonical: "Active Directory", aliases: ["AD", "active-directory"] },
  { canonical: "Microsoft Entra ID", aliases: ["Azure AD", "Entra ID", "Azure AD / Entra ID"] },
  { canonical: "Microsoft 365", aliases: ["M365", "Office 365", "O365"] },
];
export interface SkillPresentationGroup { id: string; label: string; concepts: readonly string[] }
export function skillConcept(value: string): string { return canonicalConcept(value, aliases); }
export function presentSkills(values: readonly string[], groups: readonly SkillPresentationGroup[] = [], limit = 12) {
  const seen = new Set<string>();
  const selected = values.flatMap(value => {
    if (!["VALID_SKILL", "SOFT_SKILL"].includes(classifySkill(value).classification)) return [];
    const label = skillConcept(value); const key = normalizedConceptText(label);
    if (seen.has(key)) return []; seen.add(key); return [label];
  }).slice(0, limit);
  return selected.map(label => ({ label, group: groups.find(g => g.concepts.some(c => normalizedConceptText(skillConcept(c)) === normalizedConceptText(label)))?.id ?? "other" }));
}
