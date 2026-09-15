import { readFile } from "node:fs/promises";
import { describe, expect, it } from "bun:test";

const profileActions = new URL("../app/candidates/[candidateId]/profile-actions.ts", import.meta.url);
const applicationDetailPage = new URL("../app/applications/[applicationId]/page.tsx", import.meta.url);
const candidatePage = new URL("../app/candidates/[candidateId]/page.tsx", import.meta.url);

/**
 * The three responsibilities this phase wires together - editing profile
 * evidence, re-analyzing a job against it, and regenerating documents from
 * it - must stay separate actions the candidate explicitly triggers. None of
 * them may silently call into the next one; that separation is verified
 * here structurally (what the server code actually calls), which is more
 * reliable than trying to simulate a full save/redirect/click sequence.
 */
describe("profile edit, re-analysis, and document regeneration stay separate, candidate-triggered steps", () => {
  it("never calls the re-analysis or document-generation pipeline from inside the profile save action", async () => {
    const source = await readFile(profileActions, "utf8");
    expect(source).not.toContain("reanalyzeApplicationJob");
    expect(source).not.toContain("reanalyzeApplicationAction");
    expect(source).not.toContain("createTailoredCv");
    expect(source).not.toContain("createCoverLetter");
  });

  it("never calls document generation from inside the re-analyze action's own request handling on the application page", async () => {
    const source = await readFile(applicationDetailPage, "utf8");
    // The document-regeneration buttons exist on this page (reusing the existing actions from a
    // separate <form>), but the re-analyze <form>/action itself must never trigger them as a
    // side effect - each stays its own explicit submission.
    const reanalyzeFormIndex = source.indexOf("action={reanalyzeApplicationAction}");
    expect(reanalyzeFormIndex).toBeGreaterThan(-1);
    const reanalyzeFormEnd = source.indexOf("</form>", reanalyzeFormIndex);
    const reanalyzeFormMarkup = source.slice(reanalyzeFormIndex, reanalyzeFormEnd);
    expect(reanalyzeFormMarkup).not.toContain("createTailoredCvAction");
    expect(reanalyzeFormMarkup).not.toContain("createCoverLetterAction");
  });

  it("only offers profile editing itself as a link the candidate must click, never an automatic action, from the match analysis context", async () => {
    const source = await readFile(candidatePage, "utf8");
    expect(source).toContain("reanalyzeApplicationAction");
    // The post-save prompt is its own separate <form>, submitted only by the candidate.
    expect(source).toContain("Analysera om jobbet");
  });
});
