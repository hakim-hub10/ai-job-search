import { describe, expect, it } from "bun:test";
import { createDefaultCandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import { parseProfileEvidence } from "./profile-evidence";

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
});
