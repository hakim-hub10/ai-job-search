import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PreparationCreateView, PreparationDetailView } from "../app/applications/[applicationId]/interview/preparation-views";
import type { PreparationDetail, PreparationErrorCode, PreparationList } from "./interview-preparation-data";
import { preparationError, preparationPath, preparationWarning, requirementStatus } from "./interview-preparation-presentation";
const p: PreparationDetail = {
  preparationId: "stored", applicationId: "A", jobTitle: "Supporttekniker", company: "Testbolaget", language: "sv", interviewType: "hiringManager", questionCount: 2,
  questions: [{ id: "q", prompt: "Berätta om ett supportärende.", rationale: "Förstå hur du löser problem.",
    requirements: [{ key: "skill:support", label: "Support", status: "matched", source: "job" }],
    evidence: [{ id: "experience", content: "Hjälpte kollegor med supportärenden.", employer: "Exempelbolaget", role: "Tekniker" }],
    starPrompts: [{ situationPrompt: "Beskriv sammanhanget.", taskPrompt: "Vad ansvarade du för?", actionPrompt: "Vad gjorde du?", resultPrompt: "Vad blev resultatet?", warnings: ["Hitta inte på mått."] }],
  }, { id: "missing", prompt: "Vad vill du lära dig?", rationale: "Förstå dina utvecklingsmål.", requirements: [], evidence: [], starPrompts: [] }],
  warnings: [{ code: "MISSING_REQUIREMENT_PREPARATION", requirementLabel: "Linux" }],
};
const list: PreparationList = { applicationId: "A", jobTitle: p.jobTitle, company: p.company, preparations: [] };
const action = async () => {};
const detail = (model = p) => renderToStaticMarkup(<PreparationDetailView applicationId="A" result={{ ok: true, value: model }} />);
const form = (model = list, error?: string) => renderToStaticMarkup(<PreparationCreateView applicationId="A" result={{ ok: true, value: model }} action={action} error={error} />);
describe("interview preparation presentation and rendering", () => {
  it("renders an explicit creation form with exactly supported choices and Swedish labels", () => {
    const html = form();
    for (const text of ["Förbered intervju", "Supporttekniker", "Testbolaget", "Intervjutyp", "Frågornas språk", "Svenska", "Engelska", "Skapa och spara förberedelse", "Ingen sparad förberedelse"]) expect(html).toContain(text);
    expect(html.match(/<option /g)).toHaveLength(7);
    for (const type of ["recruiterScreening", "hiringManager", "behavioral", "roleSpecific", "situational"]) expect(html).toContain(`value="${type}"`);
    expect(html).toContain('name="applicationId"'); expect(html).not.toMatch(/name="(?:candidateId|evidence|plan|jobTitle)"/);
  });
  it("shows each saved preparation via its exact application-scoped URL", () => {
    const html = form({ ...list, preparations: [p, { ...p, preparationId: "another", language: "en", interviewType: "behavioral" }] });
    expect(html).toContain(preparationPath("A", "stored")); expect(html).toContain(preparationPath("A", "another"));
    expect(html).toContain("Sparade förberedelser (2)"); expect(html).toContain("Engelska"); expect(html).not.toMatch(/Senaste|Nyaste/);
  });
  it("renders persisted question, rationale and tentative employer intent", () => {
    const html = detail();
    for (const text of [p.jobTitle, p.company!, p.questions[0].prompt, p.questions[0].rationale, "Vad arbetsgivaren sannolikt vill bedöma", "Samtal med rekryterande chef"]) expect(html).toContain(text);
    expect(html).not.toContain("Arbetsgivaren kommer att bedöma");
  });
  it("renders resolved requirements and verified evidence with context", () => {
    const html = detail();
    for (const text of ["Relevant krav eller koppling", "Matchat i ansökans underlag", "Erfarenhet du kan använda i svaret", "Hjälpte kollegor med supportärenden.", "Exempelbolaget", "Tekniker"]) expect(html).toContain(text);
    expect(html).not.toContain("skill:support");
  });
  it("does not describe candidate-only relationships as job requirements", () => {
    const model = structuredClone(p); model.questions[0].requirements[0].source = "candidate";
    expect(detail(model)).toContain("Koppling i din profil, inte ett angivet jobbkrav");
  });
  it("shows truthful missing-evidence guidance without an invented answer", () => {
    const html = detail();
    expect(html).toContain("Din verifierade profil innehåller inget tydligt exempel för den här frågan.");
    expect(html).toContain("Använd ett verkligt exempel om du har ett."); expect(html).toContain("endast där det faktiskt stämmer");
  });
  it("renders stored STAR prompts, warning and deterministic coaching", () => {
    const html = detail();
    for (const text of ["Situation", "Uppgift", "Handling", "Resultat", "Beskriv sammanhanget.", "Vad ansvarade du för?", "Vad gjorde du?", "Vad blev resultatet?", "Hitta inte på mått.", "intervjucoachning", "Förklara din egen roll"]) expect(html).toContain(text);
  });
  it("explains STAR generally without inventing question-specific stored prompts", () => {
    const model = structuredClone(p); model.questions.forEach((q) => { q.starPrompts = []; });
    const html = detail(model);
    expect(html).toContain("STAR som stöd för verkliga exempel");
    expect(html).not.toContain("Strukturera exemplet med STAR");
    expect(html).toContain("Säg till om ett mätbart resultat saknas.");
  });
  it("renders safe warnings with resolved requirement labels", () => {
    const html = detail(); expect(html).toContain("Det saknas stöd för ett jobbkrav."); expect(html).toContain("Linux"); expect(html).not.toContain("MISSING_REQUIREMENT");
  });
  it.each(["PREPARATION_NOT_FOUND", "APPLICATION_NOT_FOUND", "CONFIGURATION_MISSING", "CANDIDATE_PROFILE_NOT_FOUND", "REPOSITORY_ERROR"] as PreparationErrorCode[])("renders safe error for %s in both views", (code) => {
    const result = { ok: false as const, code, message: "SECRET /private/path stack JSON" };
    for (const html of [renderToStaticMarkup(<PreparationDetailView applicationId="A" result={result} />), renderToStaticMarkup(<PreparationCreateView applicationId="A" result={result} action={action} />)]) {
      expect(html).toContain(preparationError(code)); expect(html).not.toContain("SECRET"); expect(html).toContain('role="alert"');
      if (code === "APPLICATION_NOT_FOUND") expect(html).toContain('href="/applications"');
    }
  });
  it("sanitizes action error query strings and preserves an accessible form", () => {
    const html = form(list, "<SECRET>"); expect(html).not.toContain("SECRET"); expect(html).toContain('role="alert"'); expect(html).toContain('for="interview-type"'); expect(html).toContain('for="interview-language"');
  });
  it("uses neutral Swedish fallbacks for unknown values", () => {
    for (const text of [preparationError("SECRET"), preparationWarning("SECRET"), requirementStatus("SECRET")]) expect(text).not.toContain("SECRET");
    expect(requirementStatus("missing")).toContain("Saknas"); expect(requirementStatus("conflicting")).toContain("Motstridigt");
  });
  it("escapes persisted text and renders semantic headings without future controls", () => {
    const model = structuredClone(p); model.questions[0].rationale = '<img src=x onerror="alert(1)">';
    for (const html of [detail(model), form()]) {
      expect(html).toContain('lang="sv"'); expect(html).toContain("<h1>"); expect(html).not.toMatch(/Starta mock|API.nyckel|OpenAI|textarea|contenteditable/);
    }
    expect(detail(model)).toContain("&lt;img"); expect(detail(model)).not.toContain("<img"); expect(detail()).toContain("<article"); expect(detail()).toContain("<dl");
  });
  it("encodes route IDs once and never serializes preparation state in URLs", () => {
    const id = "ansökan %2F /?#"; expect(preparationPath(id, id)).toBe(`/applications/${encodeURIComponent(id)}/interview/preparations/${encodeURIComponent(id)}`);
  });
});
