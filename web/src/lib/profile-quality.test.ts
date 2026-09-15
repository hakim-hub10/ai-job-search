import { expect, test } from "bun:test";
import { createDefaultCandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import { classifySkill, deepRepairMojibake, looksLikeRawImportBlock, previewSkillReview, repairMojibake, reviewProfileQuality, summaryReviewItem } from "./profile-quality";
import { presentSkills } from "./skill-presentation";

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
test("catches real-world leaked dates and sentence fragments observed in imported skill lists", () => {
  for (const value of ["(2021 – 2026)", "Jönköping (2022 – 2023)", "Stockholm (2019 – present)"]) {
    expect(classifySkill(value).classification).toBe("DATE");
  }
  for (const value of ["Hantering av incidenter och tekniska problem", "Dokumentation av lösningar och incidenter", "Felsökning och drift av IT-miljöer i AWS"]) {
    expect(classifySkill(value).classification).toBe("PROSE");
  }
  for (const value of ["Docker", "Kubernetes", "Nätverk"]) expect(classifySkill(value).classification).toBe("VALID_SKILL");
});
test("ServiceNow and similar tools/platforms are flagged when mis-filed under soft skills, but valid as technical skills", () => {
  const profile = createDefaultCandidateProfile();
  profile.skills.soft = ["ServiceNow", "Jira", "Communication"];
  const report = reviewProfileQuality(profile);
  expect(report.find((item) => item.value === "ServiceNow")).toMatchObject({ classification: "TECHNICAL_SKILL", suspicious: true });
  expect(report.find((item) => item.value === "Jira")).toMatchObject({ classification: "TECHNICAL_SKILL", suspicious: true });
  expect(report.find((item) => item.value === "Communication")).toMatchObject({ suspicious: false });
  profile.skills.soft = [];
  profile.skills.technical = ["ServiceNow"];
  expect(reviewProfileQuality(profile).find((item) => item.value === "ServiceNow")).toMatchObject({ suspicious: false });
});
test("repairMojibake reverses UTF-8-as-Latin-1 corruption without touching clean text", () => {
  expect(repairMojibake("GÃ¶teborg")).toBe("Göteborg");
  expect(repairMojibake("sÃ¤kerhetsrutiner")).toBe("säkerhetsrutiner");
  expect(repairMojibake("Ã¥tkomstkontroll")).toBe("åtkomstkontroll");
  expect(repairMojibake("Göteborg")).toBe("Göteborg");
  expect(repairMojibake("")).toBe("");
  expect(repairMojibake("São Paulo")).toBe("São Paulo");
});
test("deepRepairMojibake repairs every string field of a profile without mutating the input", () => {
  const profile = createDefaultCandidateProfile();
  profile.workExperience = [{ title: "IT-support", company: "Rexett AB", location: "GÃ¶teborg", summary: "Felsökning och drift av tekniska miljÃ¶er." }];
  const before = structuredClone(profile);
  const repaired = deepRepairMojibake(profile);
  expect(repaired.workExperience[0]!.location).toBe("Göteborg");
  // Mixed already-correct and mojibake text within the same field must both
  // resolve correctly - a single invalid byte must not abort the whole repair.
  expect(repaired.workExperience[0]!.summary).toBe("Felsökning och drift av tekniska miljöer.");
  expect(profile).toEqual(before);
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
test("moving an education-like flagged certification requires the candidate's own structured education fields - never invented from the flagged string", () => {
  const profile = createDefaultCandidateProfile();
  profile.certifications = ["AWS Certified Solutions Architect", "Gränsälvsgymnasiet (2016–2018)"];
  const before = structuredClone(profile);
  const report = reviewProfileQuality(profile).find(x => x.field === "certifications" && x.value.startsWith("Gränsälvsgymnasiet"));
  expect(report).toMatchObject({ suspicious: true, classification: "DATE" });

  const next = previewSkillReview(profile, [
    { field: "certifications", index: 0, expectedValue: "AWS Certified Solutions Architect", action: "keep" },
    {
      field: "certifications", index: 1, expectedValue: "Gränsälvsgymnasiet (2016–2018)", action: "move", destination: "education",
      education: { degree: "Naturvetenskapsprogrammet", field: "Naturvetenskap", institution: "Gränsälvsgymnasiet", startYear: 2016, endYear: 2018 },
    },
  ]);
  expect(next.certifications).toEqual(["AWS Certified Solutions Architect"]);
  expect(next.education).toContainEqual({ degree: "Naturvetenskapsprogrammet", field: "Naturvetenskap", institution: "Gränsälvsgymnasiet", startYear: 2016, endYear: 2018 });
  expect(next.education).toHaveLength(profile.education.length + 1);
  // The stored profile itself is never mutated by a preview.
  expect(profile).toEqual(before);
});

test("moving a flagged item into education never creates a duplicate when an equivalent entry already exists", () => {
  const profile = createDefaultCandidateProfile();
  profile.education = [{ degree: "Naturvetenskapsprogrammet", field: "Naturvetenskap", institution: "Gränsälvsgymnasiet", startYear: 2016, endYear: 2018 }];
  profile.certifications = ["Gränsälvsgymnasiet (2016–2018)"];
  const next = previewSkillReview(profile, [
    {
      field: "certifications", index: 0, expectedValue: "Gränsälvsgymnasiet (2016–2018)", action: "move", destination: "education",
      education: { degree: "naturvetenskapsprogrammet", field: "Naturvetenskap", institution: "gränsälvsgymnasiet " },
    },
  ]);
  expect(next.education).toHaveLength(1);
});

test("moving a flagged item into education rejects a missing degree, field, or institution rather than inventing a blank entry", () => {
  const profile = createDefaultCandidateProfile();
  profile.certifications = ["Gränsälvsgymnasiet (2016–2018)"];
  expect(() => previewSkillReview(profile, [
    { field: "certifications", index: 0, expectedValue: "Gränsälvsgymnasiet (2016–2018)", action: "move", destination: "education", education: { degree: "", field: "Naturvetenskap", institution: "Gränsälvsgymnasiet" } },
  ])).toThrow("Degree, field, and institution are required");
  expect(() => previewSkillReview(profile, [
    { field: "certifications", index: 0, expectedValue: "Gränsälvsgymnasiet (2016–2018)", action: "move", destination: "education", education: { degree: "Naturvetenskapsprogrammet", field: "", institution: "Gränsälvsgymnasiet" } },
  ])).toThrow("Degree, field, and institution are required");
  expect(() => previewSkillReview(profile, [
    { field: "certifications", index: 0, expectedValue: "Gränsälvsgymnasiet (2016–2018)", action: "move", destination: "education", education: { degree: "Naturvetenskapsprogrammet", field: "Naturvetenskap", institution: "   " } },
  ])).toThrow("Degree, field, and institution are required");
});

test("presentation aliases preserve distinct identity systems and Intune, with configurable groups", () => {
  const items = presentSkills(["AD", "Active Directory", "Azure AD / Entra ID", "Entra ID", "M365", "Office 365", "Intune", "IT-"], [{ id: "tools", label: "Tools", concepts: ["Intune"] }]);
  expect(items.map(x => x.label)).toEqual(["Active Directory", "Microsoft Entra ID", "Microsoft 365", "Intune"]);
  expect(items.at(-1)?.group).toBe("tools");
});
