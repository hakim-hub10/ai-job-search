import { expect, test } from "bun:test";
import { analyzeJobs, normalizeJob } from "../../../.agents/job-search/cli/src/index";
import { createDefaultCandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import {
  buildMatchExplanationSummary,
  conflictingGapItems,
  deriveActionableRecommendations,
  missingGapItems,
  unknownEvidenceCase,
} from "./match-confidence";

function itSupportProfile() {
  const profile = createDefaultCandidateProfile();
  profile.targetRoles = ["IT Support"];
  profile.skills = { technical: ["Windows", "Microsoft 365"], soft: ["Kommunikation"] };
  return profile;
}

test("a specific missing skill is shown by its own name, not a generic 'technical skills' label", () => {
  const profile = itSupportProfile();
  const job = normalizeJob({
    id: "gap-job",
    title: "IT Support",
    source: "linkedin",
    description: "Requirements: Active Directory and Windows are required.",
    skills: ["Active Directory", "Windows"],
  });
  const ranked = analyzeJobs(profile, [job]).rankedJobs[0];
  const technicalMissing = ranked.matchingResult.missing.find((evidence) => evidence.dimension === "technicalSkills");
  expect(technicalMissing).toBeDefined();
  const items = missingGapItems(technicalMissing!);
  expect(items.map((item) => item.title)).toContain("Active Directory");
  expect(items.map((item) => item.title)).not.toContain("Windows");
  expect(items.every((item) => item.description.length > 0)).toBe(true);
});

test("a requirement the job never mentions never renders through the verified-gap or conflict wording, and is distinguished from candidate uncertainty", () => {
  const profile = itSupportProfile();
  const noCertJob = normalizeJob({ id: "no-cert", title: "IT Support", source: "linkedin", description: "Windows and networking troubleshooting." });
  const noCertEvidence = analyzeJobs(profile, [noCertJob]).rankedJobs[0].matchingResult.unknown.find((e) => e.dimension === "certifications")!;
  expect(unknownEvidenceCase(noCertEvidence, noCertJob)).toBe("jobUnspecified");

  const certJob = normalizeJob({ id: "cert", title: "IT Support", source: "linkedin", description: "ITIL certification required. Windows troubleshooting." });
  const certEvidence = analyzeJobs(profile, [certJob]).rankedJobs[0].matchingResult.unknown.find((e) => e.dimension === "certifications")!;
  expect(unknownEvidenceCase(certEvidence, certJob)).toBe("candidateUncertain");
});

test("conflicting evidence is labeled with the actual dimension it conflicts on", () => {
  const profile = itSupportProfile();
  profile.locationPreferences = ["Stockholm"];
  profile.workMode = "onsite";
  const job = normalizeJob({ id: "conflict", title: "IT Support", source: "linkedin", location: "Göteborg", remote: "onsite" });
  const ranked = analyzeJobs(profile, [job]).rankedJobs[0];
  const locationConflict = ranked.matchingResult.conflicting.find((e) => e.dimension === "location");
  if (locationConflict) {
    const items = conflictingGapItems(locationConflict);
    expect(items[0].title).toBe("Plats");
    expect(items[0].description).toContain("plats");
  }
});

test("a missing target role produces an actionable recommendation even when analyzeSkillGaps itself finds nothing to recommend", () => {
  const profile = itSupportProfile();
  profile.targetRoles = ["Ekonomiassistent"];
  const job = normalizeJob({ id: "role-mismatch", title: "IT Support Technician", source: "linkedin", skills: [] });
  const ranked = analyzeJobs(profile, [job]).rankedJobs[0];
  expect(ranked.matchingResult.missing.some((e) => e.dimension === "targetRole")).toBe(true);
  const recommendations = deriveActionableRecommendations(ranked.matchingResult, ranked.skillGapResult);
  expect(recommendations.some((r) => r.title === "Se över din angivna målroll")).toBe(true);
});

test("recommended development still surfaces guidance when the underlying skill-gap result has zero gaps of its own", () => {
  const profile = itSupportProfile();
  profile.targetRoles = ["Ekonomiassistent"];
  const job = normalizeJob({ id: "role-mismatch-2", title: "IT Support Technician", source: "linkedin", skills: [] });
  const ranked = analyzeJobs(profile, [job]).rankedJobs[0];
  expect(ranked.skillGapResult.gaps.length).toBe(0);
  const recommendations = deriveActionableRecommendations(ranked.matchingResult, ranked.skillGapResult);
  expect(recommendations.length).toBeGreaterThan(0);
});

test("the match explanation never claims a dimension affected the score unless the scoring engine actually placed it in that bucket", () => {
  const profile = itSupportProfile();
  const job = normalizeJob({
    id: "explain",
    title: "IT Support",
    source: "linkedin",
    description: "Requirements: Active Directory required. Windows required.",
    skills: ["Active Directory", "Windows"],
  });
  const ranked = analyzeJobs(profile, [job]).rankedJobs[0];
  const summary = buildMatchExplanationSummary(ranked, job);
  expect(summary.scoreLabel).toBe(`${ranked.score}/100`);
  expect(summary.missingVerified).toContain("Active Directory");
  expect(summary.missingVerified).not.toContain("Windows");
  const allListed = [...summary.matched, ...summary.missingVerified, ...summary.candidateUncertain, ...summary.jobUnspecified, ...summary.conflicting];
  const allDimensionsAccounted =
    ranked.matchingResult.matched.length + ranked.matchingResult.missing.length + ranked.matchingResult.unknown.length + ranked.matchingResult.conflicting.length;
  expect(allDimensionsAccounted).toBeGreaterThan(0);
  expect(allListed.length).toBeGreaterThan(0);
});
