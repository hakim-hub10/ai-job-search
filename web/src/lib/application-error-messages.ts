import type { StartApplicationFailureCode } from "./application-start";

/**
 * A duplicate application is expected domain protection, not a failure - the
 * heading and message must read as informational, never expose the raw error
 * code, and point the candidate at their existing application.
 */
const DUPLICATE_APPLICATION_CODE: StartApplicationFailureCode = "DUPLICATE_APPLICATION";

export function applicationErrorHeading(code: string): string {
  return code === DUPLICATE_APPLICATION_CODE ? "Du har redan sökt jobbet" : "Ansökan kunde inte startas";
}

const APPLICATION_ERROR_MESSAGES: Record<string, string> = {
  CONFIGURATION_MISSING: "Det finns ett tekniskt problem med att skapa ansökningar just nu.",
  INVALID_INPUT: "Kandidatens eller jobbets information är ogiltig.",
  CANDIDATE_NOT_FOUND: "Den valda kandidaten kunde inte hittas.",
  CANDIDATE_STORAGE_FAILURE: "Kandidatregistret kunde inte läsas.",
  PROFILE_NOT_FOUND: "Kandidatprofil saknas för den valda kandidaten.",
  PROFILE_STORAGE_FAILURE: "Kandidatprofilen kunde inte läsas.",
  SEARCH_FAILED: "Jobbet kunde inte hämtas igen för att skapa ansökan.",
  JOB_NOT_FOUND: "Det valda jobbet kunde inte hittas i den aktuella sökningen.",
  APPLICATION_STORAGE_FAILURE: "Din ansökan kunde inte sparas just nu.",
  DUPLICATE_APPLICATION: "Du har redan skapat en ansökan för det här jobbet.",
  APPLICATION_CREATION_FAILED: "Ansökan kunde inte skapas.",
  APPLICATION_ASSOCIATION_FAILED: "Ansökan skapades, men kunde inte kopplas till kandidaten.",
};

export function formatApplicationError(code: string): string {
  return APPLICATION_ERROR_MESSAGES[code] ?? "Ansökan kunde inte startas.";
}

/**
 * A DUPLICATE_APPLICATION banner is carried entirely in the URL (redirect
 * query params), so a stale link - browser back/forward, a bookmark, a
 * lingering tab - can still point at it after the referenced application was
 * deleted. The caller must re-check live ownership of `duplicateApplicationId`
 * before rendering the banner; `duplicateApplicationStillExists` is that
 * result. Any other error code is not tied to a specific application and is
 * never considered stale by this check.
 */
export function shouldShowApplicationError(
  applicationErrorCode: string,
  duplicateApplicationStillExists: boolean,
): boolean {
  if (!applicationErrorCode) return false;
  if (applicationErrorCode !== "DUPLICATE_APPLICATION") return true;
  return duplicateApplicationStillExists;
}
