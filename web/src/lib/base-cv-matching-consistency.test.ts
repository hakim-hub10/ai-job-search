import { describe, expect, it } from "bun:test";

import {
  matchProfile,
  normalizeJob,
  type MatchEvidence,
  type NormalizedJob,
} from "../../../.agents/job-search/cli/src/index";
import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import { createCandidateBaseCvFromProfile, mergeBaseCvIntoProfile } from "./candidate-base-cv";
import { unknownEvidenceLabel } from "./match-confidence";

/**
 * AUDIT FINDING (see the phase report for the full trace): job matching
 * (matchProfile / analyzeJobsForCandidate) reads CandidateProfile.skills,
 * .certifications, .languages, .workExperience, .education, .projects
 * directly. The Base CV's own copies of these exact fields are never an
 * independent source - createCandidateBaseCvFromProfile and
 * synchronizeCandidateBaseCv always derive them FROM the current profile,
 * and only headline/summary/visibility are Base-CV-specific overlays that no
 * matching dimension reads. So a technical skill, certification, language,
 * or experience entry present in the profile is already the canonical,
 * matching-visible truth - there is no separate "Base CV evidence" for these
 * fields matching could be missing. What matching MUST NOT do is let a
 * Base CV *visibility* toggle (a presentation choice for one generated
 * document) reduce what it considers verified - these tests prove hiding a
 * section in the Base CV never changes the profile-based match result, since
 * matching never consults Base CV visibility at all.
 */
const timestamp = "2026-09-14T10:00:00.000Z";

function profile(): CandidateProfile {
  return {
    headline: "IT-supporttekniker",
    targetRoles: ["IT Support"],
    locationPreferences: ["Göteborg"],
    workMode: "hybrid",
    remotePreference: true,
    preferredIndustries: [],
    preferredEmploymentType: ["full-time"],
    skills: { technical: ["Microsoft 365", "Azure", "Network"], soft: ["Troubleshooting"] },
    workExperience: [{ title: "IT-support", company: "Exempel AB", location: "Göteborg", summary: "Arbetade med support." }],
    education: [],
    certifications: [],
    languages: [{ name: "Swedish", level: "Fluent" }, { name: "English", level: "Fluent" }],
    yearsOfExperience: 2,
    careerGoals: [],
    summary: undefined,
    updatedAt: timestamp,
  };
}

function jobRequiring(skills: string[], description = ""): NormalizedJob {
  return normalizeJob({
    id: "job-x", source: "fixture", sourceId: "job-x", title: "Junior IT Technician",
    company: "Example AB", location: "Göteborg", url: "https://example.test/job-x", applyUrl: null,
    remote: "onsite", employmentType: "full-time", seniority: "entry",
    skills, description,
  });
}

function technicalSkillsEvidence(result: ReturnType<typeof matchProfile>): MatchEvidence {
  return [...result.matched, ...result.missing, ...result.conflicting, ...result.unknown].find((e) => e.dimension === "technicalSkills")!;
}
function languageEvidence(result: ReturnType<typeof matchProfile>): MatchEvidence {
  return [...result.matched, ...result.missing, ...result.conflicting, ...result.unknown].find((e) => e.dimension === "languages")!;
}
function industryEvidence(result: ReturnType<typeof matchProfile>): MatchEvidence {
  return [...result.matched, ...result.missing, ...result.conflicting, ...result.unknown].find((e) => e.dimension === "preferredIndustries")!;
}
function softSkillsEvidence(result: ReturnType<typeof matchProfile>): MatchEvidence {
  return [...result.matched, ...result.missing, ...result.conflicting, ...result.unknown].find((e) => e.dimension === "softSkills")!;
}

describe("matching correctly separates matched/missing technical skills (the manual test scenario)", () => {
  it("matches Microsoft 365 and Azure, and reports only Active Directory and Windows as missing", () => {
    const result = matchProfile(profile(), jobRequiring(["Microsoft 365", "Azure", "Active Directory", "Windows"]));
    const evidence = technicalSkillsEvidence(result);
    expect(evidence.requirementCoverage?.matchedRequirements).toEqual(["Microsoft 365", "Azure"]);
    expect(evidence.requirementCoverage?.missingRequirements).toEqual(["Active Directory", "Windows"]);
  });

  it("never confuses 'not mentioned in the job' with 'candidate missing' for a job that lists no technical skills", () => {
    const result = matchProfile(profile(), jobRequiring([]));
    expect(technicalSkillsEvidence(result).status).toBe("unknown");
  });
});

describe("hiding a Base CV section never changes the underlying profile-based match result", () => {
  it("still matches Microsoft 365 and Azure even when the Base CV hides technical skills, certifications, and experience for CV presentation", () => {
    const candidate = profile();
    const base = createCandidateBaseCvFromProfile("candidate-a", candidate, timestamp);
    if (!base.ok) throw new Error("fixture");
    base.value.visibility.technicalSkills = false;
    base.value.visibility.certifications = false;
    base.value.visibility.workExperience = false;

    // What a generated CV would show, respecting the hidden sections:
    const cvEvidenceProfile = mergeBaseCvIntoProfile(candidate, base.value);
    expect(cvEvidenceProfile.skills.technical).toEqual([]);

    // What matching evaluates - the raw profile, never affected by Base CV visibility:
    const result = matchProfile(candidate, jobRequiring(["Microsoft 365", "Azure"]));
    expect(technicalSkillsEvidence(result)).toMatchObject({ status: "matched" });
    expect(technicalSkillsEvidence(result).requirementCoverage?.matchedRequirements).toEqual(["Microsoft 365", "Azure"]);
  });

  it("documents that a Base CV cannot hold a technical skill the profile does not also have - createCandidateBaseCvFromProfile always derives skills from the current profile, so there is no independent 'Base-CV-only' competency for matching to miss", () => {
    const candidate = profile();
    const base = createCandidateBaseCvFromProfile("candidate-a", candidate, timestamp);
    if (!base.ok) throw new Error("fixture");
    expect(base.value.technicalSkills).toEqual(candidate.skills.technical);
    expect(base.value.softSkills).toEqual(candidate.skills.soft);
    expect(base.value.certifications).toEqual(candidate.certifications);
    expect(base.value.languages).toEqual(candidate.languages);
  });
});

describe("language matching", () => {
  it("does not show a language as missing when the job states no language requirement", () => {
    const result = matchProfile(profile(), jobRequiring(["Microsoft 365"]));
    expect(languageEvidence(result).status).toBe("unknown");
  });
  it("matches when the job explicitly requires Swedish and/or English and the candidate has them", () => {
    const result = matchProfile(profile(), jobRequiring(["Microsoft 365"], "Du behöver kunna svenska och engelska i rollen."));
    expect(languageEvidence(result)).toMatchObject({ status: "matched" });
  });
  it("flags a language gap only when the job requires a language the candidate does not have", () => {
    const withoutGerman: CandidateProfile = { ...profile(), languages: [{ name: "Swedish", level: "Fluent" }] };
    const result = matchProfile(withoutGerman, jobRequiring(["Microsoft 365"], "German language skills are required for this role."));
    expect(languageEvidence(result).status).not.toBe("matched");
    expect(languageEvidence(result).status).not.toBe("unknown");
  });
});

describe("industry matching never invents a fake gap", () => {
  it("reports unknown, not missing, when the job states no industry requirement", () => {
    const result = matchProfile(profile(), jobRequiring(["Microsoft 365"]));
    expect(industryEvidence(result).status).toBe("unknown");
    expect(unknownEvidenceLabel(industryEvidence(result), jobRequiring(["Microsoft 365"]))).toBe("Ingen särskild branscherfarenhet anges som krav.");
  });
});

describe("soft skill matching distinguishes unknown from missing", () => {
  it("never reports a soft skill as missing - only matched or unknown, since soft-skill extraction confidence cannot support a hard gap claim", () => {
    for (const description of ["", "We need a team player with strong communication.", "Looking for someone analytical and self-directed.", "No relevant description content here at all."]) {
      const result = matchProfile(profile(), jobRequiring(["Microsoft 365"], description));
      expect(["matched", "unknown"]).toContain(softSkillsEvidence(result).status);
    }
  });
  it("uses the uncertain-match wording, not a missing-skill wording, when the ad mentions soft skills the candidate's profile could not confirm", () => {
    const noSoftSkills: CandidateProfile = { ...profile(), skills: { technical: profile().skills.technical, soft: [] } };
    const job = jobRequiring(["Microsoft 365"], "We value strong communication and teamwork.");
    const result = matchProfile(noSoftSkills, job);
    expect(softSkillsEvidence(result).status).toBe("unknown");
    expect(unknownEvidenceLabel(softSkillsEvidence(result), job)).toBe("Annonsen nämner mjuka kompetenser som inte säkert kunde matchas mot din profil.");
  });
});

describe("realistic manual-test scenario: Junior IT Technician / IT Support", () => {
  it("separates matched, missing, and not-applicable dimensions correctly", () => {
    const job = jobRequiring(
      ["Microsoft 365", "Windows", "Active Directory"],
      "Vi söker en IT-supporttekniker med fokus på användarstöd och felsökning. Du behöver kunna Microsoft 365, Windows och Active Directory.",
    );
    const result = matchProfile(profile(), job);
    const technical = technicalSkillsEvidence(result);
    expect(technical.requirementCoverage?.matchedRequirements).toEqual(["Microsoft 365"]);
    expect(technical.requirementCoverage?.missingRequirements).toEqual(["Windows", "Active Directory"]);
    expect(languageEvidence(result).status).toBe("unknown");
    expect(industryEvidence(result).status).toBe("unknown");
  });
});
