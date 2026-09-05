import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileCandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-file-repository";
import { resolveCoachRepositoryPaths } from "../../../.agents/job-search/cli/src/coach-cli-paths";
import { parseCandidateProfile } from "../../../.agents/job-search/cli/src/profile-input";
import {
  loadCandidateProfile,
  loadCandidateProfileRepository,
} from "./candidate-profiles";

const originalCoachDir = process.env.COACH_DIR;
const temporaryDirectories: string[] = [];

async function temporaryCoachDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "candidate-profiles-web-"));
  temporaryDirectories.push(directory);
  return directory;
}

function profile() {
  return parseCandidateProfile({
    headline: "IT support technician",
    targetRoles: ["IT Support"],
    locationPreferences: ["Jönköping"],
    workMode: "open",
    remotePreference: true,
    preferredIndustries: ["IT"],
    preferredEmploymentType: ["full-time"],
    skills: {
      technical: ["Microsoft 365"],
      soft: ["Communication"],
    },
    workExperience: [],
    education: [],
    certifications: [],
    languages: [
      { name: "Swedish", level: "Professional" },
      { name: "English", level: "Professional" },
    ],
    yearsOfExperience: 1,
    careerGoals: ["Work in IT support"],
  });
}

afterEach(async () => {
  if (originalCoachDir === undefined) {
    delete process.env.COACH_DIR;
  } else {
    process.env.COACH_DIR = originalCoachDir;
  }

  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("candidate profiles web data layer", () => {
  it("reports unconfigured storage when COACH_DIR is absent", async () => {
    delete process.env.COACH_DIR;

    const repositoryContext = loadCandidateProfileRepository();
    const result = await loadCandidateProfile("candidate-a");

    expect(repositoryContext.configured).toBe(false);
    expect(repositoryContext.repository).toBeNull();
    expect(result).toEqual({
      configured: false,
      profile: null,
      error: null,
    });
  });

  it("treats a missing stored profile as an explicit empty state", async () => {
    process.env.COACH_DIR = await temporaryCoachDirectory();

    const result = await loadCandidateProfile("candidate-a");

    expect(result).toEqual({
      configured: true,
      profile: null,
      error: null,
    });
  });

  it("loads an explicitly stored profile without defaults", async () => {
    const coachDir = await temporaryCoachDirectory();
    process.env.COACH_DIR = coachDir;

    const paths = resolveCoachRepositoryPaths(coachDir);
    const repository = createFileCandidateProfileRepository(
      paths.candidateProfiles,
    );

    const expected = profile();
    const saved = await repository.saveProfile("candidate-a", expected);

    expect(saved.ok).toBe(true);

    const result = await loadCandidateProfile("candidate-a");

    expect(result.configured).toBe(true);
    expect(result.error).toBeNull();
    expect(result.profile).toEqual(expected);
  });

  it("fails closed when candidate profile storage is corrupt", async () => {
    const coachDir = await temporaryCoachDirectory();
    process.env.COACH_DIR = coachDir;

    const paths = resolveCoachRepositoryPaths(coachDir);
    await Bun.write(paths.candidateProfiles, "{not-json");

    const result = await loadCandidateProfile("candidate-a");

    expect(result.configured).toBe(true);
    expect(result.profile).toBeNull();
    expect(result.error?.code).toBe("CORRUPT_STORAGE");
  });
});
