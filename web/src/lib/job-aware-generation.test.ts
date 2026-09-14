import { expect, test } from "bun:test";

import { jobAwareProfile, itSupportJob, cloudEngineerJob, generateJobAwareCv, generateJobAwareCoverLetter } from "./job-aware-generation.fixture";

function technicalSkillTexts(sections: { kind: string; id: string; claims: { text: string }[] }[]): string[] {
  return sections.find((s) => s.id === "professional:technicalSkills")?.claims.map((c) => c.text) ?? [];
}

test("changing the job advertisement changes which verified technical skills are emphasized", async () => {
  const { generated: support } = await generateJobAwareCv(itSupportJob(), "sv");
  const { generated: cloud } = await generateJobAwareCv(cloudEngineerJob(), "sv");
  const supportSkills = technicalSkillTexts(support.document.sections);
  const cloudSkills = technicalSkillTexts(cloud.document.sections);
  expect(supportSkills).toContain("Active Directory");
  expect(supportSkills).toContain("Microsoft 365");
  expect(cloudSkills).toContain("Terraform");
  expect(cloudSkills).toContain("Kubernetes");
  // The two jobs must not produce an identical prioritized skill list.
  expect(supportSkills).not.toEqual(cloudSkills);
});

test("an IT-support job keeps the verified customer-service bullet and drops the least-relevant infrastructure bullet from the same role", async () => {
  const { generated } = await generateJobAwareCv(itSupportJob(), "sv");
  const experience = generated.document.sections.find((s) => s.kind === "experience")!;
  const firstRoleClaims = experience.claims.filter((c) => c.id.startsWith(`professional:profile:experience:0`));
  const text = firstRoleClaims.map((c) => c.text).join(" ");
  expect(text).toContain("kundbemötande");
  expect(text).not.toContain("nätverkskonfiguration");
});

test("a cloud job keeps the verified infrastructure/networking bullet and drops the least-relevant customer-service bullet from the same role", async () => {
  const { generated } = await generateJobAwareCv(cloudEngineerJob(), "sv");
  const experience = generated.document.sections.find((s) => s.kind === "experience")!;
  const firstRoleClaims = experience.claims.filter((c) => c.id.startsWith(`professional:profile:experience:0`));
  const text = firstRoleClaims.map((c) => c.text).join(" ");
  expect(text).toContain("nätverkskonfiguration");
  expect(text).not.toContain("kundbemötande");
});

test("transferable logistics/coordination experience is used, not discarded, for a technical role", async () => {
  const { generated } = await generateJobAwareCv(itSupportJob(), "sv");
  const experience = generated.document.sections.find((s) => s.kind === "experience")!;
  const secondRoleClaims = experience.claims.filter((c) => c.id.startsWith(`professional:profile:experience:1`));
  expect(secondRoleClaims.length).toBeGreaterThan(0);
  const text = secondRoleClaims.map((c) => c.text).join(" ");
  expect(text).toContain("Storelogik Lager AB");
  expect(text).toMatch(/problemlösning|service|kommunikation|samarbete/iu);
});

test("an unrelated job-only requirement never enters the candidate's CV", async () => {
  const unrelatedJob = { ...cloudEngineerJob(), description: `${cloudEngineerJob().description} Experience with SAP and French language required.` };
  const { generated } = await generateJobAwareCv(unrelatedJob, "sv");
  const text = generated.renderedDocument.content;
  expect(text).not.toContain("SAP");
  expect(text).not.toContain("French");
});

test("soft skills are never copied from the job advertisement without candidate evidence", async () => {
  const jobRequiringUnverifiedSoftSkill = { ...itSupportJob(), description: `${itSupportJob().description} Vi ser gärna att du har starkt ledarskap och mentorskap.` };
  const { generated } = await generateJobAwareCv(jobRequiringUnverifiedSoftSkill, "sv");
  const text = generated.renderedDocument.content;
  expect(text).not.toMatch(/ledarskap|mentorskap/iu);
});

test("CV and cover letter for the same application draw on the same underlying evidence", async () => {
  const job = itSupportJob();
  const { generated: cv } = await generateJobAwareCv(job, "sv");
  const { generated: letter } = await generateJobAwareCoverLetter(job, "sv");
  const cvEvidenceIds = new Set(cv.document.sections.flatMap((s) => s.claims.flatMap((c) => c.evidenceIds)));
  const letterEvidenceIds = new Set(letter.document.sections.flatMap((s) => s.claims.flatMap((c) => c.evidenceIds)));
  const overlap = [...letterEvidenceIds].filter((id) => cvEvidenceIds.has(id));
  expect(overlap.length).toBeGreaterThan(0);
});

test("Base CV employment descriptions are reused, capped and prioritized rather than dumped or invented", async () => {
  const { generated } = await generateJobAwareCv(itSupportJob(), "sv");
  const experience = generated.document.sections.find((s) => s.kind === "experience")!;
  const profile = jobAwareProfile();
  for (const claim of experience.claims) {
    const matches = profile.workExperience.some((e) => e.summary?.includes(claim.text) || claim.text.includes(e.title) || claim.text.includes(e.company));
    expect(matches).toBe(true);
  }
});
