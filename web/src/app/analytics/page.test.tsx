import { describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let portfolioResult: { configured: boolean; error: null; analytics: unknown } = { configured: true, error: null, analytics: null };
mock.module("@/lib/analytics", () => ({
  loadCoachPortfolioAnalytics: async () => portfolioResult,
  loadJobSearchAnalytics: async () => ({ configured: true, error: null, analytics: null }),
  parseAnalyticsPeriod: () => ({ ok: true, value: { start: "2026-01-01", end: "2027-01-01", asOf: "2027-01-01" } }),
}));
mock.module("@/lib/coach-candidates", () => ({
  loadCoachCandidates: async () => ({ configured: true, error: null, candidates: [] }),
}));
mock.module("@/lib/auth-session", () => ({
  getAuthenticatedUser: async () => null,
}));
mock.module("@/lib/authorization", () => ({
  configuredAuthorizationDependencies: () => ({ ok: true, value: {} }),
  getAuthorizedCandidateContext: async () => ({ ok: false, error: { code: "UNAUTHENTICATED", message: "synthetic" } }),
}));
const { default: AnalyticsPage } = await import("./page");
const metric = (numerator: number, denominator: number, rate: number | null) => ({ numerator, denominator, rate });

const analytics = {
  period: { startAt: "2026-01-01T00:00:00.000Z", endAt: "2027-01-01T00:00:00.000Z", endExclusive: true as const },
  asOf: "2027-01-01T00:00:00.000Z",
  candidates: { total: 1, withApplications: 1, withFollowUps: 0, withCoachActivities: 0 },
  applications: { total: 4, reachedApplied: 3, reachedInterview: 2, reachedOffer: 1, rejected: 1, withdrawn: 1, closed: 1,
    funnel: { applicationToApplied: metric(3, 4, 0.75), appliedToInterview: metric(2, 3, 2 / 3), interviewToOffer: metric(1, 2, 0.5) } },
  followUps: { total: 0, completed: 0, incomplete: 0, stateAsOf: { total: 0, open: 0, overdue: 0, completed: 0 }, completionTiming: { createdToCompletion: { count: 0, totalMilliseconds: 0, averageMilliseconds: null }, dueDateDelta: { count: 0, totalMilliseconds: 0, averageMilliseconds: null } } },
  coachActivities: { total: 0, planned: 0, completed: 0, cancelled: 0, stateAsOf: { total: 0, planned: 0, completed: 0, cancelled: 0 }, byKind: {}, completionTiming: { createdToCompletion: { count: 0, totalMilliseconds: 0, averageMilliseconds: null }, plannedToCompletion: { count: 0, totalMilliseconds: 0, averageMilliseconds: null } } },
  applicationTiming: { timeToApplied: { count: 0, totalMilliseconds: 0, averageMilliseconds: null }, timeToInterview: { count: 0, totalMilliseconds: 0, averageMilliseconds: null }, timeToOffer: { count: 0, totalMilliseconds: 0, averageMilliseconds: null } },
};

describe("analytics funnel presentation", () => {
  it("renders historical funnel counts and rates with factual Swedish labels", async () => {
    portfolioResult = { configured: true, error: null, analytics };
    const html = renderToStaticMarkup(await AnalyticsPage({ searchParams: Promise.resolve({}) }));
    for (const text of ["Totalt antal ansökningar", "Nådde ansökt", "Nådde intervju", "Nådde erbjudande", "Ansökan → ansökt", "Ansökt → intervju", "Intervju → erbjudande", "75.0%", "66.7%", "50.0%"]) expect(html).toContain(text);
    expect(html).not.toMatch(/sannolikhet|chans att få jobbet|anställningsbarhet|kandidatkvalitet|ranking|poäng/i);
  });
  it("renders zero-denominator rates as unavailable rather than zero percent", async () => {
    const empty = structuredClone(analytics); empty.applications.total = 0; empty.applications.reachedApplied = 0; empty.applications.reachedInterview = 0; empty.applications.reachedOffer = 0; empty.applications.funnel.applicationToApplied = metric(0, 0, null); empty.applications.funnel.appliedToInterview = metric(0, 0, null); empty.applications.funnel.interviewToOffer = metric(0, 0, null);
    portfolioResult = { configured: true, error: null, analytics: { ...empty } };
    const html = renderToStaticMarkup(await AnalyticsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Totalt antal ansökningar"); expect(html).not.toContain("0.0%"); expect(html).toContain("—");
  });
});
