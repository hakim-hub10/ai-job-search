import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { analyzeJobs, normalizeJob } from "../../../.agents/job-search/cli/src/index";
import { professionalFixture } from "../lib/professional-documents.fixture";
import { MatchConfidenceSummary } from "./match-confidence-summary";

test("the visible sparse result explains uncertainty instead of a definitive zero fit", () => {
  const { profile, job } = professionalFixture();
  const sparse = analyzeJobs(profile, [normalizeJob({ id: "sparse", source: "linkedin", title: "IT Support" })]).rankedJobs[0];
  const markup = renderToStaticMarkup(<MatchConfidenceSummary ranked={sparse} />);
  expect(sparse.score).toBe(0);
  expect(markup).toContain("Otillräckligt underlag");
  expect(markup).toContain("Det betyder inte att du saknar kompetensen");
  expect(markup).not.toContain("0/100");
  const rich = analyzeJobs(profile, [job]).rankedJobs[0];
  const richMarkup = renderToStaticMarkup(<MatchConfidenceSummary ranked={rich} />);
  expect(richMarkup).toContain(`${rich.score}/100`);
  expect(richMarkup).toContain("Underlagets täckning");
});
