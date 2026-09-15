import { describe, expect, it } from "bun:test";
import { analyzeJobs, normalizeJob } from "../../../.agents/job-search/cli/src/index";
import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import type { NormalizedJob } from "../../../.agents/job-search/cli/src/types";
import { buildProfileGapContext, currentProfileValueForDimension } from "./profile-gap-context";

function profile(overrides: Partial<CandidateProfile> = {}): CandidateProfile {
  return {
    headline: "IT-supporttekniker",
    targetRoles: ["Ekonomiassistent"],
    locationPreferences: ["Jönköping"],
    workMode: "onsite",
    remotePreference: false,
    preferredIndustries: ["IT"],
    preferredEmploymentType: ["full-time"],
    skills: { technical: ["Microsoft 365"], soft: ["Kommunikation"] },
    workExperience: [],
    education: [],
    certifications: [],
    languages: [{ name: "Svenska", level: "Professionell" }],
    yearsOfExperience: 3,
    careerGoals: [],
    summary: undefined,
    updatedAt: "2026-09-14T10:00:00.000Z",
    ...overrides,
  };
}

function job(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return normalizeJob({
    id: "job-a",
    title: "IT Support",
    source: "jobtech",
    sourceId: "source-a",
    company: "Exempel AB",
    location: "Jönköping",
    url: "https://example.test/job-a",
    applyUrl: "https://example.test/apply-a",
    description: "Active Directory is required. ITIL certification required.",
    skills: ["Active Directory", "Microsoft 365"],
    remote: "onsite",
    employmentType: "full-time",
    seniority: "mid",
    ...overrides,
  });
}

function applicationFor(candidateProfile: CandidateProfile, theJob: NormalizedJob) {
  const ranked = analyzeJobs(candidateProfile, [theJob]).rankedJobs[0];
  return {
    jobSnapshot: theJob,
    analysisSnapshot: {
      rank: 1,
      matchingResult: ranked.matchingResult,
      scoringResult: ranked.scoringBreakdown,
      skillGapResult: ranked.skillGapResult,
      explanation: ranked.explanation,
    },
  };
}

describe("profile gap context", () => {
  it("shows a specific missing technical skill with the candidate's current value for that field", () => {
    const candidateProfile = profile();
    const context = buildProfileGapContext(applicationFor(candidateProfile, job()), candidateProfile);
    const activeDirectory = context.verifiedGaps.find((item) => item.title === "Active Directory");
    expect(activeDirectory).toBeDefined();
    expect(activeDirectory?.dimension).toBe("technicalSkills");
    expect(activeDirectory?.fieldId).toBe("field-technicalSkills");
    expect(activeDirectory?.currentValue).toBe("Microsoft 365");
  });

  it("never lists a requirement the job ad never mentioned as a candidate gap or uncertainty", () => {
    const candidateProfile = profile();
    const noCertJob = job({ id: "no-cert", description: "Active Directory is required." });
    const context = buildProfileGapContext(applicationFor(candidateProfile, noCertJob), candidateProfile);
    const allTitles = [...context.verifiedGaps, ...context.candidateUncertain, ...context.conflicting].map((item) => item.title);
    expect(allTitles).not.toContain("Certifieringar");
  });

  it("distinguishes candidate-side uncertainty (job mentions it) from a verified gap", () => {
    const candidateProfile = profile();
    const context = buildProfileGapContext(applicationFor(candidateProfile, job()), candidateProfile);
    const certUncertainty = context.candidateUncertain.find((item) => item.dimension === "certifications");
    expect(certUncertainty).toBeDefined();
    expect(certUncertainty?.fieldId).toBe("field-certifications");
  });

  it("explains a missing target role with the job's role, the candidate's current roles, and the real match reasoning", () => {
    const candidateProfile = profile({ targetRoles: ["Ekonomiassistent"] });
    const context = buildProfileGapContext(applicationFor(candidateProfile, job({ title: "IT Support Technician" })), candidateProfile);
    expect(context.targetRoleExplanation).not.toBeNull();
    expect(context.targetRoleExplanation?.jobRole).toBe("IT Support Technician");
    expect(context.targetRoleExplanation?.candidateTargetRoles).toEqual(["Ekonomiassistent"]);
    expect(context.targetRoleExplanation?.explanation).toContain("does not match target roles");
    expect(context.targetRoleExplanation?.fieldId).toBe("field-targetRoles");
  });

  it("omits the target-role explanation entirely once the role actually matches", () => {
    const candidateProfile = profile({ targetRoles: ["IT Support"] });
    const context = buildProfileGapContext(applicationFor(candidateProfile, job({ title: "IT Support Technician" })), candidateProfile);
    expect(context.targetRoleExplanation).toBeNull();
  });

  it("reads the current profile value structurally per dimension, never inventing a value", () => {
    const candidateProfile = profile({ skills: { technical: ["Windows", "Networking"], soft: [] } });
    expect(currentProfileValueForDimension("technicalSkills", candidateProfile)).toBe("Windows, Networking");
    expect(currentProfileValueForDimension("targetRole", candidateProfile)).toBe("Ekonomiassistent");
    expect(currentProfileValueForDimension("languages", candidateProfile)).toBe("Svenska (Professionell)");
    expect(currentProfileValueForDimension("certifications", profile({ certifications: [] }))).toBe("Inga angivna certifieringar");
  });
});
