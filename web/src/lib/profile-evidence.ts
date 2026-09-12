import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import { parseCandidateProfile } from "../../../.agents/job-search/cli/src/profile-input";

/** Validates user-entered structured evidence using the canonical profile model. */
export function parseProfileEvidence(value: string, profile: CandidateProfile): CandidateProfile {
  const input: unknown = JSON.parse(value);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Ogiltiga profiluppgifter.");
  const fields = input as Record<string, unknown>;
  if (Object.keys(fields).some(key => !["headline", "summary", "workExperience", "education", "projects"].includes(key))) throw new Error("Ogiltiga profilfält.");
  const parsed = parseCandidateProfile({ ...profile, ...fields });
  if (parsed.headline.trim().toLowerCase() === "job seeker") throw new Error("Ange din yrkesrubrik.");
  return parsed;
}

export function profileCompletionIssues(profile: Pick<CandidateProfile, "headline" | "workExperience" | "education">): string[] {
  const missing: string[] = [];
  if (!profile.headline.trim() || profile.headline.trim().toLowerCase() === "job seeker") missing.push("yrkesrubrik");
  if (profile.workExperience.length === 0) missing.push("arbetslivserfarenhet");
  if (profile.education.length === 0) missing.push("utbildning");
  return missing;
}
