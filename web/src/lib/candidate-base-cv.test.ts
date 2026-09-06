import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import type { CandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-repository";
import type { CoachWorkspaceRepository } from "../../../.agents/job-search/cli/src/coach-workspace-repository";
import type { CandidateBaseCvRepository } from "./candidate-base-cv-repository";
import {
  createCandidateBaseCvFromProfile,
  updateCandidateBaseCvPresentation,
} from "./candidate-base-cv";
import { createFileCandidateBaseCvRepository } from "./candidate-base-cv-file-repository";
import { readCandidateBaseCvState } from "./candidate-base-cv-state";

const timestamp = "2026-09-06T10:00:00.000Z";

function profile(): CandidateProfile {
  return {
    headline: "IT-supporttekniker",
    targetRoles: ["IT Support"],
    locationPreferences: ["Jönköping"],
    workMode: "onsite",
    remotePreference: false,
    preferredIndustries: ["IT"],
    preferredEmploymentType: ["full-time"],
    skills: { technical: ["Microsoft 365"], soft: ["Kommunikation"] },
    workExperience: [{ title: "Supporttekniker", company: "Exempel AB", location: "Jönköping", summary: "Arbetade med support." }],
    education: [{ degree: "YH", field: "IT", institution: "Exempelskolan" }],
    certifications: ["AZ-900"],
    languages: [{ name: "Svenska", level: "Professionell" }],
    yearsOfExperience: 3,
    careerGoals: ["Fördjupa mig inom support"],
    summary: "Erfaren supporttekniker.",
    updatedAt: timestamp,
  };
}

async function repositoryFixture() {
  const directory = await mkdtemp(join(tmpdir(), "candidate-base-cv-"));
  const repository = createFileCandidateBaseCvRepository(join(directory, "candidate-cvs.json"));
  return { directory, repository };
}

describe("candidate Base CV domain and repository", () => {
  it("initializes only from explicit profile facts and preserves missing data", () => {
    const source = profile();
    const created = createCandidateBaseCvFromProfile("candidate-a", source, timestamp);

    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error.message);
    expect(created.value).toMatchObject({
      candidateId: "candidate-a",
      source: "candidateProfile",
      headline: "IT-supporttekniker",
      summary: "Erfaren supporttekniker.",
      technicalSkills: ["Microsoft 365"],
      certifications: ["AZ-900"],
    });
    expect(created.value.workExperience).toHaveLength(1);
    expect(created.value).not.toHaveProperty("projects");
  });

  it("supports presentation edits without changing factual sections", () => {
    const created = createCandidateBaseCvFromProfile("candidate-a", profile(), timestamp);
    if (!created.ok) throw new Error(created.error.message);
    const updated = updateCandidateBaseCvPresentation(created.value, {
      headline: "Support och kundservice",
      summary: "Kort redigerad presentation.",
      visibility: { ...created.value.visibility, certifications: false },
      updatedAt: "2026-09-06T11:00:00.000Z",
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error(updated.error.message);
    expect(updated.value.headline).toBe("Support och kundservice");
    expect(updated.value.certifications).toEqual(["AZ-900"]);
    expect(updated.value.visibility.certifications).toBe(false);
    expect(updated.value.candidateId).toBe("candidate-a");
  });

  it("persists, reloads, updates by candidateId, and isolates candidates", async () => {
    const fixture = await repositoryFixture();
    try {
      const created = createCandidateBaseCvFromProfile("candidate-a", profile(), timestamp);
      if (!created.ok) throw new Error(created.error.message);
      await expect(fixture.repository.save(created.value)).resolves.toMatchObject({ ok: true });
      await expect(fixture.repository.getByCandidateId("candidate-a")).resolves.toMatchObject({ ok: true, value: { candidateId: "candidate-a" } });
      await expect(fixture.repository.getByCandidateId("candidate-b")).resolves.toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });

      const updated = updateCandidateBaseCvPresentation(created.value, {
        headline: "Ny rubrik",
        summary: "",
        visibility: created.value.visibility,
        updatedAt: "2026-09-06T11:00:00.000Z",
      });
      if (!updated.ok) throw new Error(updated.error.message);
      await fixture.repository.save(updated.value);
      const loaded = await fixture.repository.getByCandidateId("candidate-a");
      expect(loaded).toMatchObject({ ok: true, value: { headline: "Ny rubrik" } });
      if (loaded.ok) expect(loaded.value.summary).toBeUndefined();
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("fails closed for corrupt storage", async () => {
    const fixture = await repositoryFixture();
    try {
      await writeFile(join(fixture.directory, "candidate-cvs.json"), "{broken", "utf8");
      await expect(fixture.repository.getByCandidateId("candidate-a")).resolves.toMatchObject({ ok: false, error: { code: "CORRUPT_STORAGE" } });
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });
});

describe("candidate Base CV state boundary", () => {
  function dependencies(profileResult: Awaited<ReturnType<CandidateProfileRepository["getProfileByCandidateId"]>> = { ok: true, value: { candidateId: "candidate-a", profile: profile() } }): Parameters<typeof readCandidateBaseCvState>[1] {
    return {
      candidateRepository: {
        async createCandidate() { throw new Error("not used"); },
        async getCandidateById(id) {
          return id === "candidate-a"
            ? { ok: true, value: { id, displayName: "Candidate A", createdAt: timestamp } }
            : { ok: false, error: { code: "NOT_FOUND", message: "missing" } };
        },
        async listCandidates() { return { ok: true, value: [] }; },
      } as CoachWorkspaceRepository,
      profileRepository: {
        async saveProfile() { throw new Error("not used"); },
        async getProfileByCandidateId() { return profileResult; },
        async listProfiles() { return { ok: true, value: [] }; },
      } as CandidateProfileRepository,
      baseCvRepository: {
        async save() { throw new Error("not used"); },
        async getByCandidateId() { return { ok: false, error: { code: "NOT_FOUND", message: "missing" } }; },
      } as CandidateBaseCvRepository,
    };
  }

  it("returns explicit missing-profile and invalid-candidate states", async () => {
    await expect(readCandidateBaseCvState(" ", dependencies())).resolves.toMatchObject({ ok: false, code: "INVALID_CANDIDATE_ID" });
    await expect(readCandidateBaseCvState("candidate-a", dependencies({ ok: false, error: { code: "NOT_FOUND", message: "missing" } }))).resolves.toMatchObject({ ok: false, code: "PROFILE_NOT_FOUND" });
    await expect(readCandidateBaseCvState("candidate-b", dependencies())).resolves.toMatchObject({ ok: false, code: "CANDIDATE_NOT_FOUND" });
  });
});
