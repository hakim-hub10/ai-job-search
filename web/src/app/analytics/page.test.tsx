import { describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let authenticated = false;
mock.module("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
  useRouter: () => ({ push() {}, refresh() {} }),
}));
mock.module("@/lib/authorization", () => ({
  configuredAuthorizationDependencies: () => ({ ok: true, value: {} }),
  getAuthorizedCandidateContext: async () => authenticated
    ? { ok: true, value: { candidate: { id: "owned-candidate" } } }
    : { ok: false, error: { code: "UNAUTHENTICATED" } },
}));
const { default: AnalyticsPage } = await import("./page");
const { default: ReportsPage } = await import("../reports/page");

describe("personal analytics/report entry authorization", () => {
  it("denies unauthenticated portfolio access", async () => {
    authenticated = false;
    for (const Page of [AnalyticsPage, ReportsPage]) {
      const html = renderToStaticMarkup(await Page());
      expect(html).toContain("Logga in");
      expect(html).not.toContain("Totalt antal kandidater");
    }
  });
  it("redirects only to the server-resolved owned Candidate", async () => {
    authenticated = true;
    await expect(AnalyticsPage()).rejects.toThrow("REDIRECT:/analytics/owned-candidate");
    await expect(ReportsPage()).rejects.toThrow("REDIRECT:/reports/owned-candidate");
    authenticated = false;
  });
});
