import { describe, expect, it } from "bun:test";
import { createDefaultCandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import { parseProfileEvidence, profileCompletionIssues } from "./profile-evidence";
import { createCandidateBaseCvFromProfile, synchronizeCandidateBaseCv } from "./candidate-base-cv";

const now = "2026-09-11T10:00:00.000Z";
const source = createDefaultCandidateProfile();
const experience = { title: "Support", company: "Synthetic AB", location: "Stockholm", startDate: "2022-01", endDate: "Pågående", summary: "Handled support requests." };
const education = { degree: "YH", field: "IT", institution: "Synthetic School", startYear: 2020, endYear: 2022 };

describe("structured profile evidence", () => {
  it("creates, edits and removes work and education records through canonical validation", () => {
    const created = parseProfileEvidence(JSON.stringify({ workExperience: [experience], education: [education] }), source);
    expect(created.workExperience).toEqual([experience]);
    expect(created.education).toEqual([education]);
    const edited = parseProfileEvidence(JSON.stringify({ workExperience: [{ ...experience, title: "Senior Support" }], education: [{ ...education, endYear: 2023 }] }), created);
    expect(edited.workExperience[0]?.title).toBe("Senior Support");
    expect(edited.education[0]?.endYear).toBe(2023);
    const removed = parseProfileEvidence('{"workExperience":[],"education":[]}', edited);
    expect(removed.workExperience).toEqual([]);
    expect(removed.education).toEqual([]);
    expect(source.workExperience).not.toEqual([]);
  });

  it("rejects invented fields, malformed records and fallback headlines", () => {
    for (const input of [{ candidateId: "foreign" }, { workExperience: [{ title: "Role" }] }, { education: [{ institution: "School" }] }, { headline: "Job seeker" }]) {
      expect(() => parseProfileEvidence(JSON.stringify(input), source)).toThrow();
    }
  });

  it("synchronizes edits and removals without appending stale CV evidence", () => {
    const initial = createCandidateBaseCvFromProfile("candidate-a", source, now);
    if (!initial.ok) throw new Error("fixture");
    const next = { ...source, headline: "Support", summary: "Updated summary", workExperience: [experience], education: [education], skills: { technical: ["TypeScript"], soft: ["Communication"] }, certifications: ["AZ-900"], languages: [{ name: "Svenska", level: "C1" }] };
    const result = synchronizeCandidateBaseCv("candidate-a", next, source, initial.value, now);
    if (!result.ok) throw new Error("sync");
    expect(result.value).toMatchObject({ headline: "Support", summary: "Updated summary", workExperience: [experience], education: [education], technicalSkills: ["TypeScript"], softSkills: ["Communication"], certifications: ["AZ-900"], languages: next.languages });
    const removed = synchronizeCandidateBaseCv("candidate-a", { ...next, workExperience: [], education: [], certifications: [] }, next, result.value, now);
    expect(removed.ok && removed.value.workExperience).toEqual([]);
    expect(removed.ok && removed.value.education).toEqual([]);
    expect(removed.ok && removed.value.certifications).toEqual([]);
  });

  it("preserves custom presentation and hidden existing sections", () => {
    const initial = createCandidateBaseCvFromProfile("candidate-a", source, now);
    if (!initial.ok) throw new Error("fixture");
    initial.value.headline = "My custom headline";
    initial.value.summary = "My custom summary";
    initial.value.visibility.workExperience = false;
    const result = synchronizeCandidateBaseCv("candidate-a", { ...source, workExperience: [experience] }, source, initial.value, now);
    expect(result.ok && result.value).toMatchObject({ headline: "My custom headline", summary: "My custom summary", visibility: { workExperience: false }, workExperience: [experience] });
    expect(synchronizeCandidateBaseCv("foreign", source, source, initial.value, now).ok).toBe(false);
  });

  it("makes newly supplied evidence visible and reports incomplete baselines", () => {
    const baseline = { ...source, headline: "Job seeker", workExperience: [], education: [] };
    const initial = createCandidateBaseCvFromProfile("candidate-a", baseline, now);
    if (!initial.ok) throw new Error("fixture");
    expect(profileCompletionIssues(baseline)).toEqual(["yrkesrubrik", "arbetslivserfarenhet", "utbildning"]);
    const completed = { ...baseline, headline: "Support", workExperience: [experience], education: [education] };
    const result = synchronizeCandidateBaseCv("candidate-a", completed, baseline, initial.value, now);
    expect(result.ok && result.value.visibility).toMatchObject({ workExperience: true, education: true });
    expect(profileCompletionIssues(completed)).toEqual([]);
  });
});
