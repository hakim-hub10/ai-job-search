/** Run separately: cd web && bun integration/duplicate-banner-manual-check.ts
 * Requires PostgreSQL schema-creation permission and an unused BETTER_AUTH_URL
 * port. Uses real Better Auth and a real Next.js server, an isolated schema,
 * and temporary file-based application storage. Never touches an existing
 * account or the user's running dev server on port 3000.
 *
 * Verifies, against the ACTUAL rendered /jobs page (not just unit tests):
 * 1. A DUPLICATE_APPLICATION banner renders while the referenced application
 *    still exists (sanity: the live check must not false-negative).
 * 2. After the application is deleted (via a real, no-JS-style form POST -
 *    exactly how the rendered delete <form> degrades), revisiting the exact
 *    same stale /jobs URL no longer shows the obsolete duplicate warning.
 * 3. A foreign candidate visiting a URL referencing someone else's
 *    application never sees the banner either (ownership is re-checked, not
 *    just existence).
 * Real job search (external network job boards) is intentionally not
 * exercised here - the underlying create -> duplicate -> delete -> recreate
 * lifecycle for startApplicationFromJob is proven separately, with real file
 * repositories, in web/src/lib/application-start-deletion.test.ts.
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

const origin = process.env.BETTER_AUTH_URL;
if (!origin || !process.env.DATABASE_URL) throw new Error("Configured auth origin and database required");
const url = new URL(origin);
const webDir = resolve(import.meta.dir, "..");
const schema = `duplicate_banner_test_${crypto.randomUUID().replaceAll("-", "")}`;
const coachDir = await mkdtemp(join(tmpdir(), "duplicate-banner-runtime-"));
const paths = {
  applications: join(coachDir, "applications.json"),
  documents: join(coachDir, "documents.json"),
  sessions: join(coachDir, "sessions.json"),
  preparations: join(coachDir, "preparations.json"),
  links: join(coachDir, "session-links.json"),
};
const database = new Pool({ connectionString: process.env.DATABASE_URL });
let server: ReturnType<typeof spawn> | undefined;
let schemaCreated = false;
let passed = 0;

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}
function pass(label: string) { passed++; console.log(`PASS ${label}`); }

function job() {
  return normalizeJob({
    id: "job-x", source: "test", sourceId: "job-x-source", title: "IT Support Technician", company: "Nordic Tech",
    location: "Jönköping", url: "https://example.test/job-x", applyUrl: null, remote: "onsite",
    employmentType: "full-time", seniority: "mid", description: "Support role.", skills: ["Windows"],
  });
}

function profile() {
  return normalizeCandidateProfile({
    headline: "IT Support Technician", targetRoles: ["IT Support Technician"], locationPreferences: ["Jönköping"],
    workMode: "onsite", remotePreference: false, preferredEmploymentType: ["full-time"],
    skills: { technical: ["Windows"], soft: [] }, yearsOfExperience: 3,
  });
}

async function seedApplication(applicationId: string, candidateId: string) {
  const applications = createFileApplicationRepository(paths.applications);
  const associations = createFileCandidateApplicationAssociationRepository(join(coachDir, "associations.json"));
  const ranked = analyzeJobs(profile(), [job()]).rankedJobs[0];
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

  async function register() {
    const response = await fetch(`${origin}/api/auth/sign-up/email`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin! },
      body: JSON.stringify({ name: "Synthetic integration", email: `${crypto.randomUUID()}@example.test`, password: crypto.randomUUID() }),
    });
    check(response.ok, "Synthetic Better Auth registration failed");
    const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    check(cookie, "Better Auth did not issue a session cookie");
    const root = await fetch(`${origin}/`, { headers: { Cookie: cookie }, redirect: "manual" });
    const location = root.headers.get("location");
    check(location && /^\/candidates\/[^/]+\/onboarding$/.test(location), "Authenticated root did not redirect to onboarding");
    return { cookie, candidateId: location.split("/")[2]! };
  }

  const owner = await register();
  const foreign = await register();
  pass("real Better Auth sessions for owner and foreign candidate");

  await seedApplication("application-x", owner.candidateId);
  pass("seeded one existing application (as if just created via a real search+create flow)");

  const staleUrl = `${origin}/jobs?applicationError=DUPLICATE_APPLICATION&duplicateApplicationId=application-x`;

  const beforeDelete = await fetch(staleUrl, { headers: { Cookie: owner.cookie } });
  check(beforeDelete.ok, "Jobs page failed to render before deletion");
  const beforeHtml = await beforeDelete.text();
  check(beforeHtml.includes("Du har redan sökt jobbet"), "Duplicate banner did not render while the application still exists (live check false-negative)");
  check(beforeHtml.includes("Visa min ansökan"), "Direct application link did not render for a still-valid duplicate");
  pass("duplicate banner renders correctly while the referenced application still exists");

  const foreignAttempt = await fetch(staleUrl, { headers: { Cookie: foreign.cookie } });
  check(foreignAttempt.ok, "Jobs page failed to render for foreign candidate");
  const foreignHtml = await foreignAttempt.text();
  check(!foreignHtml.includes("Du har redan sökt jobbet"), "Foreign candidate saw another candidate's duplicate banner - ownership was not re-checked");
  pass("a foreign candidate never sees another candidate's duplicate banner, even with the same URL");

  // Delete application-x exactly as a real browser would: fetch the real
  // /applications page, extract the real progressive-enhancement delete
  // form Next.js rendered, and submit it as a no-JS multipart POST.
  const listPage = await fetch(`${origin}/applications`, { headers: { Cookie: owner.cookie } });
  const listHtml = await listPage.text();
  const forms = listHtml.match(/<form[^>]*>[\s\S]*?<\/form>/g) ?? [];
  const targetForm = forms.find((form) => form.includes('value="application-x"'));
  check(targetForm, "Could not find the rendered delete form for application-x");
  const actionId = /name="(\$ACTION_ID_[^"]+)"/.exec(targetForm!)?.[1];
  check(actionId, "Rendered delete form has no $ACTION_ID reference field");
  const deleteBody = new FormData();
  deleteBody.set(actionId!, "");
  deleteBody.set("applicationId", "application-x");
  const deleteResponse = await fetch(`${origin}/applications`, { method: "POST", redirect: "manual", headers: { Cookie: owner.cookie }, body: deleteBody });
  check(deleteResponse.status === 303 || deleteResponse.status === 307, `Real delete request did not redirect (status ${deleteResponse.status})`);
  pass("application-x deleted through the real /applications delete form");

  const afterDelete = await fetch(staleUrl, { headers: { Cookie: owner.cookie } });
  check(afterDelete.ok, "Jobs page failed to render after deletion");
  const afterHtml = await afterDelete.text();
  check(!afterHtml.includes("Du har redan sökt jobbet"), "STALE duplicate banner still rendered after the referenced application was deleted");
  check(!afterHtml.includes("Visa min ansökan"), "Stale direct-application link still rendered after deletion");
  pass("revisiting the exact same stale /jobs URL no longer shows the obsolete duplicate warning");

  const cleanUrl = `${origin}/jobs`;
  const cleanPage = await fetch(cleanUrl, { headers: { Cookie: owner.cookie } });
  check(cleanPage.ok, "Clean /jobs visit failed to render");
  const cleanHtml = await cleanPage.text();
  check(!cleanHtml.includes("Du har redan sökt jobbet"), "A clean /jobs visit unexpectedly shows a duplicate banner");
  pass("a fresh /jobs visit with no error query params renders no banner at all");

  console.log(`${passed} manual duplicate-banner verification checks passed`);
} catch (error) {
  console.error("Manual verification failed:", error instanceof Error && !("code" in error) ? error.message : "environment/database operation failed");
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
