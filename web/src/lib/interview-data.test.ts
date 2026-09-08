import { describe, expect, it, spyOn, mock } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { ApplicationRecord } from "../../../.agents/job-search/cli/src/applications";
import type { InterviewSession } from "../../../.agents/job-search/cli/src/interview-session";
import { startInterviewSession, submitInterviewAnswer, skipCurrentInterviewQuestion } from "../../../.agents/job-search/cli/src/interview-session";
import type { InterviewPreparationPlan } from "../../../.agents/job-search/cli/src/interview-preparation";
import type { InterviewHistoryDependencies, InterviewReadDependencies } from "./interview-data";

// Next.js resolves this compile-time marker; Bun runs these tests on the server.
mock.module("server-only", () => ({}));
const { loadInterviewHistory, loadInterviewOverview, loadInterviewSession } = await import("./interview-data");

const application = {
  id: "A", jobSnapshot: { title: "Supporttekniker", company: "Testbolaget", description: "PRIVATE_JOB_CONTEXT" },
} as ApplicationRecord;
const plan: InterviewPreparationPlan = {
  applicationId: "A", language: "sv", interviewType: "behavioral",
  job: { jobId: "job", source: "test", sourceId: null, jobTitle: "Supporttekniker", company: "Testbolaget" },
  questions: ["q1", "q2", "q3"].map((id) => ({ id, category: "general", prompt: "Berätta", rationale: "Test", requirementKeys: [], evidenceIds: [], gapKeys: [] })),
  starPrompts: [], warnings: [],
};
function initial(id = "session-1", applicationId = "A"): InterviewSession {
  const result = startInterviewSession({ ...plan, applicationId }, { sessionId: id });
  if (!result.ok) throw new Error("Invalid fixture");
  return result.value;
}
function progressed(completed = false): InterviewSession {
  const answer = submitInterviewAnswer(initial(), plan, { evidence: [] }, {
    questionId: "q1", format: "freeText", text: "PRIVATE_ANSWER I improved results by 35%.",
  });
  if (!answer.ok) throw new Error("Invalid answer fixture");
  const skipped = skipCurrentInterviewQuestion(answer.value, plan);
  if (!skipped.ok) throw new Error("Invalid skip fixture");
  if (!completed) return skipped.value;
  const last = skipCurrentInterviewQuestion(skipped.value, plan);
  if (!last.ok) throw new Error("Invalid completion fixture");
  return last.value;
}
function dependencies(sessions: InterviewSession[] = []): InterviewReadDependencies {
  return {
    applicationRepository: { async getById(id) {
      return id === "A" || id === "B" ? { ok: true, value: { ...application, id } }
        : { ok: false, error: { code: "NOT_FOUND", message: "PRIVATE_PATH" } };
    } },
    sessionRepository: {
      async listByApplicationId(id) { return { ok: true, value: sessions.filter((session) => session.applicationId === id) }; },
      async getById(id) {
        const value = sessions.find((session) => session.id === id);
        return value ? { ok: true, value } : { ok: false, error: { code: "NOT_FOUND", message: "PRIVATE_PATH" } };
      },
    },
  };
}
function historyDependencies(sessions: InterviewSession[] = [], linked = new Map<string, string>()): InterviewHistoryDependencies {
  const base = dependencies(sessions);
  const record = (id: string) => ({ id, applicationId: "A", candidateId: "candidate-A", plan: { ...plan }, evidenceSnapshot: [], requirementContext: [] });
  return { ...base,
    preparationRepository: { async getById(id) { const preparationId = [...linked.entries()].find(([, value]) => value === id)?.[1] ?? id; return linked.has(id) || [...linked.values()].includes(id) ? { ok: true, value: record(preparationId) } : { ok: false, error: { code: "NOT_FOUND" as const, message: "PRIVATE_PATH" } }; } },
    linkRepository: { async getBySessionId(id) { const preparationId = linked.get(id); return preparationId ? { ok: true, value: { sessionId: id, applicationId: "A", preparationRecordId: preparationId } } : { ok: false, error: { code: "NOT_FOUND" as const, message: "PRIVATE_PATH" } }; } },
  };
}
function freeze(value: unknown): void {
  if (!value || typeof value !== "object") return;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
}

describe("interview web reads", () => {
  it("loads empty application history without temporal or latest semantics", async () => {
    const result = await loadInterviewHistory("A", historyDependencies());
    expect(result).toEqual({ ok: true, value: { applicationId: "A", jobTitle: "Supporttekniker", company: "Testbolaget", sessions: [] } });
    expect(JSON.stringify(result)).not.toMatch(/latest|newest|recent|chronolog|createdAt|updatedAt/);
  });
  it("represents linked and legacy sessions with factual progress and stable repository order", async () => {
    const completed = progressed(true); completed.id = "completed"; const active = progressed(false); active.id = "active";
    const sessions = [completed, initial("legacy"), active]; const linked = new Map([[completed.id, "prep-complete"], [active.id, "prep-active"]]);
    const result = await loadInterviewHistory("A", historyDependencies(sessions, linked));
    expect(result).toMatchObject({ ok: true, value: { sessions: [
      { sessionId: "completed", status: "completed", preparationStatus: "linked", preparationId: "prep-complete", feedbackAvailable: true, answeredQuestions: 1, skippedQuestions: 2 },
      { sessionId: "legacy", preparationStatus: "unlinked", preparationId: null, feedbackAvailable: false },
      { sessionId: "active", preparationStatus: "linked", preparationId: "prep-active", feedbackAvailable: false, remainingQuestions: 1 },
    ] } });
  });
  it("excludes foreign sessions and keeps broken linked context entry-safe", async () => {
    const foreign = initial("foreign", "B"); const local = initial("local"); const deps = historyDependencies([local], new Map());
    deps.sessionRepository.listByApplicationId = async () => ({ ok: true, value: [local, foreign] });
    expect(await loadInterviewHistory("A", deps)).toMatchObject({ ok: false, code: "INVALID_INTERVIEW_DATA" });
    const broken = historyDependencies([local], new Map([[local.id, "missing-preparation"]]))
    broken.preparationRepository.getById = async () => ({ ok: false, error: { code: "NOT_FOUND" as const, message: "PRIVATE" } });
    expect(await loadInterviewHistory("A", broken)).toMatchObject({ ok: true, value: { sessions: [{ preparationStatus: "unavailable", feedbackAvailable: false }] } });
  });
  it("does not write or invoke AI while reading history", async () => {
    const session = progressed(); const deps = historyDependencies([session]); const before = JSON.stringify(session); const network = spyOn(globalThis, "fetch");
    try { const result = await loadInterviewHistory("A", deps); expect(result.ok).toBe(true); expect(JSON.stringify(session)).toBe(before); expect(network).not.toHaveBeenCalled(); } finally { network.mockRestore(); }
  });
  it("returns an existing application with an empty collection", async () => {
    expect(await loadInterviewOverview("A", dependencies())).toEqual({ ok: true, value: {
      applicationId: "A", jobTitle: "Supporttekniker", company: "Testbolaget", sessions: [],
    } });
  });
  it("maps one session using domain progress counts", async () => {
    const result = await loadInterviewOverview("A", dependencies([initial()]));
    expect(result).toEqual({ ok: true, value: {
      applicationId: "A", jobTitle: "Supporttekniker", company: "Testbolaget",
      sessions: [{ sessionId: "session-1", applicationId: "A", language: "sv", interviewType: "behavioral",
        status: "inProgress", currentQuestionIndex: 0, totalQuestions: 3, answeredQuestions: 0, skippedQuestions: 0, remainingQuestions: 3 }],
    } });
  });
  it("preserves repository order without selecting a latest session", async () => {
    const deps = dependencies([initial("z"), initial("a")]);
    const first = await loadInterviewOverview("A", deps);
    expect(first).toEqual(await loadInterviewOverview("A", deps));
    if (!first.ok) throw new Error("Expected overview");
    expect(first.value.sessions.map((session) => session.sessionId)).toEqual(["z", "a"]);
    expect(JSON.stringify(first)).not.toMatch(/latest|recent|createdAt|updatedAt|feedback|preparation|score|probability/i);
  });
  it("isolates two applications", async () => {
    const deps = dependencies([initial("one"), initial("two"), initial("three", "B")]);
    const a = await loadInterviewOverview("A", deps);
    const b = await loadInterviewOverview("B", deps);
    if (!a.ok || !b.ok) throw new Error("Expected overview");
    expect(a.value.sessions.map((session) => session.sessionId)).toEqual(["one", "two"]);
    expect(b.value.sessions.map((session) => session.sessionId)).toEqual(["three"]);
  });
  it("loads an explicit session with answered, skipped and remaining counts", async () => {
    expect(await loadInterviewSession("A", "session-1", dependencies([progressed()]))).toMatchObject({ ok: true, value: {
      applicationId: "A", session: { status: "inProgress", totalQuestions: 3, answeredQuestions: 1, skippedQuestions: 1, remainingQuestions: 1, currentQuestionIndex: 2 },
    } });
  });
  it("represents completion using the existing domain status", async () => {
    expect(await loadInterviewSession("A", "session-1", dependencies([progressed(true)]))).toMatchObject({ ok: true, value: {
      session: { status: "completed", answeredQuestions: 1, skippedQuestions: 2, remainingQuestions: 0, currentQuestionIndex: 3 },
    } });
  });
  it("checks application existence before consulting sessions", async () => {
    const deps = dependencies();
    deps.sessionRepository.getById = deps.sessionRepository.listByApplicationId = async () => { throw new Error("Should not be called"); };
    expect(await loadInterviewOverview("missing", deps)).toMatchObject({ ok: false, code: "APPLICATION_NOT_FOUND" });
    expect(await loadInterviewSession("missing", "id", deps)).toMatchObject({ ok: false, code: "APPLICATION_NOT_FOUND" });
  });
  it("maps a missing session and another application's session identically", async () => {
    const deps = dependencies([initial("foreign", "B")]);
    const missing = await loadInterviewSession("A", "missing", deps);
    expect(missing).toMatchObject({ ok: false, code: "INTERVIEW_SESSION_NOT_FOUND" });
    expect(await loadInterviewSession("A", "foreign", deps)).toEqual(missing);
  });
  it("fails closed if a list repository returns a foreign session", async () => {
    const deps = dependencies();
    deps.sessionRepository.listByApplicationId = async () => ({ ok: true, value: [initial(), initial("foreign", "B")] });
    expect(await loadInterviewOverview("A", deps)).toMatchObject({ ok: false, code: "INVALID_INTERVIEW_DATA" });
  });
  it("rejects duplicate IDs returned by a repository", async () => {
    expect(await loadInterviewOverview("A", dependencies([initial(), initial()]))).toMatchObject({ ok: false, code: "INVALID_INTERVIEW_DATA" });
  });
  it("rejects a repository returning the wrong session ID", async () => {
    const deps = dependencies();
    deps.sessionRepository.getById = async () => ({ ok: true, value: initial("wrong") });
    expect(await loadInterviewSession("A", "wanted", deps)).toMatchObject({ ok: false, code: "INVALID_INTERVIEW_DATA" });
  });
  it.each([null, { ...application, id: "B" }, { id: "A", jobSnapshot: { title: 4, company: null } }])("rejects malformed/mismatched application context %j", async (value) => {
    const deps = dependencies();
    deps.applicationRepository.getById = async () => ({ ok: true, value: value as unknown as ApplicationRecord });
    expect(await loadInterviewOverview("A", deps)).toMatchObject({ ok: false, code: "INVALID_INTERVIEW_DATA" });
  });
  it.each([null, { ...initial(), currentQuestionIndex: 9 }, { ...progressed(), turns: [{ status: "submitted", questionId: "q1", preparation: {} }] }])("rejects malformed session structures %j", async (value) => {
    const deps = dependencies([value as unknown as InterviewSession]);
    deps.sessionRepository.getById = async () => ({ ok: true, value: value as unknown as InterviewSession });
    deps.sessionRepository.listByApplicationId = async () => ({ ok: true, value: [value as unknown as InterviewSession] });
    expect(await loadInterviewOverview("A", deps)).toMatchObject({ ok: false, code: "INVALID_INTERVIEW_DATA" });
    expect(await loadInterviewSession("A", "session-1", deps)).toMatchObject({ ok: false, code: "INVALID_INTERVIEW_DATA" });
  });
  it.each(["CORRUPT_STORAGE", "UNSUPPORTED_SCHEMA_VERSION", "INVALID_RECORD", "READ_FAILURE"] as const)("sanitizes returned repository error %s", async (code) => {
    const deps = dependencies();
    const result = { ok: false as const, error: { code, message: "/private/path SECRET JSON parse error" } };
    deps.sessionRepository.listByApplicationId = async () => result;
    deps.sessionRepository.getById = async () => result;
    const expected = { ok: false, code: code === "READ_FAILURE" ? "REPOSITORY_ERROR" : "INVALID_INTERVIEW_DATA" };
    expect(await loadInterviewOverview("A", deps)).toMatchObject(expected);
    expect(await loadInterviewSession("A", "id", deps)).toMatchObject(expected);
    expect(JSON.stringify(await loadInterviewOverview("A", deps))).not.toMatch(/private|SECRET|parse/);
    deps.applicationRepository.getById = async () => result;
    expect(await loadInterviewOverview("A", deps)).toMatchObject(expected);
  });
  it("sanitizes thrown failures from each read dependency", async () => {
    const explode = async (): Promise<never> => { throw new Error("/private/path SECRET"); };
    const deps = dependencies();
    deps.sessionRepository.listByApplicationId = explode;
    deps.sessionRepository.getById = explode;
    const expected = { ok: false, code: "REPOSITORY_ERROR", message: "Intervjuunderlaget kunde inte läsas." } as const;
    expect(await loadInterviewOverview("A", deps)).toEqual(expected);
    expect(await loadInterviewSession("A", "id", deps)).toEqual(expected);
    deps.applicationRepository.getById = explode;
    expect(await loadInterviewOverview("A", deps)).toEqual(expected);
    expect(await loadInterviewSession("A", "id", deps)).toEqual(expected);
  });
  it("rejects empty identifiers before repository reads", async () => {
    const deps = dependencies();
    expect(await loadInterviewOverview(" ", deps)).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    expect(await loadInterviewSession("A", "", deps)).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
  });
  it("preserves null company labels", async () => {
    const deps = dependencies();
    deps.applicationRepository.getById = async () => ({ ok: true, value: { ...application, jobSnapshot: { ...application.jobSnapshot, company: null } } });
    expect(await loadInterviewOverview("A", deps)).toMatchObject({ ok: true, value: { company: null } });
  });
  it("reads frozen inputs without writes, network calls, logging or private response content", async () => {
    const value = progressed();
    freeze(value);
    freeze(application);
    const before = JSON.stringify({ value, application });
    const deps = dependencies([value]);
    const save = () => { throw new Error("Unexpected mutation"); };
    Object.assign(deps.applicationRepository, { save, create: save });
    Object.assign(deps.sessionRepository, { save });
    const network = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network"));
    const log = spyOn(console, "log");
    const error = spyOn(console, "error");
    try {
      const overview = await loadInterviewOverview("A", deps);
      const detail = await loadInterviewSession("A", value.id, deps);
      expect(overview.ok).toBe(true);
      expect(detail.ok).toBe(true);
      expect(JSON.stringify({ overview, detail })).not.toMatch(/PRIVATE|35%|warnings|protectedFact|turns|evidence|jobSnapshot/);
      expect(JSON.stringify({ value, application })).toBe(before);
      if (overview.ok) overview.value.sessions[0].currentQuestionIndex = 99;
      expect(value.currentQuestionIndex).toBe(2);
      expect(network).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally { network.mockRestore(); log.mockRestore(); error.mockRestore(); }
  });
  it("keeps repository factories server-side and excludes generation dependencies", async () => {
    const source = await readFile(new URL("./interview-data.ts", import.meta.url), "utf8");
    expect(source).toContain('from "node:path"');
    expect(source).not.toMatch(/['"]use client['"]|NEXT_PUBLIC_|interview-ai|providers\/|\.save\(|createInterviewPreparationPlan|createInterviewSessionFeedback/);
    expect(source).toContain('import "server-only";');
  });
  it("reports missing server configuration and a missing configured application without writes", async () => {
    const originalApplication = process.env.APPLICATION_REPOSITORY;
    const originalSession = process.env.INTERVIEW_SESSION_REPOSITORY;
    const directory = await mkdtemp(join(tmpdir(), "interview-web-"));
    try {
      delete process.env.INTERVIEW_SESSION_REPOSITORY;
      expect(await loadInterviewOverview("A")).toMatchObject({ ok: false, code: "CONFIGURATION_MISSING" });
      expect(await loadInterviewSession("A", "id")).toMatchObject({ ok: false, code: "CONFIGURATION_MISSING" });
      process.env.APPLICATION_REPOSITORY = join(directory, "applications.json");
      process.env.INTERVIEW_SESSION_REPOSITORY = join(directory, "sessions.json");
      expect(await loadInterviewOverview("A")).toMatchObject({ ok: false, code: "APPLICATION_NOT_FOUND" });
      expect(await readdir(directory)).toEqual([]);
    } finally {
      if (originalApplication === undefined) delete process.env.APPLICATION_REPOSITORY;
      else process.env.APPLICATION_REPOSITORY = originalApplication;
      if (originalSession === undefined) delete process.env.INTERVIEW_SESSION_REPOSITORY;
      else process.env.INTERVIEW_SESSION_REPOSITORY = originalSession;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
