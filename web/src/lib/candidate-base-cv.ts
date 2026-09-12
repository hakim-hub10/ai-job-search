import type { CandidateProfile, Project } from "../../../.agents/job-search/cli/src/profile";

export const BASE_CV_SOURCE = "candidateProfile" as const;

export interface CandidateBaseCvVisibility {
  headline: boolean;
  summary: boolean;
  workExperience: boolean;
  education: boolean;
  technicalSkills: boolean;
  softSkills: boolean;
  certifications: boolean;
  languages: boolean;
  projects: boolean;
}

export interface CandidateBaseCv {
  candidateId: string;
  source: typeof BASE_CV_SOURCE;
  profileUpdatedAt?: string;
  headline: string;
  summary?: string;
  workExperience: CandidateProfile["workExperience"];
  education: CandidateProfile["education"];
  technicalSkills: string[];
  softSkills: string[];
  certifications: string[];
  languages: CandidateProfile["languages"];
  projects?: Project[];
  visibility: CandidateBaseCvVisibility;
  createdAt: string;
  updatedAt: string;
}

export interface CandidateBaseCvPresentationInput {
  headline: string;
  summary?: string;
  visibility: CandidateBaseCvVisibility;
  updatedAt: string;
}

export type CandidateBaseCvDomainErrorCode =
  | "INVALID_CANDIDATE_ID"
  | "INVALID_TIMESTAMP"
  | "INVALID_PRESENTATION";

export interface CandidateBaseCvDomainError {
  code: CandidateBaseCvDomainErrorCode;
  message: string;
}

export type CandidateBaseCvResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CandidateBaseCvDomainError };

function failure<T>(
  code: CandidateBaseCvDomainErrorCode,
  message: string,
): CandidateBaseCvResult<T> {
  return { ok: false, error: { code, message } };
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    && !Number.isNaN(Date.parse(value));
}

export function createCandidateBaseCvFromProfile(
  candidateId: string,
  profile: CandidateProfile,
  createdAt: string,
): CandidateBaseCvResult<CandidateBaseCv> {
  if (!hasText(candidateId)) {
    return failure("INVALID_CANDIDATE_ID", "Kandidatens ID måste anges.");
  }
  if (!isTimestamp(createdAt)) {
    return failure("INVALID_TIMESTAMP", "Grund-CV:ts tidsstämpel är ogiltig.");
  }

  return {
    ok: true,
    value: {
      candidateId: candidateId.trim(),
      source: BASE_CV_SOURCE,
      ...(profile.updatedAt ? { profileUpdatedAt: profile.updatedAt } : {}),
      headline: profile.headline,
      ...(profile.summary ? { summary: profile.summary } : {}),
      workExperience: structuredClone(profile.workExperience),
      education: structuredClone(profile.education),
      technicalSkills: [...profile.skills.technical],
      softSkills: [...profile.skills.soft],
      certifications: [...profile.certifications],
      languages: structuredClone(profile.languages),
      ...(profile.projects?.length ? { projects: structuredClone(profile.projects) } : {}),
      visibility: {
        headline: true,
        summary: Boolean(profile.summary),
        workExperience: profile.workExperience.length > 0,
        education: profile.education.length > 0,
        technicalSkills: profile.skills.technical.length > 0,
        softSkills: profile.skills.soft.length > 0,
        certifications: profile.certifications.length > 0,
        languages: profile.languages.length > 0,
        projects: (profile.projects ?? []).length > 0,
      },
      createdAt,
      updatedAt: createdAt,
    },
  };
}

export function updateCandidateBaseCvPresentation(
  baseCv: CandidateBaseCv,
  input: CandidateBaseCvPresentationInput,
): CandidateBaseCvResult<CandidateBaseCv> {
  if (!hasText(input.headline)) {
    return failure("INVALID_PRESENTATION", "Yrkesrubriken måste anges.");
  }
  if (!isTimestamp(input.updatedAt)) {
    return failure("INVALID_TIMESTAMP", "Grund-CV:ts tidsstämpel är ogiltig.");
  }

  return {
    ok: true,
    value: {
      ...structuredClone(baseCv),
      headline: input.headline.trim(),
      ...(input.summary?.trim()
        ? { summary: input.summary.trim() }
        : { summary: undefined }),
      visibility: structuredClone(input.visibility),
      updatedAt: input.updatedAt,
    },
  };
}

/** Replace profile-owned evidence, preserving deliberate CV presentation edits. */
export function synchronizeCandidateBaseCv(
  candidateId: string,
  profile: CandidateProfile,
  previousProfile: CandidateProfile | null,
  existing: CandidateBaseCv | null,
  now: string,
): CandidateBaseCvResult<CandidateBaseCv> {
  if (existing && existing.candidateId !== candidateId) return failure("INVALID_CANDIDATE_ID", "Grund-CV:t tillhör inte kandidaten.");
  const created = createCandidateBaseCvFromProfile(candidateId, profile, now);
  if (!created.ok || !existing) return created;
  const next = created.value;
  next.createdAt = existing.createdAt;
  if (previousProfile && existing.headline !== previousProfile.headline && existing.headline !== "Job seeker") next.headline = existing.headline;
  if (previousProfile && (existing.summary ?? "") !== (previousProfile.summary ?? "")) next.summary = existing.summary;
  // Defensive fallback for a Base CV record saved before a field existed
  // (e.g. projects): treated as an empty/hidden section, never fabricated.
  const existingProjectsVisible = "projects" in existing.visibility ? existing.visibility.projects : false;
  next.visibility = { ...existing.visibility, projects: existingProjectsVisible };
  // Newly populated sections from a minimal baseline should be visible. An
  // existing populated section's explicit hidden setting remains unchanged.
  for (const key of ["workExperience", "education", "technicalSkills", "softSkills", "certifications", "languages", "projects"] as const) {
    if ((existing[key] ?? []).length === 0 && (next[key] ?? []).length > 0) next.visibility[key] = true;
  }
  if (!existing.summary && next.summary) next.visibility.summary = true;
  return { ok: true, value: next };
}
