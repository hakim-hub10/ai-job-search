import { describe, expect, it, mock, spyOn } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ApplicationRecord } from "../../../.agents/job-search/cli/src/applications";
import type { InterviewPreparationRecord } from "../../../.agents/job-search/cli/src/interview-preparation-repository";
import type { InterviewSession } from "../../../.agents/job-search/cli/src/interview-session";
import type { InterviewSessionPreparationLink } from "../../../.agents/job-search/cli/src/interview-session-preparation-link-repository";
import * as sessionCore from "../../../.agents/job-search/cli/src/interview-session";
import * as preparationCore from "../../../.agents/job-search/cli/src/interview-preparation";
import { createFileInterviewPreparationRepository } from "../../../.agents/job-search/cli/src/interview-preparation-file-repository";
import { createFileInterviewSessionRepository } from "../../../.agents/job-search/cli/src/interview-session-file-repository";
import { createFileInterviewSessionPreparationLinkRepository } from "../../../.agents/job-search/cli/src/interview-session-preparation-link-file-repository";
import type { MockInterviewResult, MockInterviewStartDependencies } from "./mock-interview-data";
mock.module("server-only", () => ({}));
const { loadApplicationMockInterviewFeedback: loadFeedback, skipApplicationMockInterviewQuestion: skip, startApplicationMockInterview: start, loadApplicationMockInterview: load, submitApplicationMockInterviewAnswer: submit } = await import("./mock-interview-data");
const missing = { ok: false as const, error: { code: "NOT_FOUND" as const, message: "SECRET_PATH" } };
const input = { applicationId: "A", preparationId: "prep-A" };
function value<T>(r: MockInterviewResult<T>) { if (!r.ok) throw new Error(r.code); return r.value; }
function preparation(id = "prep-A", applicationId = "A"): InterviewPreparationRecord {
  return { id, applicationId, candidateId: "candidate-A", plan: { applicationId, language: "sv", interviewType: "behavioral",
    job: { jobId: "job", source: "test", sourceId: null, jobTitle: "Supporttekniker", company: "Testbolaget" },
    questions: [{ id: "q1", category: "behavioral", prompt: "Historisk fråga A", rationale: "Historiskt syfte A", requirementKeys: ["skill:support"], evidenceIds: ["experience"], gapKeys: [] },
      { id: "q2", category: "closing", prompt: "Nästa fråga", rationale: "Förtydliga", requirementKeys: [], evidenceIds: [], gapKeys: [] }],
    starPrompts: [{ questionId: "q1", evidenceIds: ["experience"], situationPrompt: "Situation A", taskPrompt: "Uppgift A", actionPrompt: "Handling A", resultPrompt: "Resultat A", warnings: ["Hitta inte på resultat."] }], warnings: [] },
    evidenceSnapshot: [{ id: "experience", kind: "experience", content: "Historisk erfarenhet A", relatedRequirements: [{ category: "skill", value: "Support" }] }],
    requirementContext: [{ requirement: { identity: { key: "skill:support", category: "skill", original: "Support", normalized: "support" }, importance: "required" }, status: "matched", evidenceIds: ["experience"] }] };
}
function fixture() {
  const preparations = new Map([["prep-A", preparation()]]), sessions = new Map<string, InterviewSession>(), links = new Map<string, InterviewSessionPreparationLink>();
  const calls: string[] = [];
  const deps: MockInterviewStartDependencies = {
    applicationRepository: { async getById(id) { calls.push(`app:${id}`); return ["A", "B"].includes(id) ? { ok: true, value: { id } as ApplicationRecord } : missing; } },
    preparationRepository: { async getById(id) { calls.push(`prep:${id}`); const r = preparations.get(id); return r ? { ok: true, value: structuredClone(r) } : missing; } },
    sessionRepository: {
      async getById(id) { const s = sessions.get(id); return s ? { ok: true, value: structuredClone(s) } : missing; },
      async save(s) { calls.push("save"); sessions.set(s.id, structuredClone(s)); return { ok: true, value: structuredClone(s) }; },
    },
    linkRepository: {
      async create(l) { calls.push("link"); links.set(l.sessionId, structuredClone(l)); return { ok: true, value: structuredClone(l) }; },
      async getBySessionId(id) { calls.push("resolve"); const l = links.get(id); return l ? { ok: true, value: structuredClone(l) } : missing; },
    },
  }; return { deps, preparations, sessions, links, calls };
}
describe("mock interview data", () => {
  it("starts from the exact stored plan and succeeds only after session, link and resolution", async () => {
    const f = fixture(), before = structuredClone([...f.preparations]); const spy = spyOn(sessionCore, "startInterviewSession");
    try {
      const r = value(await start(input, f.deps)); expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toEqual(f.preparations.get("prep-A")!.plan);
      const session = f.sessions.get(r.session.sessionId)!;
      expect(session).toMatchObject({ applicationId: "A", language: "sv", interviewType: "behavioral", currentQuestionIndex: 0, turns: [], planQuestionIds: ["q1", "q2"] });
      expect(session.id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
      expect(f.links.get(session.id)).toEqual({ sessionId: session.id, applicationId: "A", preparationRecordId: "prep-A" });
      expect(f.calls.indexOf("save")).toBeLessThan(f.calls.indexOf("link")); expect(f.calls.indexOf("link")).toBeLessThan(f.calls.indexOf("resolve"));
      expect(r.currentQuestion).toMatchObject({ id: "q1", prompt: "Historisk fråga A", evidence: [{ id: "experience", content: "Historisk erfarenhet A" }] });
      expect([...f.preparations]).toEqual(before); expect(JSON.stringify(r)).not.toMatch(/candidateId|turns|sourceId|SECRET|warningCounts/);
    } finally { spy.mockRestore(); }
  });
  it("ignores browser-supplied plan, language, type and ownership", async () => {
    const f = fixture(), r = value(await start({ ...input, ...{ language: "en", interviewType: "situational", candidateId: "B", plan: "FAKE", questionIds: ["FAKE"] } }, f.deps));
    expect(r.session).toMatchObject({ language: "sv", interviewType: "behavioral" }); expect(JSON.stringify(r)).not.toContain("FAKE");
  });
  it.each([{ applicationId: "" }, { preparationId: " " }, { applicationId: null }, { preparationId: 5 }])("rejects malformed IDs before reads: %j", async (invalid) => {
    const f = fixture(); expect(await start({ ...input, ...invalid }, f.deps)).toMatchObject({ ok: false, code: "INVALID_REQUEST" }); expect(f.calls).toEqual([]);
  });
  it.each(["application", "preparation", "foreign"])("rejects missing/foreign %s before writes", async (kind) => {
    const f = fixture(); if (kind === "foreign") f.preparations.set("prep-A", preparation("prep-A", "B"));
    const r = await start({ applicationId: kind === "application" ? "missing" : "A", preparationId: kind === "preparation" ? "missing" : "prep-A" }, f.deps);
    expect(r).toMatchObject({ ok: false, code: kind === "application" ? "APPLICATION_NOT_FOUND" : "PREPARATION_NOT_FOUND" }); expect(f.sessions.size).toBe(0); expect(f.links.size).toBe(0);
  });
  it("rejects malformed preparation and wrong returned preparation ID", async () => {
    const f = fixture(); f.preparations.get("prep-A")!.id = "OTHER";
    expect(await start(input, f.deps)).toMatchObject({ ok: false, code: "INVALID_INTERVIEW_DATA" });
    f.preparations.get("prep-A")!.id = "prep-A"; f.preparations.get("prep-A")!.plan.questions[0].evidenceIds = ["MISSING"];
    expect(await start(input, f.deps)).toMatchObject({ ok: false, code: "INVALID_INTERVIEW_DATA" }); expect(f.sessions.size).toBe(0);
  });
  it("does not overwrite history if the random ID collides", async () => {
    const f = fixture(), spy = spyOn(crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");
    try { value(await start(input, f.deps)); const before = structuredClone([...f.sessions]); expect(await start(input, f.deps)).toMatchObject({ ok: false, code: "SESSION_CREATION_FAILED" }); expect([...f.sessions]).toEqual(before); } finally { spy.mockRestore(); }
  });
  it("returns failure and never links when session persistence fails", async () => {
    const f = fixture(); f.deps.sessionRepository.save = async () => ({ ok: false, error: { code: "WRITE_FAILURE", message: "SECRET" } });
    expect(await start(input, f.deps)).toMatchObject({ ok: false, code: "SESSION_CREATION_FAILED" }); expect(f.links.size).toBe(0);
  });
  it("leaves a persisted session explicitly unlinked after link failure", async () => {
    const f = fixture(); f.deps.linkRepository.create = async () => ({ ok: false, error: { code: "WRITE_FAILURE", message: "SECRET" } });
    expect(await start(input, f.deps)).toMatchObject({ ok: false, code: "SESSION_CREATION_FAILED" }); expect(f.sessions.size).toBe(1); expect(f.links.size).toBe(0);
    expect(await load("A", [...f.sessions.keys()][0], f.deps)).toMatchObject({ ok: false, code: "UNLINKED_SESSION" });
  });
  it("does not report success when durable resolution fails after both writes", async () => {
    const f = fixture(); f.deps.linkRepository.getBySessionId = async () => ({ ok: false, error: { code: "READ_FAILURE", message: "SECRET" } });
    expect(await start(input, f.deps)).toMatchObject({ ok: false, code: "SESSION_CREATION_FAILED" }); expect(f.sessions.size).toBe(1); expect(f.links.size).toBe(1);
  });
  it("verifies persistence rather than trusting successful write return values", async () => {
    const f = fixture(); f.deps.sessionRepository.save = async (s) => ({ ok: true, value: s });
    expect(await start(input, f.deps)).toMatchObject({ ok: false, code: "SESSION_CREATION_FAILED" });
  });
  it("rejects a substituted preparation even with compatible question IDs", async () => {
    const f = fixture(); const b = preparation("prep-B"); b.plan.questions[0].prompt = "Different"; f.preparations.set(b.id, b);
    f.deps.linkRepository.create = async (l) => { f.links.set(l.sessionId, { ...l, preparationRecordId: "prep-B" }); return { ok: true, value: l }; };
    expect(await start(input, f.deps)).toMatchObject({ ok: false, code: "SESSION_CREATION_FAILED" });
  });
  it("retains exact history A after preparation B with identical question IDs is saved; no current profile or generation", async () => {
    const f = fixture(); const dir = await mkdtemp(join(tmpdir(), "mock-history-"));
    try {
      const preparations = createFileInterviewPreparationRepository(join(dir, "preparations.json")); await preparations.create(preparation());
      const sessions = createFileInterviewSessionRepository(join(dir, "sessions.json"));
      const links = createFileInterviewSessionPreparationLinkRepository(join(dir, "links.json"), { sessionRepository: sessions, preparationRepository: preparations });
      const deps = { ...f.deps, preparationRepository: preparations, sessionRepository: sessions, linkRepository: links };
      const r = value(await start(input, deps));
      const b = preparation("zzz-new"); b.plan.questions[0].prompt = "CHANGED"; b.evidenceSnapshot.reverse(); b.evidenceSnapshot[0].content = "CHANGED";
      await preparations.create(b); const before = await Promise.all(["sessions.json", "links.json", "preparations.json"].map((p) => readFile(join(dir, p), "utf8")));
      const spy = spyOn(preparationCore, "createInterviewPreparationPlan");
      try { expect(value(await load("A", r.session.sessionId, deps))).toEqual(r); expect(spy).not.toHaveBeenCalled(); } finally { spy.mockRestore(); }
      expect(await Promise.all(["sessions.json", "links.json", "preparations.json"].map((p) => readFile(join(dir, p), "utf8")))).toEqual(before);
      expect((await readdir(dir)).sort()).toEqual(["links.json", "preparations.json", "sessions.json"]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("serializes concurrent starts without losing sessions or links", async () => {
    const f = fixture(); let active = false;
    const save = f.deps.sessionRepository.save, link = f.deps.linkRepository.create;
    f.deps.sessionRepository.save = async (s) => { expect(active).toBe(false); active = true; return save(s); };
    f.deps.linkRepository.create = async (l) => { const r = await link(l); active = false; return r; };
    const results = await Promise.all([start(input, f.deps), start(input, f.deps)]);
    expect(results.every((r) => r.ok)).toBe(true); expect(f.sessions.size).toBe(2); expect(f.links.size).toBe(2);
  });
  it("conceals foreign sessions and rejects cross-application links", async () => {
    const f = fixture(), r = value(await start(input, f.deps));
    expect(await load("B", r.session.sessionId, f.deps)).toMatchObject({ ok: false, code: "INTERVIEW_SESSION_NOT_FOUND" });
    f.links.get(r.session.sessionId)!.applicationId = "B";
    expect(await load("A", r.session.sessionId, f.deps)).toMatchObject({ ok: false, code: "INVALID_INTERVIEW_DATA" });
  });
  it("reads completed persisted sessions without question, feedback or advancement", async () => {
    const f = fixture(), r = value(await start(input, f.deps)); const s = f.sessions.get(r.session.sessionId)!;
    s.status = "completed"; s.currentQuestionIndex = s.planQuestionIds.length; s.turns = s.planQuestionIds.map((questionId) => ({ status: "skipped", questionId }));
    const before = structuredClone(s); const read = value(await load("A", s.id, f.deps)); expect(read.currentQuestion).toBeNull(); expect(read.session).toMatchObject({ status: "completed", remainingQuestions: 0 }); expect(f.sessions.get(s.id)).toEqual(before);
  });
  it("submits a transient free-text answer through the linked preparation and persists only preparation metadata", async () => {
    const f = fixture(), started = value(await start(input, f.deps)), beforePreparation = structuredClone(f.preparations.get("prep-A")), beforeLink = structuredClone(f.links.get(started.session.sessionId));
    const other = preparation("prep-B"); other.plan.questions[0].prompt = "Fråga från en annan förberedelse"; f.preparations.set(other.id, other);
    const answered = value(await submit({ applicationId: "A", sessionId: started.session.sessionId, expectedQuestionId: "q1", fields: { format: "freeText", text: "Ett verkligt svar som är tillräckligt långt för att passera genom förberedelsen." } }, f.deps));
    expect(answered.currentQuestion?.id).toBe("q2"); expect(answered.session).toMatchObject({ currentQuestionIndex: 1, answeredQuestions: 1, remainingQuestions: 1 });
    const stored = f.sessions.get(started.session.sessionId)!; expect(stored.turns[0]).toMatchObject({ status: "submitted", questionId: "q1", answerFormat: "freeText" });
    expect(JSON.stringify(stored)).not.toContain("Ett verkligt svar"); expect(f.preparations.get("prep-A")).toEqual(beforePreparation); expect(f.links.get(started.session.sessionId)).toEqual(beforeLink);
  });
  it("skips questions in authoritative order and completes without fabricated answer data", async () => {
    const f = fixture(), started = value(await start(input, f.deps));
    const next = value(await skip({ applicationId: "A", sessionId: started.session.sessionId, expectedQuestionId: "q1" }, f.deps));
    expect(next.currentQuestion?.id).toBe("q2"); expect(f.sessions.get(started.session.sessionId)!.turns[0]).toEqual({ status: "skipped", questionId: "q1" });
    const completed = value(await skip({ applicationId: "A", sessionId: started.session.sessionId, expectedQuestionId: "q2" }, f.deps));
    expect(completed.session.status).toBe("completed"); expect(completed.currentQuestion).toBeNull(); expect(JSON.stringify(f.sessions.get(started.session.sessionId))).not.toMatch(/answer|Ett verkligt svar/i);
  });
  it("rejects stale and replayed answer forms before changing the session", async () => {
    const f = fixture(), started = value(await start(input, f.deps));
    expect(await submit({ applicationId: "A", sessionId: started.session.sessionId, expectedQuestionId: "q2", fields: { format: "freeText", text: "Gammalt formulär" } }, f.deps)).toMatchObject({ ok: false, code: "STALE_QUESTION" });
    value(await submit({ applicationId: "A", sessionId: started.session.sessionId, expectedQuestionId: "q1", fields: { format: "freeText", text: "Ett giltigt svar som är tillräckligt långt för att behandlas korrekt." } }, f.deps));
    expect(await submit({ applicationId: "A", sessionId: started.session.sessionId, expectedQuestionId: "q1", fields: { format: "freeText", text: "Ett gammalt svar" } }, f.deps)).toMatchObject({ ok: false, code: "STALE_QUESTION" });
    expect(f.sessions.get(started.session.sessionId)!.turns).toHaveLength(1);
  });
  it("fails safely when updated session persistence fails", async () => {
    const f = fixture(), started = value(await start(input, f.deps)), before = structuredClone(f.sessions.get(started.session.sessionId));
    f.deps.sessionRepository.save = async () => ({ ok: false, error: { code: "WRITE_FAILURE", message: "SECRET" } });
    expect(await submit({ applicationId: "A", sessionId: started.session.sessionId, expectedQuestionId: "q1", fields: { format: "freeText", text: "Ett svar som inte får rapporteras som sparat." } }, f.deps)).toMatchObject({ ok: false, code: "ANSWER_SUBMISSION_FAILED" });
    expect(f.sessions.get(started.session.sessionId)).toEqual(before);
  });
  it("rejects missing, foreign, unlinked, completed and malformed answer requests safely", async () => {
    const f = fixture();
    expect(await submit({ applicationId: "missing", sessionId: "session", expectedQuestionId: "q1", fields: { format: "freeText", text: "Svar" } }, f.deps)).toMatchObject({ ok: false, code: "APPLICATION_NOT_FOUND" });
    expect(await submit({ applicationId: "A", sessionId: "missing", expectedQuestionId: "q1", fields: { format: "freeText", text: "Svar" } }, f.deps)).toMatchObject({ ok: false, code: "INTERVIEW_SESSION_NOT_FOUND" });
    const started = value(await start(input, f.deps));
    f.links.delete(started.session.sessionId);
    expect(await submit({ applicationId: "A", sessionId: started.session.sessionId, expectedQuestionId: "q1", fields: { format: "freeText", text: "Svar" } }, f.deps)).toMatchObject({ ok: false, code: "UNLINKED_SESSION" });
    f.links.set(started.session.sessionId, { sessionId: started.session.sessionId, applicationId: "B", preparationRecordId: "prep-A" });
    expect(await submit({ applicationId: "A", sessionId: started.session.sessionId, expectedQuestionId: "q1", fields: { format: "freeText", text: "Svar" } }, f.deps)).toMatchObject({ ok: false, code: "INVALID_INTERVIEW_DATA" });
    const second = fixture(), completed = value(await start(input, second.deps));
    second.sessions.get(completed.session.sessionId)!.status = "completed"; second.sessions.get(completed.session.sessionId)!.currentQuestionIndex = 2; second.sessions.get(completed.session.sessionId)!.turns = [{ status: "skipped", questionId: "q1" }, { status: "skipped", questionId: "q2" }];
    expect(await submit({ applicationId: "A", sessionId: completed.session.sessionId, expectedQuestionId: "q1", fields: { format: "freeText", text: "Svar" } }, second.deps)).toMatchObject({ ok: false, code: "SESSION_ALREADY_COMPLETED" });
    expect(await submit({ applicationId: "A", sessionId: completed.session.sessionId, expectedQuestionId: "q1", fields: { format: "unsupported", text: "Svar" } }, second.deps)).toMatchObject({ ok: false, code: "SESSION_ALREADY_COMPLETED" });
  });
  it("derives completed feedback from the exact linked preparation without mutation or raw answers", async () => {
    const f = fixture(), started = value(await start(input, f.deps));
    value(await submit({ applicationId: "A", sessionId: started.session.sessionId, expectedQuestionId: "q1", fields: { format: "freeText", text: "Detta råa svar ska aldrig visas eller rekonstrueras." } }, f.deps));
    value(await skip({ applicationId: "A", sessionId: started.session.sessionId, expectedQuestionId: "q2" }, f.deps));
    const other = preparation("prep-B"); other.plan.questions[0].prompt = "En annan historisk fråga"; f.preparations.set(other.id, other);
    const before = structuredClone({ preparations: [...f.preparations], sessions: [...f.sessions], links: [...f.links] });
    const result = value(await loadFeedback("A", started.session.sessionId, f.deps));
    expect(result.application.jobTitle).toBe("Supporttekniker"); expect(result.questions.map((question) => question.prompt)).toEqual(["Historisk fråga A", "Nästa fråga"]);
    expect(result.questions.map((question) => question.status)).toEqual(["submitted", "skipped"]); expect(result.summary.answeredQuestions).toBe(1); expect(result.summary.skippedQuestions).toBe(1);
    expect(JSON.stringify(result)).not.toContain("Detta råa svar"); expect(JSON.stringify(result)).not.toMatch(/candidateId|evidenceSnapshot|preparationRecordId/);
    expect(f.preparations).toEqual(new Map(before.preparations)); expect(f.sessions).toEqual(new Map(before.sessions)); expect(f.links).toEqual(new Map(before.links));
  });
  it("requires a completed explicitly linked session and never searches for latest context", async () => {
    const f = fixture(), started = value(await start(input, f.deps));
    expect(await loadFeedback("A", started.session.sessionId, f.deps)).toMatchObject({ ok: false, code: "SESSION_INCOMPLETE" });
    const stored = f.sessions.get(started.session.sessionId)!; stored.status = "completed"; stored.currentQuestionIndex = stored.planQuestionIds.length; stored.turns = stored.planQuestionIds.map((questionId) => ({ status: "skipped" as const, questionId }));
    f.links.delete(started.session.sessionId);
    expect(await loadFeedback("A", started.session.sessionId, f.deps)).toMatchObject({ ok: false, code: "UNLINKED_SESSION" });
    expect(await loadFeedback("missing", started.session.sessionId, f.deps)).toMatchObject({ ok: false, code: "APPLICATION_NOT_FOUND" });
    expect(await loadFeedback("A", "missing", f.deps)).toMatchObject({ ok: false, code: "INTERVIEW_SESSION_NOT_FOUND" });
  });
  it("returns safe missing and invalid request states", async () => {
    const f = fixture(); expect(await load("A", "missing", f.deps)).toMatchObject({ ok: false, code: "INTERVIEW_SESSION_NOT_FOUND" });
    expect(await load("missing", "id", f.deps)).toMatchObject({ ok: false, code: "APPLICATION_NOT_FOUND" });
    expect(await load("", "id", f.deps)).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
  });
  it("sanitizes thrown errors and missing configuration", async () => {
    const f = fixture(); f.deps.applicationRepository.getById = async () => { throw new Error("SECRET_PATH"); };
    for (const r of [await start(input, f.deps), await load("A", "id", f.deps)]) { expect(r).toMatchObject({ ok: false, code: "REPOSITORY_ERROR" }); expect(JSON.stringify(r)).not.toContain("SECRET"); }
    const before = process.env.INTERVIEW_SESSION_PREPARATION_LINK_REPOSITORY; delete process.env.INTERVIEW_SESSION_PREPARATION_LINK_REPOSITORY;
    try { expect(await start(input)).toMatchObject({ ok: false, code: "CONFIGURATION_MISSING" }); expect(await load("A", "id")).toMatchObject({ ok: false, code: "CONFIGURATION_MISSING" }); }
    finally { if (before !== undefined) process.env.INTERVIEW_SESSION_PREPARATION_LINK_REPOSITORY = before; }
  });
  it("does not call providers, generation, answer submission or progression", async () => {
    const f = fixture(); const spies = [spyOn(globalThis, "fetch"), spyOn(preparationCore, "createInterviewPreparationPlan"), spyOn(sessionCore, "submitInterviewAnswer"), spyOn(sessionCore, "skipCurrentInterviewQuestion")];
    try { const r = value(await start(input, f.deps)); value(await load("A", r.session.sessionId, f.deps)); for (const spy of spies) expect(spy).not.toHaveBeenCalled(); expect(f.sessions.get(r.session.sessionId)!.turns).toEqual([]); }
    finally { spies.forEach((s) => s.mockRestore()); }
  });
});
