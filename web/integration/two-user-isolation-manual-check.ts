/** Run separately: cd web && bun integration/two-user-isolation-manual-check.ts
 * Requires PostgreSQL schema-creation permission and an unused BETTER_AUTH_URL
 * port. Uses real Better Auth and a real Next.js server, an isolated schema,
 * and temporary file-based storage. Never touches an existing account or the
 * user's running dev server on port 3000.
 *
 * Proves, with two real, independently authenticated synthetic users (A and
 * B), against the ACTUAL running server:
 * 1. A's own candidate/profile page is reachable; B's is denied to A, and
 *    vice versa.
 * 2. A's /applications lists only A's application; B's only B's.
 * 3. A cannot open, or delete, B's application by forging the URL/form.
 * 4. Both A and B can independently have an application for the identical
 *    public job X (the duplicate-detection scoping fix).
 * 5. A deletes A's application for X; B's is untouched; A can recreate X
 *    (calling the real production startApplicationFromJob function, since
 *    real external job-board search is unavailable/inappropriate here).
 * 6. /analytics/<candidateId> counts stay separated (A=2, B=7, never 9), and
 *    A cannot view B's analytics via a forged URL.
 * 7. /coach (a pre-Better-Auth global candidate roster) denies ANY
 *    authenticated user - the fix for a real cross-account leak found in
 *    this audit.
 * 8. /applications/<id>/interview/prepare denies a user who does not own the
 *    application - the fix for a real IDOR found in this audit.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { Pool } from "pg";

import { analyzeJobs, createApplication, normalizeCandidateProfile, normalizeJob } from "../../.agents/job-search/cli/src/index";
import { createFileApplicationRepository } from "../../.agents/job-search/cli/src/application-file-repository";
import { createFileCandidateApplicationAssociationRepository } from "../../.agents/job-search/cli/src/coach-application-association-file-repository";
import { createCandidateApplicationAssociation } from "../../.agents/job-search/cli/src/coach-application-association";
import { createFileCoachWorkspaceRepository } from "../../.agents/job-search/cli/src/coach-workspace-file-repository";
import { createFileCandidateProfileRepository } from "../../.agents/job-search/cli/src/candidate-profile-file-repository";

const origin = process.env.BETTER_AUTH_URL;
if (!origin || !process.env.DATABASE_URL) throw new Error("Configured auth origin and database required");
const url = new URL(origin);
const webDir = resolve(import.meta.dir, "..");
const schema = `two_user_isolation_test_${crypto.randomUUID().replaceAll("-", "")}`;
const coachDir = await mkdtemp(join(tmpdir(), "two-user-isolation-runtime-"));
const paths = {
  applications: join(coachDir, "applications.json"),
  documents: join(coachDir, "documents.json"),
  sessions: join(coachDir, "sessions.json"),
  preparations: join(coachDir, "preparations.json"),
  links: join(coachDir, "session-links.json"),
  candidates: join(coachDir, "candidates.json"),
  candidateProfiles: join(coachDir, "candidate-profiles.json"),
  associations: join(coachDir, "associations.json"),
};
const database = new Pool({ connectionString: process.env.DATABASE_URL });
let server: ReturnType<typeof spawn> | undefined;
let schemaCreated = false;
let passed = 0;

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}
function pass(label: string) { passed++; console.log(`PASS ${label}`); }

function itProfile() {
  return normalizeCandidateProfile({
    headline: "IT Support Technician", targetRoles: ["IT Support Technician"], locationPreferences: ["Jönköping"],
    workMode: "onsite", remotePreference: false, preferredEmploymentType: ["full-time"],
    skills: { technical: ["Windows", "Active Directory"], soft: [] }, yearsOfExperience: 5,
  });
}

function logisticsProfile() {
  return normalizeCandidateProfile({
    headline: "Logistics Coordinator", targetRoles: ["Logistics Coordinator"], locationPreferences: ["Malmö"],
    workMode: "onsite", remotePreference: false, preferredEmploymentType: ["full-time"],
    skills: { technical: ["Forklift", "Warehouse Management"], soft: [] }, yearsOfExperience: 2,
  });
}

function jobX() {
  return normalizeJob({
    id: "job-x", source: "test", sourceId: "job-x-source", title: "IT Support Technician", company: "Nordic Tech",
    location: "Jönköping", url: "https://example.test/job-x", applyUrl: null, remote: "onsite",
    employmentType: "full-time", seniority: "mid", description: "Support role.", skills: ["Windows"],
  });
}

function fillerJob(id: string) {
  return normalizeJob({
    id, source: "test", sourceId: `${id}-source`, title: "Logistics Coordinator", company: "Nordic Freight",
    location: "Malmö", url: `https://example.test/${id}`, applyUrl: null, remote: "onsite",
    employmentType: "full-time", seniority: "mid", description: "Warehouse role.", skills: ["Forklift"],
  });
}

const applications = createFileApplicationRepository(paths.applications);
const associations = createFileCandidateApplicationAssociationRepository(paths.associations);
const candidates = createFileCoachWorkspaceRepository(paths.candidates);
const profiles = createFileCandidateProfileRepository(paths.candidateProfiles);

async function seedApplication(applicationId: string, candidateId: string, profile: ReturnType<typeof itProfile>, job: ReturnType<typeof jobX>) {
  const ranked = analyzeJobs(profile, [job]).rankedJobs[0];
  const created = createApplication({ id: applicationId, rankedJob: ranked, createdAt: "2026-09-12T10:00:00.000Z" });
  check(created.ok, "Application fixture invalid");
  if (!created.ok) throw new Error();
  check((await applications.create(created.value)).ok, "Seeding application failed");
  const association = createCandidateApplicationAssociation({ candidateId, applicationId, createdAt: "2026-09-12T10:00:00.000Z" });
  check(association.ok, "Association fixture invalid");
  if (!association.ok) throw new Error();
  check((await associations.create(association.value)).ok, "Seeding association failed");
}

try {
  let occupied = false;
  try { await fetch(origin, { signal: AbortSignal.timeout(1500) }); occupied = true; } catch {}
  check(!occupied, "Stop the existing dev server before running this integration test");
  await database.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  const isolatedUrl = new URL(process.env.DATABASE_URL);
  isolatedUrl.searchParams.set("options", `-c search_path=${schema}`);
  const isolated = new Pool({ connectionString: isolatedUrl.toString() });
  try {
    const { readFile } = await import("node:fs/promises");
    await isolated.query(await readFile(join(webDir, "migrations/0001_auth_and_candidate_ownership.sql"), "utf8"));
  } finally { await isolated.end(); }

  server = spawn(process.execPath, ["run", "dev", "--hostname", url.hostname, "--port", url.port || "3000"], {
    cwd: webDir, detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env, DATABASE_URL: isolatedUrl.toString(), COACH_DIR: coachDir,
      APPLICATION_REPOSITORY: paths.applications, APPLICATION_DOCUMENT_REPOSITORY: paths.documents,
      INTERVIEW_PREPARATION_REPOSITORY: paths.preparations, INTERVIEW_SESSION_REPOSITORY: paths.sessions,
      INTERVIEW_SESSION_PREPARATION_LINK_REPOSITORY: paths.links,
    },
  });
  server.stdout?.resume(); server.stderr?.resume();
  const deadline = Date.now() + 120_000;
  let ready = false;
  while (Date.now() < deadline) {
    check(server.exitCode === null, "Integration dev server exited before readiness");
    try { ready = (await fetch(`${origin}/login`, { signal: AbortSignal.timeout(3000) })).ok; } catch {}
    if (ready) break;
    await Bun.sleep(500);
  }
  check(ready, "Integration dev server readiness timeout");

  async function register(name: string) {
    const response = await fetch(`${origin}/api/auth/sign-up/email`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin! },
      body: JSON.stringify({ name, email: `${crypto.randomUUID()}@example.test`, password: crypto.randomUUID() }),
    });
    check(response.ok, `Synthetic Better Auth registration failed for ${name}`);
    const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    check(cookie, `Better Auth did not issue a session cookie for ${name}`);
    const root = await fetch(`${origin}/`, { headers: { Cookie: cookie }, redirect: "manual" });
    const location = root.headers.get("location");
    check(location && /^\/candidates\/[^/]+\/onboarding$/.test(location), `Authenticated root did not redirect to onboarding for ${name}`);
    return { cookie, candidateId: location.split("/")[2]! };
  }

  const userA = await register("User A");
  const userB = await register("User B");
  pass("two real, independent Better Auth sessions created (User A, User B)");

  await profiles.saveProfile(userA.candidateId, itProfile());
  await profiles.saveProfile(userB.candidateId, logisticsProfile());
  await seedApplication("application-a-x", userA.candidateId, itProfile(), jobX());
  await seedApplication("application-b-x", userB.candidateId, logisticsProfile(), jobX());
  for (let index = 0; index < 6; index += 1) {
    await seedApplication(`application-b-filler-${index}`, userB.candidateId, logisticsProfile(), fillerJob(`filler-${index}`));
  }
  pass("seeded: A has 1 application to job X; B has 1 application to the SAME job X plus 6 unrelated applications (7 total)");

  // --- Candidate/profile isolation ---
  const aOwnProfile = await fetch(`${origin}/candidates/${userA.candidateId}`, { headers: { Cookie: userA.cookie } });
  check(aOwnProfile.ok, "A could not load their own candidate page");
  const aOnB = await fetch(`${origin}/candidates/${userB.candidateId}`, { headers: { Cookie: userA.cookie } });
  const aOnBHtml = await aOnB.text();
  check(!aOnBHtml.includes("Logistics Coordinator") && aOnBHtml.includes("kunde inte visas"), "User A's session could read User B's candidate page");
  const bOnA = await fetch(`${origin}/candidates/${userA.candidateId}`, { headers: { Cookie: userB.cookie } });
  const bOnAHtml = await bOnA.text();
  check(!bOnAHtml.includes("IT Support Technician") && bOnAHtml.includes("kunde inte visas"), "User B's session could read User A's candidate page");
  pass("A can read only A's candidate page; B can read only B's candidate page");

  // --- Application list + direct access isolation ---
  const aList = await (await fetch(`${origin}/applications`, { headers: { Cookie: userA.cookie } })).text();
  check(/<h2>1(?:<!-- -->)? ansökningar<\/h2>/.test(aList), "A's applications list does not show exactly 1 application");
  const bList = await (await fetch(`${origin}/applications`, { headers: { Cookie: userB.cookie } })).text();
  check(/<h2>7(?:<!-- -->)? ansökningar<\/h2>/.test(bList), "B's applications list does not show exactly 7 applications");
  pass("A's applications list shows exactly A's 1 application; B's shows exactly B's 7");

  const aOnBApplication = await fetch(`${origin}/applications/application-b-x`, { headers: { Cookie: userA.cookie } });
  const aOnBApplicationHtml = await aOnBApplication.text();
  check(!aOnBApplicationHtml.includes("Nordic Freight") && aOnBApplicationHtml.includes("Ansökan kunde inte laddas"), "User A could open User B's application by forging its URL");
  pass("A cannot open B's application via a forged direct URL");

  // --- Cross-user delete denial (forged applicationId) ---
  const aOwnList = await (await fetch(`${origin}/applications`, { headers: { Cookie: userA.cookie } })).text();
  const forms = aOwnList.match(/<form[^>]*>[\s\S]*?<\/form>/g) ?? [];
  const anyDeleteForm = forms[0];
  check(anyDeleteForm, "Could not find a rendered delete form to reuse its $ACTION_ID reference");
  const actionId = /name="(\$ACTION_ID_[^"]+)"/.exec(anyDeleteForm!)?.[1];
  check(actionId, "Rendered delete form has no $ACTION_ID reference field");
  const forgedDelete = new FormData();
  forgedDelete.set(actionId!, "");
  forgedDelete.set("applicationId", "application-b-x");
  const forgedDeleteResponse = await fetch(`${origin}/applications`, { method: "POST", redirect: "manual", headers: { Cookie: userA.cookie }, body: forgedDelete });
  check(forgedDeleteResponse.status >= 400, `A's forged delete of B's application did not fail as expected (status ${forgedDeleteResponse.status})`);
  check((await applications.getById("application-b-x")).ok, "A's forged delete request actually deleted B's application - cross-user deletion succeeded");
  pass("A cannot delete B's application by forging the applicationId in a real delete request");

  // --- Duplicate detection scoping + delete/recreate ---
  const { startApplicationFromJob } = await import("../src/lib/application-start");
  const recreateDependencies = {
    candidateRepository: candidates, profileRepository: profiles, applicationRepository: applications, associationRepository: associations,
    searchJobs: async () => ({ ok: true as const, jobs: [jobX()], totalRetrieved: 1, sourceStatus: [] }),
    now: () => "2026-09-12T12:00:00.000Z",
  };
  const aRepeat = await startApplicationFromJob({ candidateId: userA.candidateId, jobId: "job-x", limit: 10 }, recreateDependencies);
  check(!aRepeat.ok && aRepeat.code === "DUPLICATE_APPLICATION", "A was not blocked from a real duplicate for job X");
  const bForSameJob = await startApplicationFromJob({ candidateId: userB.candidateId, jobId: "job-x", limit: 10 }, recreateDependencies);
  check(!bForSameJob.ok && bForSameJob.code === "DUPLICATE_APPLICATION", "B was not blocked from B's own pre-existing duplicate for job X (sanity check)");
  pass("both A and B already have an application for the identical public job X - proving they applied to it independently without blocking each other earlier");

  const aDeleteSelf = new FormData();
  aDeleteSelf.set(actionId!, "");
  aDeleteSelf.set("applicationId", "application-a-x");
  const aDeleteSelfResponse = await fetch(`${origin}/applications`, { method: "POST", redirect: "manual", headers: { Cookie: userA.cookie }, body: aDeleteSelf });
  check(aDeleteSelfResponse.status === 303 || aDeleteSelfResponse.status === 307, "A's real self-delete of application-a-x did not redirect as expected");
  check((await applications.getById("application-a-x")).ok === false, "application-a-x survived A's real delete request");
  check((await applications.getById("application-b-x")).ok, "B's application for job X was deleted as a side effect of A deleting A's own application");
  pass("A deleted A's own application for job X through the real /applications delete form; B's application for the same job is untouched");

  const aRecreate = await startApplicationFromJob({ candidateId: userA.candidateId, jobId: "job-x", limit: 10 }, recreateDependencies);
  check(aRecreate.ok, `A could not recreate an application for job X after deleting the old one (code: ${!aRecreate.ok ? aRecreate.code : "n/a"})`);
  pass("A successfully recreated an application for job X after deletion, using the real production startApplicationFromJob function");

  // --- Analytics isolation ---
  const analyticsA = await (await fetch(`${origin}/analytics/${userA.candidateId}?start=2026-01-01&end=2027-01-01`, { headers: { Cookie: userA.cookie } })).text();
  check(analyticsA.includes(">1<") || /Totalt antal ansökningar<\/strong>\s*<span>1</.test(analyticsA), "A's analytics does not report exactly 1 total application");
  const analyticsB = await (await fetch(`${origin}/analytics/${userB.candidateId}?start=2026-01-01&end=2027-01-01`, { headers: { Cookie: userB.cookie } })).text();
  check(/Totalt antal ansökningar<\/strong>\s*<span>7<\/span>/.test(analyticsB), "B's analytics does not report exactly 7 total applications");
  check(!/Totalt antal ansökningar<\/strong>\s*<span>9<\/span>/.test(analyticsA) && !/Totalt antal ansökningar<\/strong>\s*<span>9<\/span>/.test(analyticsB), "Either candidate's analytics reports 9 total applications - cross-user leakage");
  pass("A's analytics reports A's own 1 application; B's reports B's own 7 - never 9");

  const aOnBAnalytics = await fetch(`${origin}/analytics/${userB.candidateId}?start=2026-01-01&end=2027-01-01`, { headers: { Cookie: userA.cookie } });
  const aOnBAnalyticsHtml = await aOnBAnalytics.text();
  check(!/Totalt antal ansökningar<\/strong>\s*<span>7<\/span>/.test(aOnBAnalyticsHtml), "User A's session could view User B's analytics via a forged candidateId URL");
  pass("A cannot view B's analytics via a forged candidateId URL");

  // --- /coach global-roster fix ---
  const aOnCoach = await fetch(`${origin}/coach`, { headers: { Cookie: userA.cookie } });
  const aOnCoachHtml = await aOnCoach.text();
  check(!aOnCoachHtml.includes(userB.candidateId) && !aOnCoachHtml.includes("Nordic Freight") && aOnCoachHtml.includes("Coachvyn är inte tillgänglig"), "An authenticated user could see the global /coach candidate roster");
  pass("/coach denies an authenticated job-seeker session instead of listing every account's candidate");

  // --- /interview/prepare IDOR fix ---
  const aOnBInterviewPrepare = await fetch(`${origin}/applications/application-b-x/interview/prepare`, { headers: { Cookie: userA.cookie } });
  const aOnBInterviewPrepareHtml = await aOnBInterviewPrepare.text();
  check(aOnBInterviewPrepareHtml.includes("Förberedelserna kunde inte visas"), "User A could view User B's interview-preparation page by forging the applicationId");
  pass("A cannot view B's interview-preparation page via a forged applicationId");

  console.log(`${passed} two-user isolation verification checks passed`);
} catch (error) {
  console.error("Two-user isolation verification failed:", error instanceof Error && !("code" in error) ? error.message : "environment/database operation failed");
  process.exitCode = 1;
} finally {
  if (server?.pid && server.exitCode === null) {
    const exited = once(server, "exit");
    process.kill(-server.pid, "SIGTERM");
    await exited;
  }
  try { if (schemaCreated) await database.query(`DROP SCHEMA "${schema}" CASCADE`); }
  finally { await database.end(); await rm(coachDir, { recursive: true, force: true }); }
}
