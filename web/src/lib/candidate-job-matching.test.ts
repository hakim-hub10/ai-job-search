import { describe, expect, it } from "bun:test";

import type {
  CandidateProfileRepository,
  CandidateProfileRepositoryResult,
} from "../../../.agents/job-search/cli/src/candidate-profile-repository";
import { parseCandidateProfile } from "../../../.agents/job-search/cli/src/profile-input";
import type { NormalizedJob } from "../../../.agents/job-search/cli/src/types";
import { analyzeJobsForCandidate } from "./candidate-job-matching";

const profile = parseCandidateProfile({
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

const job: NormalizedJob = {
  id: "job-1",
  title: "IT Support Technician",
  company: "Example",
  location: "Jönköping",
  country: "Sweden",
  url: "https://example.test/job-1",
  applyUrl: null,
  source: "fixture",
  sourceId: "job-1",
  date: null,
  employmentType: "full-time",
  remote: null,
  description: "Support Microsoft 365 users.",
  salary: null,
  skills: ["Microsoft 365"],
  seniority: null,
  category: null,
};

function repository(
  getResult: CandidateProfileRepositoryResult<{
    candidateId: string;
    profile: typeof profile;
  }>,
): CandidateProfileRepository {
  return {
    async saveProfile() {
      throw new Error("saveProfile must not be called");
    },

    async getProfileByCandidateId() {
      return structuredClone(getResult);
    },

    async listProfiles() {
      throw new Error("listProfiles must not be called");
    },
  };
}

describe("candidate-aware jobs matching data layer", () => {
  it("uses the stored candidate profile with the existing analysis engine", async () => {
    let receivedProfile: unknown;
    let receivedJobs: unknown;

    const result = await analyzeJobsForCandidate(
      {
        candidateId: "candidate-a",
        jobs: [job],
      },
      {
        profileRepository: repository({
          ok: true,
          value: {
            candidateId: "candidate-a",
            profile,
          },
        }),
        analyze: (candidate, jobs) => {
          receivedProfile = candidate;
          receivedJobs = jobs;

          return {
            inputJobCount: jobs.length,
            rankedJobs: [],
            learningPlan: {
              items: [],
              totalItems: 0,
            },
          } as never;
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(receivedProfile).toEqual(profile);
    expect(receivedJobs).toEqual([job]);
  });

  it("runs the real deterministic analysis pipeline", async () => {
    const result = await analyzeJobsForCandidate(
      {
        candidateId: "candidate-a",
        jobs: [job],
      },
      {
        profileRepository: repository({
          ok: true,
          value: {
            candidateId: "candidate-a",
            profile,
          },
        }),
      },
    );

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.analysis.inputJobCount).toBe(1);
    expect(result.analysis.rankedJobs).toHaveLength(1);
    expect(result.analysis.rankedJobs[0]?.job.id).toBe("job-1");
    expect(result.analysis.rankedJobs[0]?.score).toBeGreaterThanOrEqual(0);
    expect(result.analysis.rankedJobs[0]?.score).toBeLessThanOrEqual(100);
  });

  it("returns PROFILE_NOT_FOUND instead of creating a default profile", async () => {
    let analysisCalled = false;

    const result = await analyzeJobsForCandidate(
      {
        candidateId: "candidate-missing",
        jobs: [job],
      },
      {
        profileRepository: repository({
          ok: false,
          error: {
            code: "NOT_FOUND",
            message: "not found",
          },
        }),
        analyze: () => {
          analysisCalled = true;
          throw new Error("must not run");
        },
      },
    );

    expect(result).toEqual({
      ok: false,
      code: "PROFILE_NOT_FOUND",
      message: "Candidate profile was not found.",
    });
    expect(analysisCalled).toBe(false);
  });

  it("fails closed when profile storage cannot be read", async () => {
    const result = await analyzeJobsForCandidate(
      {
        candidateId: "candidate-a",
        jobs: [job],
      },
      {
        profileRepository: repository({
          ok: false,
          error: {
            code: "CORRUPT_STORAGE",
            message: "sensitive storage detail",
          },
        }),
      },
    );

    expect(result).toEqual({
      ok: false,
      code: "PROFILE_STORAGE_FAILURE",
      message: "Candidate profile storage could not be read.",
    });
  });

  it("rejects an empty candidate ID before repository access", async () => {
    let repositoryCalled = false;

    const profileRepository: CandidateProfileRepository = {
      async saveProfile() {
        throw new Error("must not run");
      },

      async getProfileByCandidateId() {
        repositoryCalled = true;
        throw new Error("must not run");
      },

      async listProfiles() {
        throw new Error("must not run");
      },
    };

    const result = await analyzeJobsForCandidate(
      {
        candidateId: "   ",
        jobs: [job],
      },
      { profileRepository },
    );

    expect(result).toEqual({
      ok: false,
      code: "INVALID_CANDIDATE_ID",
      message: "Candidate ID is required.",
    });
    expect(repositoryCalled).toBe(false);
  });

  it("maps unexpected analysis failures without exposing profile data", async () => {
    const result = await analyzeJobsForCandidate(
      {
        candidateId: "candidate-a",
        jobs: [job],
      },
      {
        profileRepository: repository({
          ok: true,
          value: {
            candidateId: "candidate-a",
            profile,
          },
        }),
        analyze: () => {
          throw new Error("PRIVATE PROFILE DETAIL");
        },
      },
    );

    expect(result).toEqual({
      ok: false,
      code: "ANALYSIS_FAILED",
      message: "Candidate job analysis failed.",
    });
  });
});
