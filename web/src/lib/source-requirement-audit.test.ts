import { expect, test } from "bun:test";
import { createSourceAdapter, sourceDetailToEvidence } from "../../../.agents/job-search/cli/src/adapters";
import { jobTechHitToNormalizedJob } from "../../../.agents/job-search/cli/src/jobtech-adapter";
import { jobAdLinksHitToNormalizedJob } from "../../../.agents/job-search/cli/src/jobad-links-adapter";
import { normalizeJob, analyzeJobs } from "../../../.agents/job-search/cli/src/index";
import { createDefaultCandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import { auditJobRequirements, presentMatch, unknownEvidenceLabel } from "./match-confidence";

const requirements = "Requirements: SQL and Python. Experience required. Communication and collaboration. English required. Certification preferred.";
test("representative source shapes retain their different evidence coverage", async () => {
  const platsbanken = jobTechHitToNormalizedJob({ id: "pb", headline: "Analyst", description: { text: requirements }, employment_type: { label: "full-time" }, workplace_model: { label: "hybrid" } })!;
  const links = jobAdLinksHitToNormalizedJob({ id: "links", headline: "Analyst", brief: "Operations role" })!;
  const linkedin = await createSourceAdapter("linkedin", [], "/tmp", async () => ({ exitCode: 0, stderr: "", stdout: JSON.stringify({ results: [{ id: "li", title: "Analyst" }] }) })).search({ query: "Analyst" });
  const detail = sourceDetailToEvidence("linkedin", { title: "Analyst", description: requirements, employmentType: "full-time" }, linkedin.jobs[0]);
  const freehire = await createSourceAdapter("freehire", [], "/tmp", async () => ({ exitCode: 0, stderr: "", stdout: JSON.stringify({ jobs: [{ id: "fh", title: "Analyst", skills: ["SQL", "Python"], work_mode: "remote", employmentType: "full-time", description: requirements }] }) })).search({ query: "Analyst" });
  expect(auditJobRequirements(platsbanken)).toMatchObject({ titlePresent: true, descriptionPresent: true, technicalRequirements: 2, softSkillsMentioned: true, experienceMentioned: true, certificationsMentioned: true, languagesMentioned: true, workArrangementPresent: true, employmentTypePresent: true });
  expect(auditJobRequirements(linkedin.jobs[0])).toMatchObject({ descriptionPresent: false, technicalRequirements: 0 });
  expect(auditJobRequirements(normalizeJob({ ...linkedin.jobs[0], description: detail?.description, employmentType: detail?.employmentType }))).toMatchObject({ descriptionPresent: true, technicalRequirements: 2 });
  expect(auditJobRequirements(freehire.jobs[0])).toMatchObject({ technicalRequirements: 2, workArrangementPresent: true });
  expect(auditJobRequirements(links)).toMatchObject({ descriptionPresent: true, technicalRequirements: 0, employmentTypePresent: false });
});
test("diagnostics separate extraction review, missing description and known low match", () => {
  const profile = createDefaultCandidateProfile();
  const job = normalizeJob({ id: "unknown", title: "Analyst", source: "freehire", description: "Requirements: specialist proprietary instrument expertise." });
  expect(presentMatch(analyzeJobs(profile, [job]).rankedJobs[0]).diagnosis).toBe("EXTRACTION_FAILED");
  const rich = normalizeJob({ ...job, title: "Surgeon", skills: ["Surgery"], location: "Elsewhere", remote: "onsite", employmentType: "full-time", seniority: "principal", description: "Surgery required. English required. Communication required.", category: "Medicine" });
  expect(presentMatch(analyzeJobs(profile, [rich]).rankedJobs[0]).diagnosis).toBe("GENUINE_LOW_MATCH");
  expect(unknownEvidenceLabel({ dimension: "certifications", status: "unknown", detail: "No specific certification match found" }, job)).toBe("Inget certifieringskrav anges i annonsen.");
});
test("title-only role evidence never creates technology, language or experience requirements", () => {
  const profile = createDefaultCandidateProfile(); profile.targetRoles = ["IT Support"];
  const job = normalizeJob({ id: "title", title: "English IT Support Technician", source: "linkedin" });
  const match = analyzeJobs(profile, [job]).rankedJobs[0];
  expect(match.matchingResult.matchedDimensions).toContain("targetRole");
  for (const dimension of ["technicalSkills", "yearsOfExperience", "certifications", "languages"] as const) expect(match.matchingResult.unknownDimensions).toContain(dimension);
  expect(auditJobRequirements(job).technicalRequirements).toBe(0);
});
test("a job that never states a language or industry requirement never presents that as a candidate deficiency", () => {
  const job = normalizeJob({ id: "no-language-or-industry", title: "IT Support Technician", source: "linkedin", description: "Requirements: Windows and networking troubleshooting. Experience required." });
  expect(unknownEvidenceLabel({ dimension: "languages", status: "unknown", detail: "unused" }, job)).toBe("Inget språkkrav anges i annonsen.");
  expect(unknownEvidenceLabel({ dimension: "preferredIndustries", status: "unknown", detail: "does not directly match preferences" }, job)).toBe("Ingen särskild branscherfarenhet anges som krav.");
});
test("a job that does state a language requirement is distinguished from one that does not", () => {
  const job = normalizeJob({ id: "states-language", title: "IT Support Technician", source: "linkedin", description: "Requirements: English and Swedish required. Windows troubleshooting." });
  expect(unknownEvidenceLabel({ dimension: "languages", status: "unknown", detail: "unused" }, job)).toBe("Språkkrav nämns i annonsen; det kunde inte säkert matchas mot din profil");
});
test("experience requirement wording distinguishes 'not stated' from 'stated but unclear'", () => {
  const noExperience = normalizeJob({ id: "no-experience", title: "IT Support Technician", source: "linkedin", description: "Windows and networking troubleshooting." });
  expect(unknownEvidenceLabel({ dimension: "yearsOfExperience", status: "unknown", detail: "unused" }, noExperience)).toBe("Annonsen anger inget tydligt erfarenhetskrav.");
  const vagueExperience = normalizeJob({ id: "vague-experience", title: "IT Support Technician", source: "linkedin", description: "Some experience preferred but not strictly required." });
  expect(unknownEvidenceLabel({ dimension: "yearsOfExperience", status: "unknown", detail: "unused" }, vagueExperience)).toBe("Ett erfarenhetskrav nämns men kunde inte säkert tolkas.");
});
test("certification requirement wording distinguishes 'not stated' from 'stated but unclear'", () => {
  const noCert = normalizeJob({ id: "no-cert", title: "IT Support Technician", source: "linkedin", description: "Windows and networking troubleshooting." });
  expect(unknownEvidenceLabel({ dimension: "certifications", status: "unknown", detail: "unused" }, noCert)).toBe("Inget certifieringskrav anges i annonsen.");
});
