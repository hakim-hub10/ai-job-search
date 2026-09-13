import { describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined }));
mock.module("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
}));
mock.module("@/lib/authorization", () => ({
  configuredAuthorizationDependencies: () => ({ ok: true, value: {} }),
  requireOwnedCandidate: async () => ({ ok: true, value: { user: { id: "user-a" }, candidate: { id: "candidate-a" } } }),
}));
mock.module("../../../../../.agents/job-search/cli/src/coach-workspace-file-repository", () => ({
  createFileCoachWorkspaceRepository: () => ({
    getCandidateById: async (id: string) => id === "candidate-a"
      ? { ok: true, value: { id, displayName: "Candidate A", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } }
      : { ok: false, error: { code: "NOT_FOUND", message: "missing candidate" } },
  }),
}));
mock.module("@/lib/candidate-base-cv-file-repository", () => ({
  createFileCandidateBaseCvRepository: () => ({
    getByCandidateId: async () => ({ ok: false, error: { code: "NOT_FOUND", message: "missing base cv" } }),
    save: async (value: unknown) => ({ ok: true, value }),
  }),
}));

let savedProfile: { targetRoles?: string[] } | undefined;
mock.module("@/lib/candidate-profiles", () => ({
  loadCandidateProfileRepository: () => ({
    configured: true as const,
    repository: {
      getProfileByCandidateId: async () => ({ ok: false as const, error: { code: "NOT_FOUND", message: "missing profile" } }),
      saveProfile: async (candidateId: string, profile: { targetRoles?: string[] }) => {
        savedProfile = profile;
        return { ok: true as const, value: { candidateId, profile } };
      },
      listProfiles: async () => ({ ok: true as const, value: [] }),
    },
  }),
}));

const { saveCandidateProfileAction } = await import("./profile-actions");

process.env.COACH_DIR = "/tmp/synthetic-profile-actions-test-unused";

function baseFormData(targetRoles: string): FormData {
  const data = new FormData();
  data.set("candidateId", "candidate-a");
  data.set("headline", "IT Support Technician");
  data.set("targetRoles", targetRoles);
  data.set("locationPreferences", "Stockholm");
  data.set("workMode", "onsite");
  data.append("preferredEmploymentType", "full-time");
  data.set("preferredIndustries", "IT");
  data.set("technicalSkills", "Windows");
  data.set("softSkills", "Communication");
  data.set("certifications", "");
  data.set("languages", "English | Native");
  data.set("yearsOfExperience", "3");
  data.set("careerGoals", "");
  return data;
}

async function savedTargetRoles(targetRoles: string): Promise<string[]> {
  savedProfile = undefined;
  await expect(saveCandidateProfileAction(baseFormData(targetRoles))).rejects.toThrow("REDIRECT:/candidates/candidate-a");
  const profile = savedProfile as { targetRoles?: string[] } | undefined;
  if (!profile) throw new Error("expected profile to have been saved");
  return profile.targetRoles ?? [];
}

describe("saveCandidateProfileAction multi-value field parsing", () => {
  it("still splits newline-separated values", async () => {
    expect(await savedTargetRoles("IT Support\nHelpdesk Technician")).toEqual(["IT Support", "Helpdesk Technician"]);
  });

  it("splits comma-separated values", async () => {
    expect(await savedTargetRoles("IT Support,Helpdesk Technician")).toEqual(["IT Support", "Helpdesk Technician"]);
  });

  it("splits values mixing commas and newlines", async () => {
    expect(await savedTargetRoles("IT Support,Helpdesk Technician\nService Desk Analyst")).toEqual([
      "IT Support",
      "Helpdesk Technician",
      "Service Desk Analyst",
    ]);
  });

  it("trims surrounding whitespace from each value", async () => {
    expect(await savedTargetRoles("  IT Support  , Helpdesk Technician \n  Service Desk Analyst  ")).toEqual([
      "IT Support",
      "Helpdesk Technician",
      "Service Desk Analyst",
    ]);
  });

  it("ignores empty entries from repeated separators", async () => {
    expect(await savedTargetRoles("IT Support,,\n\nHelpdesk Technician,")).toEqual(["IT Support", "Helpdesk Technician"]);
  });

  it("still saves a single unseparated value as one entry", async () => {
    expect(await savedTargetRoles("IT Support")).toEqual(["IT Support"]);
  });
});
