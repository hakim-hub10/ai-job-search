import { describe, expect, it } from "bun:test";
import { applicationErrorHeading, formatApplicationError, shouldShowApplicationError } from "./application-error-messages";
import type { StartApplicationFailureCode } from "./application-start";

const ALL_CODES: StartApplicationFailureCode[] = [
  "INVALID_INPUT",
  "CANDIDATE_NOT_FOUND",
  "CANDIDATE_STORAGE_FAILURE",
  "PROFILE_NOT_FOUND",
  "PROFILE_STORAGE_FAILURE",
  "SEARCH_FAILED",
  "JOB_NOT_FOUND",
  "APPLICATION_STORAGE_FAILURE",
  "DUPLICATE_APPLICATION",
  "APPLICATION_CREATION_FAILED",
  "APPLICATION_ASSOCIATION_FAILED",
];

describe("jobs page application-start error presentation", () => {
  it("presents a duplicate application as an informational notice, not a failure", () => {
    expect(applicationErrorHeading("DUPLICATE_APPLICATION")).toBe("Du har redan sökt jobbet");
    expect(formatApplicationError("DUPLICATE_APPLICATION")).toBe("Du har redan skapat en ansökan för det här jobbet.");
  });

  it("never leaks the raw error code into user-facing Swedish text", () => {
    for (const code of [...ALL_CODES, "SOME_UNKNOWN_CODE"]) {
      expect(formatApplicationError(code)).not.toContain(code);
      expect(applicationErrorHeading(code)).not.toContain(code);
    }
  });

  it("keeps the generic failure heading and message for every other code", () => {
    expect(applicationErrorHeading("APPLICATION_CREATION_FAILED")).toBe("Ansökan kunde inte startas");
    expect(formatApplicationError("SOME_UNKNOWN_CODE")).toBe("Ansökan kunde inte startas.");
  });

  it("has a distinct, non-empty Swedish message for every known failure code", () => {
    for (const code of ALL_CODES) {
      const message = formatApplicationError(code);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toBe("Ansökan kunde inte startas.");
    }
  });

  describe("stale duplicate-application banner suppression", () => {
    it("shows no banner when there is no error", () => {
      expect(shouldShowApplicationError("", true)).toBe(false);
      expect(shouldShowApplicationError("", false)).toBe(false);
    });
    it("always shows non-duplicate errors, regardless of the ownership check result", () => {
      expect(shouldShowApplicationError("APPLICATION_CREATION_FAILED", false)).toBe(true);
      expect(shouldShowApplicationError("SEARCH_FAILED", false)).toBe(true);
    });
    it("shows the duplicate banner only while the referenced application still exists", () => {
      expect(shouldShowApplicationError("DUPLICATE_APPLICATION", true)).toBe(true);
      expect(shouldShowApplicationError("DUPLICATE_APPLICATION", false)).toBe(false);
    });
  });
});
