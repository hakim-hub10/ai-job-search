import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyzeJobs, createApplication } from "../../../.agents/job-search/cli/src/index";
import { normalizeJob } from "../../../.agents/job-search/cli/src/utils";
import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import { buildApplicationDocumentFoundation } from "../../../.agents/job-search/cli/src/application-documents";
import * as core from "../../../.agents/job-search/cli/src/interview-preparation";
import { createFileInterviewPreparationRepository } from "../../../.agents/job-search/cli/src/interview-preparation-file-repository";
import type { InterviewPreparationRecord } from "../../../.agents/job-search/cli/src/interview-preparation-repository";
import type { PreparationCreateDependencies, PreparationResult } from "./interview-preparation-data";
mock.module("server-only", () => ({}));
const { createApplicationInterviewPreparation: create, listApplicationInterviewPreparations: list, loadApplicationInterviewPreparation: load } = await import("./interview-preparation-data");
const choice = { applicationId: "A", language: "sv", interviewType: "hiringManager" };
const missing = { ok: false as const, error: { code: "NOT_FOUND" as const, message: "/private/SECRET profile JSON" } };
function value<T>(r: PreparationResult<T>): T { if (!r.ok) throw new Error(r.code); return r.value; }
function fixture() {
  const profile: CandidateProfile = { headline: "Supporttekniker", targetRoles: ["Support"], locationPreferences: [], workMode: "open", remotePreference: false,
    preferredIndustries: [], preferredEmploymentType: ["open"], skills: { technical: ["Support"], soft: [] },
    workExperience: [{ title: "Tekniker", company: "Exempelbolaget", location: "Göteborg", summary: "Hjälpte kollegor med supportärenden." }],
    education: [], certifications: [], languages: [], yearsOfExperience: 2, careerGoals: [] };
  const job = normalizeJob({ source: "test", sourceId: "job", title: "IT-supporttekniker", company: "Testbolaget", skills: ["Support", "Linux"] });
  const app = createApplication({ id: "A", rankedJob: analyzeJobs(profile, [job]).rankedJobs[0], createdAt: "2026-09-08T10:00:00.000Z" });
  if (!app.ok) throw new Error("fixture");
  const application = app.value, records: InterviewPreparationRecord[] = [], calls: string[] = [];
  const deps: PreparationCreateDependencies = {
    applicationRepository: { async getById(id) { calls.push(`app:${id}`); return ["A", "B"].includes(id) ? { ok: true, value: { ...application, id } } : missing; } },
    associationRepository: { async getByApplicationId(id) { calls.push(`association:${id}`); return { ok: true, value: { applicationId: id, candidateId: "candidate-A", createdAt: "2026-09-08T10:00:00.000Z" } }; } },
    candidateRepository: { async getCandidateById(id) { calls.push(`candidate:${id}`); return { ok: true, value: { id, displayName: "PRIVATE_NAME", createdAt: "", updatedAt: "" } }; } },
    profileRepository: { async getProfileByCandidateId(id) { calls.push(`profile:${id}`); return { ok: true, value: { candidateId: id, profile } }; } },
    preparationRepository: {
      async create(r) { calls.push("create"); records.push(structuredClone(r)); return { ok: true, value: structuredClone(r) }; },
      async getById(id) { calls.push(`read:${id}`); const r = records.find((r) => r.id === id); return r ? { ok: true, value: structuredClone(r) } : missing; },
      async listByApplicationId(id) { calls.push(`list:${id}`); return { ok: true, value: structuredClone(records.filter((r) => r.applicationId === id)) }; },
    },
  };
  return { deps, records, calls, application, profile };
}
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
describe("interview preparation web data", () => {
  it("resolves exact ownership and reuses deterministic core plan, verified evidence and job context without mutation", async () => {
    const f = fixture(), before = structuredClone({ app: f.application, profile: f.profile });
    const spy = spyOn(core, "createInterviewPreparationPlan");
    try {
      const r = value(await create(choice, f.deps));
      expect(f.calls).toEqual(["app:A", "association:A", "candidate:candidate-A", "profile:candidate-A", "create"]); expect(spy).toHaveBeenCalledTimes(1);
      const stored = f.records[0]; expect(stored.candidateId).toBe("candidate-A");
      const expected = core.createInterviewPreparationPlan(f.application, { evidence: stored.evidenceSnapshot }, { language: "sv", interviewType: "hiringManager" });
      if (!expected.ok) throw new Error("plan"); expect(stored.plan).toEqual(expected.value);
      const foundation = buildApplicationDocumentFoundation(f.application, { evidence: stored.evidenceSnapshot });
      if (!foundation.ok) throw new Error("foundation"); expect(stored.requirementContext).toEqual(foundation.value.requirements);
      expect(stored.plan.job.jobId).toBe(f.application.jobSnapshot.id);
      expect(r).toEqual(value(await load("A", stored.id, f.deps)));
      expect(stored.evidenceSnapshot.find((e) => e.kind === "experience")).toMatchObject({ content: "Hjälpte kollegor med supportärenden.", context: { employer: "Exempelbolaget", role: "Tekniker" } });
      expect(JSON.stringify(r)).not.toMatch(/PRIVATE_NAME|candidateId|profileUpdatedAt|sourceId|matchingProfile|email|phone/);
      expect({ app: f.application, profile: f.profile }).toEqual(before);
    } finally { spy.mockRestore(); }
  });
  it.each(["recruiterScreening", "hiringManager", "behavioral", "roleSpecific", "situational"])("supports %s in both languages", async (interviewType) => {
    for (const language of ["sv", "en"]) expect(value(await create({ ...choice, language, interviewType }, fixture().deps))).toMatchObject({ language, interviewType });
  });
  it.each([{ language: "de" }, { language: null }, { interviewType: "technical" }, { interviewType: 1 }, { applicationId: " " }])("rejects invalid choices before reads: %j", async (invalid) => {
    const f = fixture(); expect(await create({ ...choice, ...invalid }, f.deps)).toMatchObject({ ok: false, code: "INVALID_REQUEST" }); expect(f.calls).toEqual([]);
  });
  it("ignores browser-supplied facts and ownership", async () => {
    const f = fixture(); value(await create({ ...choice, ...{ candidateId: "FAKE", evidence: ["FAKE"], jobTitle: "FAKE", preparationId: "FAKE" } }, f.deps));
    expect(f.records[0].candidateId).toBe("candidate-A"); expect(JSON.stringify(f.records)).not.toContain("FAKE");
  });
  it("rejects missing application before candidate reads", async () => {
    const f = fixture(); expect(await create({ ...choice, applicationId: "missing" }, f.deps)).toMatchObject({ ok: false, code: "APPLICATION_NOT_FOUND" }); expect(f.calls).toEqual(["app:missing"]);
  });
  it.each(["association", "candidate", "profile"])("rejects missing %s without fallback", async (stage) => {
    const f = fixture();
    if (stage === "association") f.deps.associationRepository.getByApplicationId = async () => missing;
    if (stage === "candidate") f.deps.candidateRepository.getCandidateById = async () => missing;
    if (stage === "profile") f.deps.profileRepository.getProfileByCandidateId = async () => missing;
    expect(await create(choice, f.deps)).toMatchObject({ ok: false, code: stage === "association" ? "ASSOCIATION_NOT_FOUND" : "CANDIDATE_PROFILE_NOT_FOUND" }); expect(f.records).toEqual([]);
  });
  it.each(["application", "association", "candidate", "profile"])("rejects ownership mismatch in %s", async (stage) => {
    const f = fixture();
    if (stage === "application") f.deps.applicationRepository.getById = async () => ({ ok: true, value: { ...f.application, id: "OTHER" } });
    if (stage === "association") f.deps.associationRepository.getByApplicationId = async () => ({ ok: true, value: { applicationId: "B", candidateId: "candidate-A", createdAt: "" } });
    if (stage === "candidate") f.deps.candidateRepository.getCandidateById = async () => ({ ok: true, value: { id: "OTHER", displayName: "Other", createdAt: "", updatedAt: "" } });
    if (stage === "profile") f.deps.profileRepository.getProfileByCandidateId = async () => ({ ok: true, value: { candidateId: "OTHER", profile: f.profile } });
    expect(await create(choice, f.deps)).toMatchObject({ ok: false, code: "INVALID_PREPARATION_DATA" }); expect(f.records).toEqual([]);
  });
  it("keeps sparse verified profiles empty without default facts", async () => {
    const f = fixture(); f.profile.headline = ""; f.profile.skills.technical = []; f.profile.workExperience = [];
    const r = value(await create(choice, f.deps)); expect(f.records[0].evidenceSnapshot).toEqual([]);
    expect(r.questions.every((q) => q.evidence.length === 0)).toBe(true); expect(r.warnings.some((w) => w.code === "SPARSE_CANDIDATE_EVIDENCE")).toBe(true);
  });
  it("persists concurrent immutable preparations with UUIDs and read-only refresh", async () => {
    const f = fixture(), dir = await mkdtemp(join(tmpdir(), "web-preparation-")); dirs.push(dir); const path = join(dir, "preparations.json");
    f.deps.preparationRepository = createFileInterviewPreparationRepository(path);
    expect(value(await list("A", f.deps)).preparations).toEqual([]); expect(await readdir(dir)).toEqual([]);
    const results = await Promise.all([create(choice, f.deps), create({ ...choice, language: "en" }, f.deps), create(choice, f.deps)]);
    const ids = results.map((r) => value(r).preparationId); expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    expect(value(await list("A", f.deps)).preparations).toHaveLength(3);
    const before = await readFile(path, "utf8"); value(await load("A", ids[0], f.deps)); expect(await readFile(path, "utf8")).toBe(before); expect(await readdir(dir)).toEqual(["preparations.json"]);
  });
  it("reads exact historical evidence and job after current profile changes/removal without regeneration", async () => {
    const f = fixture(), first = value(await create(choice, f.deps));
    f.profile.workExperience[0].summary = "CHANGED"; f.profile.workExperience.reverse(); f.application.jobSnapshot.title = "CHANGED JOB";
    f.deps.profileRepository.getProfileByCandidateId = async () => { throw new Error("must not read profile"); };
    const spy = spyOn(core, "createInterviewPreparationPlan");
    try { expect(value(await load("A", first.preparationId, f.deps))).toEqual(first); value(await list("A", f.deps)); expect(spy).not.toHaveBeenCalled(); } finally { spy.mockRestore(); }
  });
  it("isolates lists and conceals foreign preparations", async () => {
    const f = fixture(), a = value(await create(choice, f.deps)), b = value(await create({ ...choice, applicationId: "B" }, f.deps));
    expect(value(await list("A", f.deps)).preparations.map((p) => p.preparationId)).toEqual([a.preparationId]);
    for (const id of [b.preparationId, "missing"]) expect(await load("A", id, f.deps)).toMatchObject({ ok: false, code: "PREPARATION_NOT_FOUND" });
  });
  it("rejects duplicate/foreign lists and malformed records", async () => {
    const f = fixture(), a = value(await create(choice, f.deps)), r = f.records[0];
    f.deps.preparationRepository.listByApplicationId = async () => ({ ok: true, value: [r, r] }); expect(await list("A", f.deps)).toMatchObject({ ok: false, code: "INVALID_PREPARATION_DATA" });
    r.applicationId = "B"; r.plan.applicationId = "B";
    f.deps.preparationRepository.listByApplicationId = async () => ({ ok: true, value: [r] }); expect(await list("A", f.deps)).toMatchObject({ ok: false, code: "INVALID_PREPARATION_DATA" });
    r.plan.questions[0].evidenceIds.push("missing"); expect(await load("A", a.preparationId, f.deps)).toMatchObject({ ok: false, code: "INVALID_PREPARATION_DATA" });
  });
  it("returns detached UI objects", async () => {
    const f = fixture(), a = value(await create(choice, f.deps)), before = structuredClone(a); a.questions[0].prompt = "CHANGED";
    expect(value(await load("A", a.preparationId, f.deps))).toEqual(before);
  });
  it.each(["WRITE_FAILURE", "CORRUPT_STORAGE", "UNSUPPORTED_SCHEMA_VERSION"] as const)("sanitizes repository %s", async (code) => {
    const f = fixture(); f.deps.preparationRepository.create = async () => ({ ok: false, error: { code, message: "SECRET_PATH" } });
    const r = await create(choice, f.deps); expect(r).toMatchObject({ ok: false, code: code === "WRITE_FAILURE" ? "REPOSITORY_ERROR" : "INVALID_PREPARATION_DATA" }); expect(JSON.stringify(r)).not.toContain("SECRET");
  });
  it("sanitizes thrown errors in all operations", async () => {
    const f = fixture(); f.deps.applicationRepository.getById = async () => { throw new Error("SECRET_PATH profile body"); };
    for (const r of [await create(choice, f.deps), await list("A", f.deps), await load("A", "id", f.deps)]) { expect(r).toMatchObject({ ok: false, code: "REPOSITORY_ERROR" }); expect(JSON.stringify(r)).not.toContain("SECRET"); }
  });
  it("rejects invalid read IDs and missing application", async () => {
    const f = fixture(); expect(await list(" ", f.deps)).toMatchObject({ ok: false, code: "INVALID_REQUEST" }); expect(await load("A", "", f.deps)).toMatchObject({ ok: false, code: "INVALID_REQUEST" }); expect(await load("missing", "id", f.deps)).toMatchObject({ ok: false, code: "APPLICATION_NOT_FOUND" });
  });
  it("needs no network, session or document dependencies", async () => {
    const f = fixture(), network = spyOn(globalThis, "fetch");
    try { const a = value(await create(choice, f.deps)); value(await list("A", f.deps)); value(await load("A", a.preparationId, f.deps)); expect(network).not.toHaveBeenCalled(); } finally { network.mockRestore(); }
    expect(Object.keys(f.deps).sort()).toEqual(["applicationRepository", "associationRepository", "candidateRepository", "preparationRepository", "profileRepository"]);
  });
  it("reports missing configuration", async () => {
    const before = process.env.INTERVIEW_PREPARATION_REPOSITORY; delete process.env.INTERVIEW_PREPARATION_REPOSITORY;
    try { for (const r of [await create(choice), await list("A"), await load("A", "id")]) expect(r).toMatchObject({ ok: false, code: "CONFIGURATION_MISSING" }); }
    finally { if (before === undefined) delete process.env.INTERVIEW_PREPARATION_REPOSITORY; else process.env.INTERVIEW_PREPARATION_REPOSITORY = before; }
  });
});
