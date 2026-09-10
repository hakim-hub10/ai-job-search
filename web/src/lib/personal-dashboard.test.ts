import { describe, expect, it } from "bun:test";

import { buildPersonalDashboardModel } from "./personal-dashboard";

const profile = { headline: "Support", skills: { technical: [], soft: [] } } as never;
const application = (id: string, status: string, updatedAt: string) => ({ id, status, updatedAt, jobSnapshot: { title: `Jobb ${id}`, company: "Test" } } as never);

describe("personal dashboard model", () => {
  it("suggests creating a Base CV before job search", () => {
    const model = buildPersonalDashboardModel("candidate-a", { profile, baseCv: null, applications: [] });
    expect(model.baseCvReady).toBe(false);
    expect(model.nextAction).toEqual({ kind: "baseCv", label: "Skapa ditt grund-CV", href: "/candidates/candidate-a" });
  });

  it("suggests jobs when the profile and Base CV are ready but applications are empty", () => {
    const model = buildPersonalDashboardModel("candidate-a", { profile, baseCv: {} as never, applications: [] });
    expect(model.nextAction).toEqual({ kind: "jobs", label: "Hitta jobb", href: "/jobs" });
    expect(model.applicationCount).toBe(0);
  });

  it("limits and sorts recent applications deterministically", () => {
    const applications = Array.from({ length: 7 }, (_, index) => application(`app-${index}`, "saved", `2026-01-0${index + 1}T00:00:00.000Z`));
    const model = buildPersonalDashboardModel("candidate-a", { profile, baseCv: {} as never, applications });
    expect(model.recentApplications).toHaveLength(5);
    expect(model.recentApplications[0]?.id).toBe("app-6");
    expect(model.nextAction.href).toBe("/applications/app-6");
  });

  it("offers interview continuation only for an application with interview status", () => {
    const model = buildPersonalDashboardModel("candidate-a", { profile, baseCv: {} as never, applications: [application("app-interview", "interview", "2026-01-01T00:00:00.000Z")] });
    expect(model.interviewApplicationIds).toEqual(["app-interview"]);
    expect(model.nextAction.label).toBe("Fortsätt med din intervju");
  });
});
