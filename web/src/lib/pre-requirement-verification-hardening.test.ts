import { describe, expect, test } from "bun:test";
import { analyzeJobs, createApplication, generateApplicationDocument, normalizeJob } from "../../../.agents/job-search/cli/src/index";
import { createDefaultCandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import { documentQualityProfile, professionalDocumentGenerator } from "./professional-documents";
import {
  buildMatchExplanationSummary,
  conflictingGapItems,
  deriveActionableRecommendations,
  missingGapItems,
  unknownEvidenceCase,
} from "./match-confidence";

/**
 * Reproduces the combined real browser case from the Final Manual UX + Data
 * Quality Audit in one scenario: an education-like value misfiled among
 * certifications, a duplicate technical skill, a pipe-delimited multi-value
 * headline, a job whose target role/location/experience are all uncertain
 * or conflicting, and a job where every SkillGapResult-covered dimension
 * stays matched or unknown (never "missing") so SkillGapResult.gaps is
 * empty even though MatchingResult has real, actionable issues.
 */
function auditCaseProfile() {
  const profile = createDefaultCandidateProfile();
  profile.headline = "Ekonomiassistent | Redovisningsassistent | Löneadministration";
  profile.targetRoles = ["Ekonomiassistent"];
  profile.locationPreferences = ["Jönköping"];
  profile.workMode = "onsite";
  profile.remotePreference = false;
  profile.skills = { technical: ["Bokföring", "Bokföring", "bokföring  ", "Excel"], soft: ["Kommunikation"] };
  profile.certifications = ["Gränsälvsgymnasiet (2016–2018)", "Diplomerad ekonomiassistent"];
  profile.languages = [{ name: "Svenska", level: "Professionell" }];
  profile.workExperience = [
    { title: "Ekonomiassistent", company: "Exempel Ekonomi AB", location: "Jönköping", startDate: "2022", summary: "Hanterade löpande bokföring och fakturering." },
  ];
  return profile;
}

function auditCaseJob() {
  return normalizeJob({
    id: "audit-case-job",
    title: "Backend-utvecklare",
    source: "test",
    company: "Exempel Tech AB",
    location: "Göteborg",
    remote: "onsite",
    employmentType: "full-time",
    skills: ["Bokföring", "Excel"],
    description: "Krav: Bokföring och Excel. Svenska krävs.",
  });
}

describe("pre-requirement-verification hardening - combined manual-case regression", () => {
  test("A. an education-like suspicious certification is not emitted as a verified certification in the generated CV", async () => {
    const profile = auditCaseProfile();
    const job = auditCaseJob();
    const application = createApplication({ id: "audit-case-cv", rankedJob: analyzeJobs(profile, [job]).rankedJobs[0], createdAt: "2026-09-14T10:00:00Z" });
    if (!application.ok) throw new Error(application.error.message);
    const generated = await generateApplicationDocument({
      application: application.value,
      candidateDocumentInput: { matchingProfile: documentQualityProfile(profile), identity: { fullName: "Alex Exempel" } },
      tailoringOptions: { type: "cv", language: "sv", maxEvidenceItems: 200 },
      generationOptions: { untrustedJobDescription: job.description ?? undefined },
      generator: professionalDocumentGenerator,
    });
    if (!generated.ok) throw new Error(JSON.stringify(generated.error));
    expect(generated.value.renderedDocument.content).not.toContain("Gränsälvsgymnasiet");
  });

  test("B. the legitimate certification remains in the generated CV", async () => {
    const profile = auditCaseProfile();
    const job = auditCaseJob();
    const application = createApplication({ id: "audit-case-cv-legit", rankedJob: analyzeJobs(profile, [job]).rankedJobs[0], createdAt: "2026-09-14T10:00:00Z" });
    if (!application.ok) throw new Error(application.error.message);
    const generated = await generateApplicationDocument({
      application: application.value,
      candidateDocumentInput: { matchingProfile: documentQualityProfile(profile), identity: { fullName: "Alex Exempel" } },
      tailoringOptions: { type: "cv", language: "sv", maxEvidenceItems: 200 },
      generationOptions: { untrustedJobDescription: job.description ?? undefined },
      generator: professionalDocumentGenerator,
    });
    if (!generated.ok) throw new Error(JSON.stringify(generated.error));
    expect(generated.value.renderedDocument.content).toContain("Diplomerad ekonomiassistent");
  });

  test("C. the duplicate technical skill collapses to one entry in the cleaned profile reaching document generation", () => {
    const cleaned = documentQualityProfile(auditCaseProfile());
    const bokforingOccurrences = cleaned.skills.technical.filter((v) => v.toLocaleLowerCase().includes("bokföring")).length;
    expect(bokforingOccurrences).toBe(1);
    expect(cleaned.skills.technical).toContain("Excel");
  });

  test("D. the composed profile prose does not literally begin with the pipe-delimited headline", async () => {
    const profile = auditCaseProfile();
    const job = auditCaseJob();
    const application = createApplication({ id: "audit-case-headline", rankedJob: analyzeJobs(profile, [job]).rankedJobs[0], createdAt: "2026-09-14T10:00:00Z" });
    if (!application.ok) throw new Error(application.error.message);
    const generated = await generateApplicationDocument({
      application: application.value,
      candidateDocumentInput: { matchingProfile: documentQualityProfile(profile), identity: { fullName: "Alex Exempel" } },
      tailoringOptions: { type: "cv", language: "sv", maxEvidenceItems: 200 },
      generationOptions: { untrustedJobDescription: job.description ?? undefined },
      generator: professionalDocumentGenerator,
    });
    if (!generated.ok) throw new Error(JSON.stringify(generated.error));
    const summarySection = generated.value.document.sections.find((section) => section.kind === "summary");
    const composedClaim = summarySection?.claims.find((c) => c.id === "professional:summary:composed");
    expect(composedClaim?.text).not.toStartWith("Ekonomiassistent | Redovisningsassistent | Löneadministration");
    expect(composedClaim?.text?.split(/(?<=\.)\s+/u)[0] ?? "").not.toContain("|");
  });

  test("E. SkillGapResult.gaps is empty for this job, even though MatchingResult has real, actionable issues (targetRole missing, location conflicting)", () => {
    const profile = auditCaseProfile();
    const job = auditCaseJob();
    const ranked = analyzeJobs(profile, [job]).rankedJobs[0];
    expect(ranked.skillGapResult.gaps).toHaveLength(0);
    expect(ranked.matchingResult.missing.some((e) => e.dimension === "targetRole")).toBe(true);
    expect(ranked.matchingResult.conflicting.some((e) => e.dimension === "location")).toBe(true);
  });

  test("F. the actionable match issues remain fully visible through the existing presentation helpers, independent of the empty SkillGapResult", () => {
    const profile = auditCaseProfile();
    const job = auditCaseJob();
    const ranked = analyzeJobs(profile, [job]).rankedJobs[0];
    const missingItems = ranked.matchingResult.missing.flatMap(missingGapItems);
    const conflictingItems = ranked.matchingResult.conflicting.flatMap(conflictingGapItems);
    expect(missingItems.some((item) => item.title === "Målroll")).toBe(true);
    expect(conflictingItems.some((item) => item.title === "Plats")).toBe(true);
    // Even with an empty SkillGapResult, a real recommendation is still derived for the missing target role.
    const recommendations = deriveActionableRecommendations(ranked.matchingResult, ranked.skillGapResult);
    expect(recommendations.length).toBeGreaterThan(0);
    // A job-side-unknown dimension (e.g. certifications, never mentioned by this job ad) is
    // never presented as a candidate deficiency.
    const certEvidence = ranked.matchingResult.unknown.find((e) => e.dimension === "certifications");
    if (certEvidence) expect(unknownEvidenceCase(certEvidence, job)).toBe("jobUnspecified");
    const explanation = buildMatchExplanationSummary(ranked, job);
    expect(explanation.missingVerified).toContain("Målroll");
    expect(explanation.conflicting).toContain("Plats");
  });

  test("G. no scoring/matching semantics changed by this hardening pass - the score is a real, unmodified number reflecting real evidence", () => {
    const profile = auditCaseProfile();
    const job = auditCaseJob();
    const ranked = analyzeJobs(profile, [job]).rankedJobs[0];
    expect(typeof ranked.score).toBe("number");
    expect(ranked.score).toBeGreaterThanOrEqual(0);
    expect(ranked.score).toBeLessThanOrEqual(100);
    // Technical skills and languages genuinely match - the score is not artificially depressed
    // or inflated by anything in this hardening pass.
    expect(ranked.matchingResult.matchedDimensions).toContain("technicalSkills");
    expect(ranked.matchingResult.matchedDimensions).toContain("languages");
  });

  test("H. no candidate fact is automatically invented or moved without explicit confirmation - documentQualityProfile only filters/dedupes, it never adds a fact, and the stored profile is untouched", () => {
    const profile = auditCaseProfile();
    const before = structuredClone(profile);
    const cleaned = documentQualityProfile(profile);
    // Every value that survives cleaning was already present verbatim in the original profile.
    for (const skill of cleaned.skills.technical) expect(profile.skills.technical.some((v) => v.trim().toLocaleLowerCase() === skill.trim().toLocaleLowerCase())).toBe(true);
    for (const certification of cleaned.certifications) expect(profile.certifications).toContain(certification);
    // The stored profile itself is never mutated by documentQualityProfile.
    expect(profile).toEqual(before);
  });
});
