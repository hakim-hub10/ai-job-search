import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { InterviewOverviewView } from "../app/applications/[applicationId]/interview/overview";
import type { InterviewOverview, InterviewReadErrorCode, InterviewSessionReadModel } from "./interview-data";
import { applicationInterviewPath, formatInterviewLanguage, formatInterviewStatus, formatInterviewType, summarizeInterviewSessions } from "./interview-presentation";

const session = (id: string, overrides: Partial<InterviewSessionReadModel> = {}): InterviewSessionReadModel => ({
  sessionId: id, applicationId: "A", status: "inProgress", language: "sv", interviewType: "behavioral",
  currentQuestionIndex: 2, totalQuestions: 4, answeredQuestions: 1, skippedQuestions: 1, remainingQuestions: 2, ...overrides,
});
function render(sessions: InterviewSessionReadModel[], overrides: Partial<InterviewOverview> = {}) {
  return renderToStaticMarkup(<InterviewOverviewView applicationId="A" result={{ ok: true, value: {
    applicationId: "A", jobTitle: "Supporttekniker", company: "Testbolaget", sessions, ...overrides,
  } }} />);
}

describe("interview overview presentation", () => {
  it("renders truthful zero counts and an informative empty state without fake actions", () => {
    const html = render([]);
    expect(summarizeInterviewSessions([])).toEqual({ sessions: 0, answered: 0, remaining: 0 });
    expect(html).toContain("Ingen övningsintervju ännu");
    expect(html).toContain("Du har inte startat någon övningsintervju");
    expect(html).toContain("Intervjuförberedelse är inte tillgänglig ännu");
    expect(html).not.toMatch(/<button|<form|\/interview\//);
  });
  it("renders job context and one session with Swedish labels and all progress counts", () => {
    const html = render([session("one")]);
    for (const text of ["Supporttekniker", "Testbolaget", "Beteendeinriktad intervju", "Svenska", "Pågående", "Frågor totalt", "Besvarade", "Överhoppade", "Återstår"]) expect(html).toContain(text);
    expect(html).toContain("<dt>Frågor totalt</dt><dd>4</dd>");
    expect(html).toContain("<dt>Överhoppade</dt><dd>1</dd>");
    expect(html).toContain("<dt>Återstår</dt><dd>2</dd>");
    expect(summarizeInterviewSessions([session("one")])).toEqual({ sessions: 1, answered: 1, remaining: 2 });
  });
  it("preserves repository order and sums multiple sessions without readiness claims", () => {
    const sessions = [session("z", { interviewType: "situational" }), session("a", { interviewType: "roleSpecific", status: "completed", remainingQuestions: 0, answeredQuestions: 3 })];
    const before = structuredClone(sessions);
    const html = render(sessions);
    expect(html.indexOf("Situationsbaserad intervju")).toBeLessThan(html.indexOf("Rollspecifik intervju"));
    expect(html).toContain("Slutförd");
    expect(summarizeInterviewSessions(sessions)).toEqual({ sessions: 2, answered: 4, remaining: 2 });
    expect(sessions).toEqual(before);
    expect(html).not.toMatch(/Senaste|Nyaste|latest|recent|%|poäng|sannolikhet|Intervjudatum|Lön|Kontaktperson/i);
  });
  it.each(["recruiterScreening", "hiringManager", "behavioral", "roleSpecific", "situational"])("formats real interview type %s", (value) => {
    expect(formatInterviewType(value)).not.toBe(value);
    expect(formatInterviewType(value)).not.toBe("Övningsintervju");
  });
  it("formats statuses and supported languages with neutral future-value fallbacks", () => {
    expect(formatInterviewStatus("inProgress")).toBe("Pågående");
    expect(formatInterviewStatus("completed")).toBe("Slutförd");
    expect(formatInterviewLanguage("sv")).toBe("Svenska");
    expect(formatInterviewLanguage("en")).toBe("Engelska");
    expect(formatInterviewStatus("SECRET")).toBe("Okänd status");
    expect(formatInterviewType("SECRET")).toBe("Övningsintervju");
    expect(formatInterviewLanguage("SECRET")).toBe("Språk ej angivet");
  });
  it.each(["APPLICATION_NOT_FOUND", "CONFIGURATION_MISSING", "REPOSITORY_ERROR", "INVALID_INTERVIEW_DATA"] as InterviewReadErrorCode[])("renders a safe Swedish error for %s", (code) => {
    const html = renderToStaticMarkup(<InterviewOverviewView applicationId="A" result={{ ok: false, code, message: "/private/SECRET JSON stack trace" }} />);
    expect(html).toContain("Intervjuöversikten kunde inte visas");
    expect(html).not.toMatch(/SECRET|JSON|stack|REPOSITORY/);
    expect(html).toContain(code === "APPLICATION_NOT_FOUND" ? 'href="/applications"' : 'href="/applications/A"');
  });
  it("encodes application navigation IDs without changing their identity", () => {
    const id = "ansökan %2F /?#";
    const path = applicationInterviewPath(id);
    expect(path).toBe(`/applications/${encodeURIComponent(id)}/interview`);
    expect(decodeURIComponent(path.split("/")[2])).toBe(id);
  });
  it("escapes external job labels and omits absent company metadata", () => {
    const html = render([], { jobTitle: '<script>alert("x")</script>', company: null });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("Testbolaget");
    expect(html).not.toContain("Företag saknas");
  });
  it("uses Swedish language, headings, definitions and real navigation links", () => {
    const html = render([session("one")]);
    expect(html).toContain('lang="sv"');
    expect(html).toContain("<h1>Intervju</h1>");
    expect(html).toContain('aria-labelledby="sessions-heading"');
    expect(html).toContain("<dl");
    expect(html).toContain('href="/applications/A"');
    expect(html).not.toMatch(/tabindex|onclick|<button/i);
  });
});
