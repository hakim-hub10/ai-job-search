import { describe, expect, it } from "bun:test";
import { analyzeJobs, normalizeJob } from "../../../.agents/job-search/cli/src/index";
import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import type { NormalizedJob } from "../../../.agents/job-search/cli/src/types";
import type { ApplicationAnalysisSnapshot } from "../../../.agents/job-search/cli/src/applications";
import { buildMatchComparison } from "./match-comparison";

function profile(overrides: Partial<CandidateProfile> = {}): CandidateProfile {
  return {
    headline: "IT-supporttekniker",
    targetRoles: ["IT Support"],
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
    title: "IT Support Technician",
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

function snapshotFor(candidateProfile: CandidateProfile, theJob: NormalizedJob): ApplicationAnalysisSnapshot {
  const ranked = analyzeJobs(candidateProfile, [theJob]).rankedJobs[0];
  return {
    rank: 1,
    matchingResult: ranked.matchingResult,
    scoringResult: ranked.scoringBreakdown,
    skillGapResult: ranked.skillGapResult,
    explanation: ranked.explanation,
  };
}

describe("match comparison", () => {
  it("reports the real stored score difference without reinterpreting it - positive, zero, and negative", () => {
    const theJob = job();
    const weak = snapshotFor(profile({ skills: { technical: [], soft: [] } }), theJob);
    const strong = snapshotFor(profile({ skills: { technical: ["Active Directory", "Microsoft 365"], soft: [] } }), theJob);

    const improved = buildMatchComparison(weak, strong, theJob);
    expect(improved.change).toBe(improved.currentScore - improved.previousScore);
    expect(improved.change).toBeGreaterThan(0);

    const unchanged = buildMatchComparison(weak, weak, theJob);
    expect(unchanged.change).toBe(0);

    const regressed = buildMatchComparison(strong, weak, theJob);
    expect(regressed.change).toBe(regressed.currentScore - regressed.previousScore);
    expect(regressed.change).toBeLessThan(0);
  });

  it("only lists a requirement as newly matched when it was a real previous problem and is now positively matched evidence", () => {
    const theJob = job();
    const before = snapshotFor(profile({ skills: { technical: ["Microsoft 365"], soft: [] } }), theJob);
    const after = snapshotFor(profile({ skills: { technical: ["Microsoft 365", "Active Directory"], soft: [] } }), theJob);
    const comparison = buildMatchComparison(before, after, theJob);
    expect(comparison.newMatches).toContain("Active Directory");
  });

  it("never treats a job-side-unknown requirement as a new match, since the job never asked for it in either analysis", () => {
    const noCertJob = job({ description: "Active Directory is required." });
    const before = snapshotFor(profile({ skills: { technical: [], soft: [] } }), noCertJob);
    const after = snapshotFor(profile({ skills: { technical: ["Active Directory"], soft: [] } }), noCertJob);
    const comparison = buildMatchComparison(before, after, noCertJob);
    expect(comparison.newMatches).not.toContain("Certifieringar");
    expect(comparison.remainingMissing.map((item) => item.title)).not.toContain("Certifieringar");
  });

  it("still shows the current gap list as remaining requirements, independent of whether they existed in the previous analysis", () => {
    const theJob = job();
    const before = snapshotFor(profile({ skills: { technical: [], soft: [] } }), theJob);
    const after = snapshotFor(profile({ skills: { technical: ["Microsoft 365"], soft: [] } }), theJob);
    const comparison = buildMatchComparison(before, after, theJob);
    expect(comparison.remainingMissing.some((item) => item.title === "Active Directory")).toBe(true);
  });
});
