import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import type { MatchDimension, MatchEvidence } from "../../../.agents/job-search/cli/src/matching";
import type { ApplicationRecord } from "../../../.agents/job-search/cli/src/applications";
import {
  conflictingGapItems,
  formatDimension,
  missingGapItems,
  unknownEvidenceCase,
  unknownEvidenceLabel,
  type MatchGapItem,
} from "./match-confidence";

/**
 * Maps each match dimension to the exact profile-editor field it is backed
 * by - purely structural (field identity, not field content), so it never
 * encodes anything about any particular industry or role.
 */
export const DIMENSION_FIELD_IDS: Record<MatchDimension, string> = {
  targetRole: "field-targetRoles",
  technicalSkills: "field-technicalSkills",
  softSkills: "field-softSkills",
  location: "field-locationPreferences",
  remotePreference: "field-workMode",
  employmentType: "field-preferredEmploymentType",
  yearsOfExperience: "field-yearsOfExperience",
  certifications: "field-certifications",
  languages: "field-languages",
  preferredIndustries: "field-preferredIndustries",
};

/** The candidate's own current value for a dimension, read structurally off the profile - never inferred or invented. */
export function currentProfileValueForDimension(dimension: MatchDimension, profile: CandidateProfile): string {
  switch (dimension) {
    case "targetRole":
      return profile.targetRoles.join(", ") || "Inga angivna målroller";
    case "technicalSkills":
      return profile.skills.technical.join(", ") || "Inga angivna tekniska kompetenser";
    case "softSkills":
      return profile.skills.soft.join(", ") || "Inga angivna mjuka kompetenser";
    case "location":
      return profile.locationPreferences.join(", ") || "Inga angivna orter";
    case "remotePreference":
      return `${profile.workMode}${profile.remotePreference ? " (öppen för distansarbete)" : ""}`;
    case "employmentType":
      return profile.preferredEmploymentType.join(", ") || "Ingen angiven anställningsform";
    case "yearsOfExperience":
      return `${profile.yearsOfExperience} år`;
    case "certifications":
      return profile.certifications.join(", ") || "Inga angivna certifieringar";
    case "languages":
      return profile.languages.map((language) => `${language.name} (${language.level})`).join(", ") || "Inga angivna språk";
    case "preferredIndustries":
      return profile.preferredIndustries.join(", ") || "Inga angivna branscher";
  }
}

export interface ProfileGapItem extends MatchGapItem {
  dimension: MatchDimension;
  fieldId: string;
  currentValue: string;
}

export interface TargetRoleExplanation {
  jobRole: string;
  candidateTargetRoles: string[];
  explanation: string;
  fieldId: string;
}

export interface ProfileGapContext {
  jobTitle: string;
  verifiedGaps: ProfileGapItem[];
  candidateUncertain: ProfileGapItem[];
  conflicting: ProfileGapItem[];
  targetRoleExplanation: TargetRoleExplanation | null;
}

function toProfileGapItems(evidenceList: MatchEvidence[], profile: CandidateProfile, build: (evidence: MatchEvidence) => MatchGapItem[]): ProfileGapItem[] {
  return evidenceList.flatMap((evidence) =>
    build(evidence).map((item) => ({
      ...item,
      dimension: evidence.dimension,
      fieldId: DIMENSION_FIELD_IDS[evidence.dimension],
      currentValue: currentProfileValueForDimension(evidence.dimension, profile),
    })),
  );
}

/**
 * Builds the full "why am I here" panel content for the profile editor,
 * reusing the application's own frozen analysisSnapshot (never re-running or
 * altering matching/scoring) plus the candidate's current profile for the
 * "current relevant profile value" column. Job-side-unknown information is
 * deliberately excluded from every list here - it is never a candidate
 * deficiency and must never appear as something to "resolve".
 */
export function buildProfileGapContext(application: Pick<ApplicationRecord, "jobSnapshot" | "analysisSnapshot">, profile: CandidateProfile): ProfileGapContext {
  const { matchingResult } = application.analysisSnapshot;
  const job = application.jobSnapshot;

  const verifiedGaps = toProfileGapItems(matchingResult.missing, profile, missingGapItems);
  const conflicting = toProfileGapItems(matchingResult.conflicting, profile, conflictingGapItems);
  const candidateUncertainEvidence = matchingResult.unknown.filter((evidence) => unknownEvidenceCase(evidence, job) === "candidateUncertain");
  const candidateUncertain = toProfileGapItems(candidateUncertainEvidence, profile, (evidence) => [
    { title: formatDimension(evidence.dimension), description: unknownEvidenceLabel(evidence, job) },
  ]);

  const targetRoleEvidence = matchingResult.missing.find((evidence) => evidence.dimension === "targetRole");
  const targetRoleExplanation: TargetRoleExplanation | null = targetRoleEvidence
    ? {
        jobRole: job.title,
        candidateTargetRoles: profile.targetRoles,
        explanation: targetRoleEvidence.detail,
        fieldId: DIMENSION_FIELD_IDS.targetRole,
      }
    : null;

  return {
    jobTitle: job.title,
    verifiedGaps,
    candidateUncertain,
    conflicting,
    targetRoleExplanation,
  };
}
