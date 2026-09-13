/** Run separately: cd web && bun integration/application-deletion-manual-check.ts
 * Requires PostgreSQL schema-creation permission and an unused BETTER_AUTH_URL
 * port. Uses real Better Auth and a real Next.js server, an isolated schema,
 * and temporary file-based application/interview storage. Never touches an
 * existing account, the real coach directory, or the user's running dev
 * server on port 3000.
 *
 * Verifies, against the ACTUAL rendered pages (not just unit tests):
 * 1. /applications lists an "Öppna" and "Radera" action per application.
 * 2. A foreign candidate cannot delete another candidate's application.
 * 3. Deleting an application (via a real, no-JS-style form POST, exactly how
 *    the rendered <form action={deleteApplicationAction}> degrades) removes
 *    it - and only it - from disk (application, document, association,
 *    interview session, interview preparation, session/preparation link) and
 *    from the /applications list.
 * 4. /analytics/<candidateId> collapses long requirement/skill-gap/
 *    recommendation lists behind "Visa alla ..." disclosures once there are
 *    more than the default visible count, without losing any row.
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
import { createFileApplicationDocumentRepository } from "../../.agents/job-search/cli/src/application-document-file-repository";
import { createFileInterviewSessionRepository } from "../../.agents/job-search/cli/src/interview-session-file-repository";
import { createFileInterviewPreparationRepository } from "../../.agents/job-search/cli/src/interview-preparation-file-repository";
import { createFileInterviewSessionPreparationLinkRepository } from "../../.agents/job-search/cli/src/interview-session-preparation-link-file-repository";
import { createInterviewPreparationPlan, startInterviewSession, buildApplicationDocumentFoundation } from "../../.agents/job-search/cli/src/index";

const origin = process.env.BETTER_AUTH_URL;
if (!origin || !process.env.DATABASE_URL) throw new Error("Configured auth origin and database required");
const url = new URL(origin);
const webDir = resolve(import.meta.dir, "..");
const schema = `deletion_test_${crypto.randomUUID().replaceAll("-", "")}`;
const coachDir = await mkdtemp(join(tmpdir(), "application-deletion-runtime-"));
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

function job(id: string, sourceId: string) {
  return normalizeJob({
    id, source: "test", sourceId, title: "IT Support Technician", company: "Nordic Tech",
    location: "Jönköping", url: `https://example.test/${id}`, applyUrl: null, remote: "onsite",
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

/** Seeds one application with a document, a session, a preparation, and their
 * link - every artifact kind the deletion cascade must remove. */
async function seedFullApplication(applicationId: string, sourceId: string, candidateId: string) {
  const applications = createFileApplicationRepository(paths.applications);
  const associations = createFileCandidateApplicationAssociationRepository(join(coachDir, "associations.json"));
  const documents = createFileApplicationDocumentRepository(paths.documents);
  const sessions = createFileInterviewSessionRepository(paths.sessions);
  const preparations = createFileInterviewPreparationRepository(paths.preparations);
  const links = createFileInterviewSessionPreparationLinkRepository(paths.links, { sessionRepository: sessions, preparationRepository: preparations });

  const ranked = analyzeJobs(profile(), [job(applicationId, sourceId)]).rankedJobs[0];
  const created = createApplication({ id: applicationId, rankedJob: ranked, createdAt: "2026-09-12T10:00:00.000Z" });
  check(created.ok, "Application fixture invalid");
  if (!created.ok) throw new Error();
  check((await applications.create(created.value)).ok, "Seeding application failed");

  const association = createCandidateApplicationAssociation({ candidateId, applicationId, createdAt: "2026-09-12T10:00:00.000Z" });
  check(association.ok, "Association fixture invalid");
  if (!association.ok) throw new Error();
  check((await associations.create(association.value)).ok, "Seeding association failed");

  const evidence = [{ id: "experience:0", kind: "experience" as const, content: "Provided Windows support.", context: { employer: "Example employer", role: "Support" }, relatedRequirements: [{ category: "skill" as const, value: "Windows" }] }];
  const generatedDocument = { applicationId, documentType: "cv" as const, language: "en" as const, requiresHumanReview: false, warnings: [], sections: [{ id: "identity", kind: "identity" as const, claims: [{ id: "name", kind: "candidateFact" as const, provenance: "verbatim" as const, text: "Alex Testsson", evidenceIds: ["identity:name"] }] }] };
  const renderedDocument = { applicationId, documentType: "cv" as const, language: "en" as const, format: "markdown" as const, requiresHumanReview: false, warnings: [], content: "# Alex Testsson", renderMap: [{ sectionId: "identity", claimId: "name", blockIndex: 0, evidenceIds: ["identity:name"], provenance: "verbatim" as const }] };
  check((await documents.create({ id: `${applicationId}-cv-1`, applicationId, documentType: "cv", language: "en", version: 1, createdAt: "2026-09-12T10:00:00.000Z", generatedDocument, renderedDocument })).ok, "Seeding document failed");

  const foundation = buildApplicationDocumentFoundation(created.value, { evidence });
  check(foundation.ok, "Foundation fixture invalid");
  if (!foundation.ok) throw new Error();
  const plan = createInterviewPreparationPlan(created.value, { evidence }, { language: "en", interviewType: "hiringManager" });
  check(plan.ok, "Plan fixture invalid");
  if (!plan.ok) throw new Error();
  check((await preparations.create({ id: `${applicationId}-prep-1`, applicationId, candidateId, plan: plan.value, evidenceSnapshot: evidence, requirementContext: foundation.value.requirements })).ok, "Seeding preparation failed");

  const session = startInterviewSession(plan.value, { sessionId: `${applicationId}-session-1` });
  check(session.ok, "Session fixture invalid");
  if (!session.ok) throw new Error();
  check((await sessions.save(session.value)).ok, "Seeding session failed");
  check((await links.create({ sessionId: session.value.id, applicationId, preparationRecordId: `${applicationId}-prep-1` })).ok, "Seeding link failed");

  return { sessionId: session.value.id };
}

/** Seeds an application with N distinct missing requirements, to trigger the
 * analytics page's "Visa alla ..." disclosures. */
async function seedManyRequirementsApplication(applicationId: string, candidateId: string, labels: string[]) {
  const applications = createFileApplicationRepository(paths.applications);
  const associations = createFileCandidateApplicationAssociationRepository(join(coachDir, "associations.json"));
  const ranked = analyzeJobs(profile(), [job(applicationId, applicationId)]).rankedJobs[0];
  const created = createApplication({ id: applicationId, rankedJob: ranked, createdAt: "2026-09-12T10:00:00.000Z" });
  check(created.ok, "Requirements application fixture invalid");
  if (!created.ok) throw new Error();
  created.value.analysisSnapshot.matchingResult.missing = labels.map((label) => ({
    dimension: "technicalSkills" as const, status: "missing" as const, detail: "stored",
    requirementCoverage: { matchedRequirements: [], missingRequirements: [label], coverageRatio: 0 },
  }));
  created.value.analysisSnapshot.matchingResult.totalMissing = labels.length;
  created.value.analysisSnapshot.skillGapResult.gaps = labels.map((label) => ({
    type: "missing_skill" as const, title: `Missing: ${label}`, description: "stored", jobRequirement: label,
    severity: "high" as const, evidence: "stored",
    requirement: { identity: { key: `skill:${label.toLowerCase()}`, original: label, normalized: label.toLowerCase(), category: "skill" as const }, importance: "required" as const },
  }));
  created.value.analysisSnapshot.skillGapResult.totalGaps = labels.length;
  created.value.analysisSnapshot.skillGapResult.highGaps = labels.length;
  check((await applications.create(created.value)).ok, "Seeding requirements application failed");
  const association = createCandidateApplicationAssociation({ candidateId, applicationId, createdAt: "2026-09-12T10:00:00.000Z" });
  check(association.ok, "Requirements association fixture invalid");
  if (!association.ok) throw new Error();
  check((await associations.create(association.value)).ok, "Seeding requirements association failed");
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

  await seedFullApplication("application-target", "target-source", owner.candidateId);
  const survivor = await seedFullApplication("application-survivor", "survivor-source", owner.candidateId);
  pass("seeded two applications, each with a document, session, preparation, and link");

  const listPage = await fetch(`${origin}/applications`, { headers: { Cookie: owner.cookie } });
  check(listPage.ok, "Applications list failed to render");
  const listHtml = await listPage.text();
  check(listHtml.includes("IT Support Technician"), "Applications list did not show the seeded job title");
  check(listHtml.includes(">Öppna<"), "Applications list did not show an explicit Öppna action");
  check(listHtml.includes(">Radera<"), "Applications list did not show a Radera action");
  check(listHtml.includes("Radera ansökan?"), "Applications list did not include the delete confirmation copy");
  check(listHtml.includes("Därefter kan du skapa en ny ansökan för jobbet."), "Delete confirmation copy did not match the requested wording");
  pass("/applications renders Öppna and Radera actions with the requested confirmation copy");

  // Extract the real <form> Next.js rendered for the delete action, and
  // submit it exactly as a browser without JavaScript would (progressive
  // enhancement): a multipart/form-data POST to the current page URL,
  // carrying the framework's own $ACTION_ID_... reference field.
  const formsForTarget = listHtml.match(/<form[^>]*>[\s\S]*?<\/form>/g) ?? [];
  const targetForm = formsForTarget.find((form) => form.includes('value="application-target"'));
  check(targetForm, "Could not find the rendered delete form for application-target");
  const actionId = /name="(\$ACTION_ID_[^"]+)"/.exec(targetForm!)?.[1];
  check(actionId, "Rendered delete form has no $ACTION_ID reference field");
  const hiddenValue = /name="applicationId" value="([^"]*)"/.exec(targetForm!)?.[1];
  check(hiddenValue === "application-target", "Delete form did not carry the expected applicationId field");

  async function submitDeleteForm(cookie: string) {
    const body = new FormData();
    body.set(actionId!, "");
    body.set("applicationId", "application-target");
    return fetch(`${origin}/applications`, { method: "POST", redirect: "manual", headers: { Cookie: cookie }, body });
  }

  const foreignAttempt = await submitDeleteForm(foreign.cookie);
  check(foreignAttempt.status >= 400, `Foreign delete attempt did not fail as expected (status ${foreignAttempt.status})`);
  const applicationsAfterForeignAttempt = createFileApplicationRepository(paths.applications);
  check((await applicationsAfterForeignAttempt.getById("application-target")).ok, "Foreign delete attempt deleted the application - authorization bypass");
  pass("a foreign candidate cannot delete another candidate's application");

  const ownerDelete = await submitDeleteForm(owner.cookie);
  check(ownerDelete.status === 303 || ownerDelete.status === 307, `Owner delete did not redirect (status ${ownerDelete.status})`);
  check((ownerDelete.headers.get("location") ?? "").includes("/applications"), "Owner delete did not redirect to /applications");
  pass("owner delete request redirects back to /applications");

  const applicationsRepo = createFileApplicationRepository(paths.applications);
  const documentsRepo = createFileApplicationDocumentRepository(paths.documents);
  const associationsRepo = createFileCandidateApplicationAssociationRepository(join(coachDir, "associations.json"));
  const sessionsRepo = createFileInterviewSessionRepository(paths.sessions);
  const preparationsRepo = createFileInterviewPreparationRepository(paths.preparations);
  const linksRepo = createFileInterviewSessionPreparationLinkRepository(paths.links, { sessionRepository: sessionsRepo, preparationRepository: preparationsRepo });

  check((await applicationsRepo.getById("application-target")).ok === false, "Application record survived deletion");
  check((await documentsRepo.listByApplication("application-target")).ok && (await documentsRepo.listByApplication("application-target") as { ok: true; value: unknown[] }).value.length === 0, "Document records survived deletion");
  check((await associationsRepo.getByApplicationId("application-target")).ok === false, "Association survived deletion");
  check((await sessionsRepo.listByApplicationId("application-target") as { ok: true; value: unknown[] }).value.length === 0, "Interview session survived deletion");
  check((await preparationsRepo.listByApplicationId("application-target") as { ok: true; value: unknown[] }).value.length === 0, "Interview preparation survived deletion");
  check((await linksRepo.getBySessionId(`application-target-session-1`)).ok === false, "Session/preparation link survived deletion");
  pass("every artifact owned by the deleted application is gone from disk");

  check((await applicationsRepo.getById("application-survivor")).ok, "Unrelated application was deleted");
  check((await sessionsRepo.listByApplicationId("application-survivor") as { ok: true; value: unknown[] }).value.length === 1, "Unrelated application's session was deleted");
  check((await linksRepo.getBySessionId(survivor.sessionId)).ok, "Unrelated application's session/preparation link was deleted");
  pass("the unrelated application and its artifacts are completely untouched");

  const afterDeleteList = await fetch(`${origin}/applications`, { headers: { Cookie: owner.cookie } });
  const afterDeleteHtml = await afterDeleteList.text();
  check(/<h2>1(?:<!-- -->)? ansökningar<\/h2>/.test(afterDeleteHtml), "Applications list did not show exactly one remaining application after deletion");
  check((afterDeleteHtml.match(/>Öppna</g) ?? []).length === 1, "Applications list did not render exactly one Öppna action after deletion");
  pass("/applications no longer lists the deleted application");

  const labels = ["Windows", "Active Directory", "Microsoft 365", "Networking", "Linux", "Cloud platform", "Security"];
  await seedManyRequirementsApplication("application-many-requirements", owner.candidateId, labels);
  const analyticsPage = await fetch(`${origin}/analytics/${owner.candidateId}?start=2026-01-01&end=2027-01-01`, { headers: { Cookie: owner.cookie } });
  check(analyticsPage.ok, "Analytics page failed to render");
  const analyticsHtml = await analyticsPage.text();
  for (const label of labels) check(analyticsHtml.includes(label), `Analytics page dropped requirement "${label}" behind disclosure instead of just collapsing its row`);
  function disclosedCount(prefix: string): number {
    const match = new RegExp(`${prefix} \\((?:<!-- -->)?(\\d+)(?:<!-- -->)?\\)`).exec(analyticsHtml);
    return match ? Number(match[1]) : -1;
  }
  check(disclosedCount("Visa alla krav") >= labels.length, "Analytics page did not collapse the long requirements list behind a disclosure");
  check(disclosedCount("Visa alla kompetensgap") >= labels.length, "Analytics page did not collapse the long skill-gap list behind a disclosure");
  check(disclosedCount("Visa alla rekommendationer") >= labels.length, "Analytics page did not collapse the long recommendations list behind a disclosure");
  pass("/analytics collapses long requirement, skill-gap, and recommendation lists behind disclosures without dropping any row");

  console.log(`${passed} manual UI verification checks passed`);
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
