import { expect, test } from "bun:test";
import { createDefaultCandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import { classifySkill, looksLikeRawImportBlock, previewSkillReview, reviewProfileQuality, summaryReviewItem } from "./profile-quality";

test("flags pollution conservatively without mutating approved evidence", () => {
  const profile = createDefaultCandidateProfile();
  profile.skills.technical = ["SQL", "IT-", "support", "https://example.test", "2019 – 2022", "Example Company", "Sweden", "Responsible for supporting all of the local users and their equipment", "Reference: available"];
  const before = structuredClone(profile);
  const report = reviewProfileQuality(profile);
  expect(report.filter(x => x.suspicious)).toHaveLength(8);
  expect(report.map(x => x.classification)).toContain("LOCATION");
  expect(profile).toEqual(before);
  for (const value of ["C++", ".NET", "R", "TypeScript", "Public procurement", "Risk assessment", "Intune"]) expect(classifySkill(value).classification).toBe("VALID_SKILL");
});
test("explicit keep, move and removal produce a detached preview and reject stale decisions", () => {
  const profile = createDefaultCandidateProfile(); profile.skills.technical = ["SQL", "Worked with scheduling", "IT-"];
  const next = previewSkillReview(profile, [
    { field: "technical", index: 0, expectedValue: "SQL", action: "keep" },
    { field: "technical", index: 1, expectedValue: "Worked with scheduling", action: "move", destination: "experience", experienceIndex: 0 },
    { field: "technical", index: 2, expectedValue: "IT-", action: "remove" },
  ]);
  expect(next.skills.technical).toEqual(["SQL"]);
  expect(next.workExperience[0].summary).toContain("Worked with scheduling");
  expect(profile.skills.technical).toHaveLength(3);
  expect(() => previewSkillReview(profile, [{ field: "technical", index: 0, expectedValue: "Changed", action: "remove" }])).toThrow("Stale");
});
test("flags a pasted-CV-shaped summary but leaves an authored summary alone", () => {
  const pasted = "IT-supporttekniker med erfarenhet.\nArbetade på Example IT Services 2020-2023.\n\nUtbildning: Diploma, Example College.\n\nReferenser: available on request.";
  expect(looksLikeRawImportBlock(pasted)).toBe(true);
  expect(looksLikeRawImportBlock("Erfaren IT-supporttekniker med fokus på förstalinjesupport och Microsoft 365.")).toBe(false);
  expect(looksLikeRawImportBlock("")).toBe(false);

  const profile = createDefaultCandidateProfile();
  const withPastedSummary = { ...profile, summary: pasted };
  const review = summaryReviewItem(withPastedSummary);
  expect(review).toMatchObject({ field: "summary", classification: "RAW_IMPORT_BLOCK", suspicious: true });
  expect(summaryReviewItem({ ...profile, summary: "Erfaren IT-supporttekniker." })).toBeNull();
  expect(summaryReviewItem(profile)).toBeNull();
});
test("flags GitHub-project text, education, and URLs inside certifications, and preserves genuine certifications", () => {
  const profile = createDefaultCandidateProfile();
  profile.certifications = [
    "CompTIA A+",
    "GITHUB-PROJEKT: Migrated 200 users to Microsoft 365 during 2022",
    "https://github.com/example/ticketing",
    "BSc Computer Science, Example University",
    "AWS Certified Solutions Architect",
  ];
  const before = structuredClone(profile);
  const report = reviewProfileQuality(profile).filter(x => x.field === "certifications");
  expect(report.find(x => x.value === "CompTIA A+")).toMatchObject({ suspicious: false });
  expect(report.find(x => x.value === "AWS Certified Solutions Architect")).toMatchObject({ suspicious: false, classification: "CERTIFICATION" });
  expect(report.find(x => x.value.startsWith("GITHUB-PROJEKT"))).toMatchObject({ suspicious: true, classification: "PROJECT" });
  expect(report.find(x => x.value.startsWith("https://"))).toMatchObject({ suspicious: true, classification: "SUSPICIOUS" });
  expect(report.find(x => x.value.includes("University"))).toMatchObject({ suspicious: true, classification: "EDUCATION" });
  expect(profile).toEqual(before);
});
test("does not misclassify a genuine skill phrase that happens to contain the word project", () => {
  expect(classifySkill("Project management").classification).toBe("VALID_SKILL");
  expect(classifySkill("Agile project delivery").classification).toBe("VALID_SKILL");
});
test("moving a flagged certification into projects creates a minimal structured project entry", () => {
  const profile = createDefaultCandidateProfile();
  profile.certifications = ["CompTIA A+", "GITHUB-PROJEKT: Migrated 200 users to Microsoft 365"];
  const next = previewSkillReview(profile, [
    { field: "certifications", index: 0, expectedValue: "CompTIA A+", action: "keep" },
    { field: "certifications", index: 1, expectedValue: "GITHUB-PROJEKT: Migrated 200 users to Microsoft 365", action: "move", destination: "projects" },
  ]);
  expect(next.certifications).toEqual(["CompTIA A+"]);
  expect(next.projects).toEqual([{ title: "GITHUB-PROJEKT: Migrated 200 users to Microsoft 365" }]);
  expect(profile.certifications).toHaveLength(2);
});
