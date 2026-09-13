import { searchJobs } from "../../.agents/job-search/cli/src/engine";
import { presentMatch } from "../src/lib/match-confidence";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { analyzeJobs, createApplication, normalizeJob } from "../../.agents/job-search/cli/src/index";
import { createFileCandidateProfileRepository } from "../../.agents/job-search/cli/src/candidate-profile-file-repository";
import { createFileCandidateBaseCvRepository } from "../src/lib/candidate-base-cv-file-repository";
import { createFileApplicationRepository } from "../../.agents/job-search/cli/src/application-file-repository";
import { createFileCandidateApplicationAssociationRepository } from "../../.agents/job-search/cli/src/coach-application-association-file-repository";
import { createFileApplicationDocumentRepository } from "../../.agents/job-search/cli/src/application-document-file-repository";
import { createFileInterviewPreparationRepository } from "../../.agents/job-search/cli/src/interview-preparation-file-repository";
import { createFileInterviewSessionRepository } from "../../.agents/job-search/cli/src/interview-session-file-repository";

const { encodeReply } = createRequire(import.meta.url)("next/dist/compiled/react-server-dom-turbopack/client.node") as { encodeReply(values: unknown[]): Promise<FormData> };
type Account = { cookie: string; location: string; candidateId: string };
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

/** Actual HTTP actions with real auth; only synthetic application/job fixtures are seeded. */
export async function verifyProfileJourney({ origin, coachDir, webDir, owner, foreign, small }: { origin: string; coachDir: string; webDir: string; owner: Account; foreign: Account; small: Uint8Array }) {
  let checks = 0;
  const pass = (label: string) => { checks++; console.log(`PASS journey: ${label}`); };
  async function page(path: string, cookie = owner.cookie) {
    const response = await fetch(new URL(path, origin), { headers: { Cookie: cookie } });
    check(response.ok, `Page failed (${response.status})`);
    return response.text();
  }
  async function invoke(name: string, route: string, fields: Record<string, string | File>, cookie = owner.cookie, previousState = false) {
    await page(route, cookie);
    const manifest = JSON.parse(await readFile(join(webDir, ".next/dev/server/server-reference-manifest.json"), "utf8"));
    const id = Object.entries(manifest.node as Record<string, { exportedName?: string }>).find(([, entry]) => entry.exportedName === name)?.[0];
    check(id, `Action missing: ${name}`);
    const form = new FormData(); for (const [key, value] of Object.entries(fields)) form.set(key, value);
    Object.defineProperty(form, "toJSON", { value: undefined });
    const response = await fetch(new URL(route, origin), { method: "POST", redirect: "manual", headers: { Cookie: cookie, Origin: origin, "Next-Action": id, Accept: "text/x-component" }, body: await encodeReply(previousState ? [null, form] : [form]) });
    const wire = await response.text();
    const result = wire.split("\n").flatMap(line => {
      try { const value = JSON.parse(line.slice(line.indexOf(":") + 1)); return typeof value?.ok === "boolean" ? [value] : []; } catch { return []; }
    })[0] as { ok: boolean; code?: string; importId?: string; documentId?: string; claims?: Array<{ id: string }> } | undefined;
    return { status: response.status, result, redirect: response.headers.get("x-action-redirect") };
  }
  const route = `/candidates/${owner.candidateId}`;
  const structured = {
    headline: "Support Engineer", summary: "User-confirmed professional summary",
    workExperience: [
      { title: "Support Engineer", company: "Synthetic Employer", location: "Stockholm", startDate: "2021-01", endDate: "Pågående", summary: "Resolved support requests." },
      { title: "Operations Assistant", company: "Synthetic Operations", location: "Gothenburg", startDate: "2019-01", endDate: "2020-12", summary: "Coordinated operational work." },
    ],
    education: [
      { degree: "YH", field: "IT", institution: "Synthetic College", startYear: 2019, endYear: 2021 },
      { degree: "Diploma", field: "Operations", institution: "Synthetic Institute", startYear: 2017, endYear: 2018 },
    ],
  };
  const uploaded = await invoke("uploadCandidateOnboardingAction", owner.location, { candidateId: owner.candidateId, cv: new File([new Uint8Array(small)], "synthetic.pdf", { type: "application/pdf" }) });
  check(uploaded.result?.ok && uploaded.result.importId && uploaded.result.documentId, "Journey upload failed");
  const applyFields = { candidateId: owner.candidateId, importId: uploaded.result.importId, documentId: uploaded.result.documentId, reviews: JSON.stringify(uploaded.result.claims?.map(claim => ({ claimId: claim.id, decision: "approved" })) ?? []), added: "[]", structuredProfile: JSON.stringify(structured) };
  const applied = await invoke("applyCandidateOnboardingAction", owner.location, applyFields);
  check(applied.result?.ok, `Structured onboarding failed: ${applied.result?.code ?? "request"}`);
  const profiles = createFileCandidateProfileRepository(join(coachDir, "candidate-profiles.json"));
  const baseCvs = createFileCandidateBaseCvRepository(join(coachDir, "candidate-cvs.json"));
  let profile = await profiles.getProfileByCandidateId(owner.candidateId);
  let base = await baseCvs.getByCandidateId(owner.candidateId);
  check(profile.ok && base.ok && profile.value.profile.workExperience[0]?.company === "Synthetic Employer" && base.value.education[0]?.institution === "Synthetic College", "Onboarding did not persist structured profile/Base CV");
  pass("upload, review, structured completion, profile and Base CV save");

  const profileFields = (evidence: typeof structured) => ({ candidateId: owner.candidateId, headline: evidence.headline, summary: evidence.summary, yearsOfExperience: "3", workMode: "open", targetRoles: "Support", locationPreferences: "Stockholm", preferredIndustries: "IT", preferredEmploymentType: "full-time", technicalSkills: "Windows\nLinux\nDirectory services\nCloud platform\nEndpoint management\nNätverk\nTCP/IP\nDNS\nDHCP\nVPN\nContainer tools", softSkills: "Problemlösning\nKommunikation\nSamarbete", certifications: "Professionell certifiering A\nProfessionell certifiering B\nProfessionell certifiering C\nProfessionell certifiering D\nProfessionell certifiering E", languages: "Svenska | Flytande\nEngelska | Flytande", careerGoals: "", structuredProfile: JSON.stringify(evidence) });
  const edited = {
    ...structured,
    workExperience: [{ ...structured.workExperience[0]!, title: "Senior Support" }, structured.workExperience[1]!],
    education: [{ ...structured.education[0]!, degree: "Professional Diploma" }, structured.education[1]!],
  };
  let saved = await invoke("saveCandidateProfileAction", route, profileFields(edited));
  check(saved.redirect, "Profile edit did not complete");
  profile = await profiles.getProfileByCandidateId(owner.candidateId); base = await baseCvs.getByCandidateId(owner.candidateId);
  check(profile.ok && base.ok && base.value.workExperience.length === 2 && base.value.education.length === 2 && base.value.workExperience[0]?.title === "Senior Support" && base.value.education[0]?.degree === "Professional Diploma" && base.value.technicalSkills.length === 11 && base.value.softSkills.length === 3 && base.value.certifications.length === 5 && base.value.languages.length === 2, "Profile edits did not reach Base CV");
  pass("experience/education edits and skills/certifications/languages sync");
  saved = await invoke("saveCandidateProfileAction", route, profileFields({ ...edited, workExperience: [], education: [] }));
  check(saved.redirect, "Profile removal did not complete");
  base = await baseCvs.getByCandidateId(owner.candidateId);
  check(base.ok && base.value.workExperience.length === 0 && base.value.education.length === 0, "Removed history remained in Base CV");
  check((await page("/")).includes("Att komplettera"), "Incomplete profile incorrectly marked ready");
  saved = await invoke("saveCandidateProfileAction", route, profileFields(edited)); check(saved.redirect, "Profile restoration failed");
  pass("structured removals, completeness warning and re-addition");
  const beforeForeign = await readFile(join(coachDir, "candidate-profiles.json"), "utf8");
  const denied = await invoke("saveCandidateProfileAction", route, profileFields(edited), foreign.cookie);
  const anonymous = await invoke("saveCandidateProfileAction", route, profileFields(edited), "");
  check(!denied.redirect && !anonymous.redirect && beforeForeign === await readFile(join(coachDir, "candidate-profiles.json"), "utf8"), "Unauthorized profile mutation changed data");
  pass("foreign and unauthenticated profile edits denied");

  profile = await profiles.getProfileByCandidateId(owner.candidateId); check(profile.ok, "Profile missing");
  const job = normalizeJob({ id: "synthetic-job", title: "Support", source: "jobtech", sourceId: "synthetic-job", company: "Hiring Example", location: "Stockholm", url: "https://example.test/job", applyUrl: "https://example.test/apply", description: "Requirements: Windows, Linux and DNS. Kubernetes required. Experience in support, communication and collaboration. Swedish and English required. Professionell certifiering A preferred.", skills: ["Windows", "Linux", "DNS", "Kubernetes"], category: "IT", remote: "onsite", employmentType: "full-time", seniority: "mid" });
  const sparse = normalizeJob({ id: "synthetic-sparse", source: "linkedin", title: "IT Support Technician" });
  const search = await searchJobs({ query: "Support", adapters: [{ name: "synthetic", async search() { return { source: "synthetic", status: "ok", jobs: [job, sparse] }; } }] });
  const analysis = analyzeJobs(profile.value.profile, search.jobs);
  const richMatch = analysis.rankedJobs.find(item => item.job.id === job.id)!;
  const sparseMatch = analysis.rankedJobs.find(item => item.job.id === sparse.id)!;
  check(richMatch.score >= 40 && !presentMatch(richMatch).insufficient, "Rich job confidence failed");
  check(presentMatch(sparseMatch).scoreLabel === "Otillräckligt underlag", "Sparse match presented as definite zero");
  pass("isolated search adapter, rich match and sparse low-information semantics");
  const ranked = richMatch;
  const application = createApplication({ id: crypto.randomUUID(), rankedJob: ranked, createdAt: new Date().toISOString() });
  check(application.ok, "Synthetic matched application creation failed");
  const applicationId = application.value.id;
  const applications = createFileApplicationRepository(join(coachDir, "applications.json"));
  check((await applications.create(application.value)).ok, "Application fixture save failed");
  check((await createFileCandidateApplicationAssociationRepository(join(coachDir, "associations.json")).create({ candidateId: owner.candidateId, applicationId, createdAt: new Date().toISOString() })).ok, "Application association failed");
  pass("normalized job, matching/ranking and associated application fixture");
  const appRoute = `/applications/${applicationId}`;
  for (const name of ["createTailoredCvAction", "createCoverLetterAction"]) check((await invoke(name, appRoute, { applicationId, documentLanguage: "en" })).redirect, `Document action failed: ${name}`);
  const documents = createFileApplicationDocumentRepository(join(coachDir, "documents.json"));
  let cv = await documents.getLatest(applicationId, "cv");
  check(cv.ok, "Tailored CV missing");
  for (const fact of ["Support Engineer", "User-confirmed professional summary", "Synthetic Employer", "Synthetic Operations", "Senior Support", "Synthetic College", "Synthetic Institute", "Professional Diploma", "Windows", "Linux", "Directory services", "Professionell certifiering A", "Svenska", "Engelska"]) check(cv.value.renderedDocument.content.includes(fact), "Structured evidence omitted from tailored CV");
  check(!cv.value.renderedDocument.content.includes("Kubernetes"), "Job-only skill invented in CV");
  const letter = await documents.getLatest(applicationId, "coverLetter");
  check(letter.ok && letter.value.language === "en" && letter.value.renderedDocument.content.startsWith("Dear Hiring Manager,") && letter.value.renderedDocument.content.includes("Kind regards,") && !letter.value.renderedDocument.content.includes("##"), "Professional letter content failed");
  check(!letter.value.renderedDocument.content.includes("Kubernetes"), "Unsupported letter skill");
  for (const type of ["cv", "coverLetter"]) {
    const preview = await page(`${appRoute}/documents/${type === "cv" ? "cv" : "cover-letter"}`);
    check(!preview.includes("Strukturerad disposition"), "Debug letter in preview");
    for (const format of ["pdf", "docx"]) {
      const exported = await fetch(`${origin}${appRoute}/documents/export?documentType=${type}&template=classic&format=${format}`, { headers: { Cookie: owner.cookie } });
      check(exported.ok && (await exported.arrayBuffer()).byteLength > 100, "Professional export failed");
    }
  }
  pass("tailored CV and professional English letter previews and PDF/Word exports");
  const editRoute = `${appRoute}/documents/cv/edit`;
  const content = cv.value.renderedDocument.content + "\n## Övrigt\n- User-reviewed addition\n";
  check((await invoke("saveDocumentEditAction", editRoute, { applicationId, documentType: "cv", content })).redirect, "Document editor save failed");
  cv = await documents.getLatest(applicationId, "cv");
  check(cv.ok, "Edited document could not be read");
  check(cv.value.version === 2, "Document version did not advance");
  check(cv.value.language === "en", "Document language changed during editing");
  check(cv.value.renderedDocument.content === content, "Edited document content changed beyond transport newline normalization");
  for (const format of ["pdf", "docx"]) {
    const response = await fetch(`${origin}${appRoute}/documents/export?documentType=cv&template=modern&format=${format}`, { headers: { Cookie: owner.cookie } });
    const bytes = new Uint8Array(await response.arrayBuffer());
    check(response.ok && bytes.length > 100 && (format === "pdf" ? bytes[0] === 37 : bytes[0] === 80 && bytes[1] === 75), "Document export failed");
    const rejected = await fetch(`${origin}${appRoute}/documents/export?documentType=cv&template=modern&format=${format}`, { headers: { Cookie: foreign.cookie } });
    check(rejected.status === 404, "Foreign export was not denied");
  }
  pass("document edit, immutable new version, PDF/Word export and foreign denial");

  const prepareRoute = `${appRoute}/interview/prepare`;
  check((await invoke("createPreparationAction", prepareRoute, { applicationId, language: "sv", interviewType: "roleSpecific" })).redirect, "Interview preparation action failed");
  const preparations = await createFileInterviewPreparationRepository(join(coachDir, "preparations.json")).listByApplicationId(applicationId);
  check(preparations.ok && preparations.value.length === 1, "Interview preparation missing");
  const preparationId = preparations.value[0]!.id;
  check((await invoke("startMockInterviewAction", `${appRoute}/interview/preparations/${preparationId}`, { applicationId, preparationId })).redirect, "Mock interview start failed");
  const sessions = createFileInterviewSessionRepository(join(coachDir, "sessions.json"));
  const listed = await sessions.listByApplicationId(applicationId); check(listed.ok && listed.value.length === 1, "Interview session missing");
  const sessionId = listed.value[0]!.id;
  const sessionRoute = `${appRoute}/interview/sessions/${sessionId}`;
  check((await page(sessionRoute)).includes("Intervju"), "Interview route failed");
  check(!(await page(sessionRoute, foreign.cookie)).includes("name=\"expectedQuestionId\""), "Foreign interview exposed answer form");
  pass("interview preparation, session creation/resume and foreign denial");
  const firstQuestion = listed.value[0]!.planQuestionIds[0]!;
  const answer = await invoke("submitMockInterviewAnswerAction", sessionRoute, { applicationId, sessionId, expectedQuestionId: firstQuestion, format: "freeText", mode: "deterministic", text: "I handled a support request, investigated the cause and explained the resolution." }, owner.cookie, true);
  check(answer.redirect && !answer.redirect.includes("answerError"), "Interview answer failed");
  for (let index = 1; index < listed.value[0]!.planQuestionIds.length; index++) {
    const skipped = await invoke("skipMockInterviewQuestionAction", sessionRoute, { applicationId, sessionId, expectedQuestionId: listed.value[0]!.planQuestionIds[index]! });
    check(skipped.redirect && !skipped.redirect.includes("skipError"), "Interview progression failed");
  }
  const completedSession = await sessions.getById(sessionId);
  check(completedSession.ok && completedSession.value.status === "completed", "Interview did not complete");
  const results = await page(`${sessionRoute}/results`);
  check(!results.includes("Intervjun kunde inte") && !results.includes("Resultatet kunde inte"), "Interview results failed");
  pass("deterministic answer, question progression, completed interview and results");


  check((await invoke("createNoteAction", route, { candidateId: owner.candidateId, text: "Synthetic private note" })).redirect, "Note action failed");
  check((await invoke("createFollowUpAction", route, { candidateId: owner.candidateId, dueAt: "2026-12-01T12:00" })).redirect, "Follow-up action failed");
  check((await invoke("createActivityAction", route, { candidateId: owner.candidateId, kind: "updateCv", plannedAt: "2026-12-01T12:00" })).redirect, "Activity action failed");
  for (const path of ["/jobs", "/applications", `/analytics/${owner.candidateId}`, `/reports/${owner.candidateId}`]) {
    const html = await page(path); check(html.includes("Personlig navigation"), "Personal route/navigation missing");
    check(!html.includes('href="/coach"'), "Coach navigation leaked into personal routes");
  }
  check(!(await page(`/analytics/${owner.candidateId}`, foreign.cookie)).includes("Personlig navigation"), "Foreign analytics allowed");
  check(!(await page(`/reports/${owner.candidateId}`, foreign.cookie)).includes("Personlig navigation"), "Foreign reports allowed");
  pass("follow-up/activity/notes, personal jobs/applications/analytics/reports routes and isolation");
  console.log(`${checks} profile journey checks passed`);
}
