import { profileCompletionIssues } from "./profile-evidence";
import type { ApplicationRecord } from "../../../.agents/job-search/cli/src/applications";
import type { CandidateBaseCv } from "./candidate-base-cv";
import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";

export interface PersonalDashboardInput {
  profile: CandidateProfile;
  baseCv: CandidateBaseCv | null;
  applications: ApplicationRecord[];
}

export type PersonalDashboardAction =
  | { kind: "profile"; label: string; href: string }
  | { kind: "baseCv"; label: string; href: string }
  | { kind: "jobs"; label: string; href: "/jobs" }
  | { kind: "application"; label: string; href: string };

export interface PersonalDashboardModel {
  profileReady: boolean;
  baseCvReady: boolean;
  applicationCount: number;
  recentApplications: ApplicationRecord[];
  nextAction: PersonalDashboardAction;
  interviewApplicationIds: string[];
}

function applicationTime(application: ApplicationRecord): number {
  const value = Date.parse(application.updatedAt);
  return Number.isNaN(value) ? 0 : value;
}

export function buildPersonalDashboardModel(
  candidateId: string,
  input: PersonalDashboardInput,
): PersonalDashboardModel {
  const recentApplications = [...input.applications]
    .sort((left, right) => applicationTime(right) - applicationTime(left))
    .slice(0, 5);
  const interviewApplications = input.applications
    .filter((application) => application.status === "interview")
    .sort((left, right) => applicationTime(right) - applicationTime(left));

  const profileReady = profileCompletionIssues(input.profile).length === 0;
  const baseCvReady = Boolean(input.baseCv && profileCompletionIssues(input.baseCv).length === 0);
  let nextAction: PersonalDashboardAction;
  if (!profileReady) {
    nextAction = { kind: "profile", label: "Komplettera din profil", href: `/candidates/${encodeURIComponent(candidateId)}#profile-editor` };
  } else if (!input.baseCv) {
    nextAction = {
      kind: "baseCv",
      label: "Skapa ditt grund-CV",
      href: `/candidates/${encodeURIComponent(candidateId)}`,
    };
  } else if (input.applications.length === 0) {
    nextAction = { kind: "jobs", label: "Hitta jobb", href: "/jobs" };
  } else {
    const application = recentApplications[0]!;
    nextAction = {
      kind: "application",
      label: application.status === "interview" ? "Fortsätt med din intervju" : "Fortsätt med din ansökan",
      href: `/applications/${encodeURIComponent(application.id)}`,
    };
  }

  return {
    profileReady,
    baseCvReady,
    applicationCount: input.applications.length,
    recentApplications,
    nextAction,
    interviewApplicationIds: interviewApplications.map((application) => application.id),
  };
}
