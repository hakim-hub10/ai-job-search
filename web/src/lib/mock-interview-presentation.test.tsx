import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MockInterviewView } from "../app/applications/[applicationId]/interview/sessions/overview";
import { PreparationDetailView } from "../app/applications/[applicationId]/interview/preparation-views";
import type { MockInterviewReadModel, MockInterviewErrorCode } from "./mock-interview-data";
import { mockInterviewError, mockInterviewPath } from "./mock-interview-presentation";
import type { PreparationDetail } from "./interview-preparation-data";
const model: MockInterviewReadModel = {
  application: { applicationId: "A", jobTitle: "Supporttekniker", company: "Testbolaget" }, preparationId: "prep-A",
  session: { sessionId: "s", applicationId: "A", language: "sv", interviewType: "behavioral", status: "inProgress", currentQuestionIndex: 0, totalQuestions: 2, answeredQuestions: 0, skippedQuestions: 0, remainingQuestions: 2 },
  currentQuestion: { id: "q", prompt: "Berätta om ett verkligt exempel.", rationale: "Förstå ditt arbetssätt.", requirements: [{ key: "skill:support", label: "Support", source: "job", status: "matched" }],
    evidence: [{ id: "e", content: "Hjälpte kollegor med datorproblem.", role: "Tekniker", employer: "Exempelbolaget" }],
    starPrompts: [{ situationPrompt: "Beskriv situationen.", taskPrompt: "Beskriv ansvaret.", actionPrompt: "Beskriv handlingen.", resultPrompt: "Beskriv styrkta resultat.", warnings: ["Hitta inte på resultat."] }] },
};
const render = (m = model) => renderToStaticMarkup(<MockInterviewView applicationId="A" result={{ ok: true, value: m }} />);
describe("mock interview presentation", () => {
  it("renders Swedish practice framing, exact question, status, type, language and progress", () => {
    const html = render(); for (const text of ["Mockintervju", "Övningsintervju", "Supporttekniker", "Testbolaget", "Beteendeinriktad intervju", "Svenska", "Pågående", "Fråga 1 av 2", "Berätta om ett verkligt exempel.", "Vad arbetsgivaren sannolikt vill bedöma", "Förstå ditt arbetssätt."]) expect(html).toContain(text);
  });
  it("renders linked requirement, evidence and STAR without exposing reference keys", () => {
    const html = render(); for (const text of ["Support", "Matchat i ansökans underlag", "Erfarenhet du kan använda i svaret", "Hjälpte kollegor med datorproblem.", "Exempelbolaget", "Situation", "Uppgift", "Handling", "Resultat", "Beskriv situationen.", "Hitta inte på resultat."]) expect(html).toContain(text);
    expect(html).not.toContain("skill:support"); expect(html).toContain('href="/applications/A/interview/preparations/prep-A"');
  });
  it("renders truthful missing evidence without adding STAR prompts", () => {
    const m = structuredClone(model); m.currentQuestion!.evidence = []; m.currentQuestion!.starPrompts = [];
    expect(render(m)).toContain("Din verifierade profil innehåller inget tydligt exempel"); expect(render(m)).not.toContain("Strukturera exemplet med STAR");
  });
  it("has no answer input, skip, feedback, scoring or provider controls", () => {
    const html = render(); expect(html).not.toMatch(/<textarea|<input|<button|<form|feedback|OpenAI|API_KEY|poäng|godkänd|anställningsbarhet|Hoppa över/i); expect(html).toContain("Svar och nästa fråga kommer i nästa steg.");
  });
  it("handles completed sessions with a null question", () => {
    const m = structuredClone(model); m.session.status = "completed"; m.session.currentQuestionIndex = 2; m.session.remainingQuestions = 0; m.currentQuestion = null;
    const html = render(m); expect(html).toContain("Slutförd"); expect(html).toContain("Övningsintervjun är slutförd"); expect(html).not.toContain("Fråga 3"); expect(html).not.toContain("Berätta om");
  });
  it.each(["UNLINKED_SESSION", "INTERVIEW_SESSION_NOT_FOUND", "APPLICATION_NOT_FOUND", "INVALID_INTERVIEW_DATA", "CONFIGURATION_MISSING", "REPOSITORY_ERROR"] as MockInterviewErrorCode[])("renders fixed safe error for %s without question context", (code) => {
    const html = renderToStaticMarkup(<MockInterviewView applicationId="A" result={{ ok: false, code, message: "SECRET /private/path JSON" }} />);
    expect(html).toContain(mockInterviewError(code)); expect(html).toContain('role="alert"'); expect(html).not.toMatch(/SECRET|Historisk|Berätta om/);
    if (code === "APPLICATION_NOT_FOUND") expect(html).toContain('href="/applications"');
  });
  it("adds an explicit start form to the saved preparation detail with only selection IDs", () => {
    const p: PreparationDetail = { ...model.application, preparationId: "prep-A", language: "sv", interviewType: "behavioral", questionCount: 1, questions: [model.currentQuestion!], warnings: [] };
    const html = renderToStaticMarkup(<PreparationDetailView applicationId="A" result={{ ok: true, value: p }} startAction={async () => {}} startError="SECRET" />);
    expect(html).toContain("Starta mockintervju"); expect(html).toContain('name="applicationId" value="A"'); expect(html).toContain('name="preparationId" value="prep-A"');
    expect(html.match(/<input /g)).toHaveLength(2); expect(html).not.toContain("SECRET"); expect(html).toContain("Varje start skapar en separat övningsintervju.");
  });
  it("escapes stored content and uses semantic Swedish headings", () => {
    const m = structuredClone(model); m.currentQuestion!.prompt = "<script>SECRET</script>";
    const html = render(m); expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>"); expect(html).toContain('lang="sv"'); expect(html).toContain('<h1>Mockintervju</h1>'); expect(html).toContain('<article');
  });
  it("encodes opaque route IDs and sanitizes unknown error codes", () => {
    const id = "A %2F /?#"; expect(mockInterviewPath(id, id)).toBe(`/applications/${encodeURIComponent(id)}/interview/sessions/${encodeURIComponent(id)}`); expect(mockInterviewError("SECRET")).not.toContain("SECRET");
  });
});
