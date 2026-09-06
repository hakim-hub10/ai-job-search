import { resolve } from "node:path";

import { createFileCandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-file-repository";
import { resolveCoachRepositoryPaths } from "../../../.agents/job-search/cli/src/coach-cli-paths";
import { createFileCoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-file-repository";
import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import type { CoachCandidate } from "../../../.agents/job-search/cli/src/coach-workspace";
import type { CoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-repository";
import type { CandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-repository";
import {
  createCandidateBaseCvFromProfile,
  updateCandidateBaseCvPresentation,
  type CandidateBaseCv,
  type CandidateBaseCvPresentationInput,
} from "./candidate-base-cv";
import { createFileCandidateBaseCvRepository } from "./candidate-base-cv-file-repository";
import type {
  CandidateBaseCvRepository,
  CandidateBaseCvRepositoryError,
} from "./candidate-base-cv-repository";

export type CandidateBaseCvStateFailureCode =
  | "CONFIGURATION_MISSING"
  | "INVALID_CANDIDATE_ID"
  | "CANDIDATE_NOT_FOUND"
  | "CANDIDATE_STORAGE_FAILURE"
  | "PROFILE_NOT_FOUND"
  | "PROFILE_STORAGE_FAILURE"
  | "BASE_CV_STORAGE_FAILURE"
  | "BASE_CV_NOT_FOUND"
  | "BASE_CV_INVALID_INPUT";

export interface CandidateBaseCvStateFailure {
  ok: false;
  code: CandidateBaseCvStateFailureCode;
  message: string;
}

export interface CandidateBaseCvStateSuccess {
  ok: true;
  candidate: CoachCandidate;
  profile: CandidateProfile;
  baseCv: CandidateBaseCv | null;
}

export type CandidateBaseCvStateResult =
  | CandidateBaseCvStateSuccess
  | CandidateBaseCvStateFailure;

export interface CandidateBaseCvStateDependencies {
  candidateRepository: CoachWorkspaceRepository;
  profileRepository: CandidateProfileRepository;
  baseCvRepository: CandidateBaseCvRepository;
}

function failure(
  code: CandidateBaseCvStateFailureCode,
  message: string,
): CandidateBaseCvStateFailure {
  return { ok: false, code, message };
}

export async function readCandidateBaseCvState(
  candidateId: string,
  dependencies: CandidateBaseCvStateDependencies,
): Promise<CandidateBaseCvStateResult> {
  const normalizedId = candidateId.trim();
  if (!normalizedId) return failure("INVALID_CANDIDATE_ID", "Kandidatens ID saknas.");

  const candidate = await dependencies.candidateRepository.getCandidateById(normalizedId);
  if (!candidate.ok) {
    return candidate.error.code === "NOT_FOUND"
      ? failure("CANDIDATE_NOT_FOUND", "Kandidaten hittades inte.")
      : failure("CANDIDATE_STORAGE_FAILURE", "Kandidatregistret kunde inte läsas.");
  }

  const profile = await dependencies.profileRepository.getProfileByCandidateId(normalizedId);
  if (!profile.ok) {
    return profile.error.code === "NOT_FOUND"
      ? failure("PROFILE_NOT_FOUND", "Kandidatprofil saknas.")
      : failure("PROFILE_STORAGE_FAILURE", "Kandidatprofilen kunde inte läsas.");
  }

  const baseCv = await dependencies.baseCvRepository.getByCandidateId(normalizedId);
  if (!baseCv.ok && baseCv.error.code !== "NOT_FOUND") {
    return failure("BASE_CV_STORAGE_FAILURE", "Grund-CV-lagringen kunde inte läsas.");
  }

  return {
    ok: true,
    candidate: candidate.value,
    profile: profile.value.profile,
    baseCv: baseCv.ok ? baseCv.value : null,
  };
}

function configuredDependencies(): CandidateBaseCvStateDependencies | null {
  const coachDir = process.env.COACH_DIR?.trim();
  if (!coachDir) return null;
  const paths = resolveCoachRepositoryPaths(resolve(coachDir));
  return {
    candidateRepository: createFileCoachWorkspaceRepository(paths.candidates),
    profileRepository: createFileCandidateProfileRepository(paths.candidateProfiles),
    baseCvRepository: createFileCandidateBaseCvRepository(resolve(coachDir, "candidate-cvs.json")),
  };
}

export async function loadCandidateBaseCvState(candidateId: string): Promise<CandidateBaseCvStateResult> {
  const dependencies = configuredDependencies();
  return dependencies
    ? readCandidateBaseCvState(candidateId, dependencies)
    : failure("CONFIGURATION_MISSING", "Jobbcoachens arbetsyta är inte konfigurerad.");
}

export async function initializeCandidateBaseCv(
  candidateId: string,
  now = new Date().toISOString(),
): Promise<CandidateBaseCvStateResult> {
  const dependencies = configuredDependencies();
  if (!dependencies) return failure("CONFIGURATION_MISSING", "Jobbcoachens arbetsyta är inte konfigurerad.");

  const state = await readCandidateBaseCvState(candidateId, dependencies);
  if (!state.ok) return state;

  if (state.baseCv) return state;

  const created = createCandidateBaseCvFromProfile(state.candidate.id, state.profile, now);
  if (!created.ok) return failure("BASE_CV_INVALID_INPUT", "Grund-CV:t kunde inte skapas.");
  const saved = await dependencies.baseCvRepository.save(created.value);
  if (!saved.ok) return failure("BASE_CV_STORAGE_FAILURE", "Grund-CV:t kunde inte sparas.");

  return { ...state, baseCv: saved.value };
}

export async function updateCandidateBaseCv(
  candidateId: string,
  input: CandidateBaseCvPresentationInput,
): Promise<CandidateBaseCvStateResult> {
  const dependencies = configuredDependencies();
  if (!dependencies) return failure("CONFIGURATION_MISSING", "Jobbcoachens arbetsyta är inte konfigurerad.");

  const state = await readCandidateBaseCvState(candidateId, dependencies);
  if (!state.ok) return state;
  if (!state.baseCv) return failure("BASE_CV_NOT_FOUND", "Grund-CV:t är inte skapat ännu.");

  const updated = updateCandidateBaseCvPresentation(state.baseCv, input);
  if (!updated.ok) return failure("BASE_CV_INVALID_INPUT", "Grund-CV:ts presentation är ogiltig.");
  const saved = await dependencies.baseCvRepository.save(updated.value);
  if (!saved.ok) return failure("BASE_CV_STORAGE_FAILURE", "Grund-CV:t kunde inte sparas.");

  return { ...state, baseCv: saved.value };
}

export function documentRepositoryErrorMessage(
  error: CandidateBaseCvRepositoryError,
): string {
  return error.code === "NOT_FOUND"
    ? "Grund-CV:t är inte skapat ännu."
    : "Grund-CV-lagringen kunde inte läsas.";
}
