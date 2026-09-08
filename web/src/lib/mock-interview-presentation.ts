import { applicationInterviewPath } from "./interview-presentation";
export function mockInterviewPath(applicationId: string, sessionId: string) {
  return `${applicationInterviewPath(applicationId)}/sessions/${encodeURIComponent(sessionId)}`;
}
export function mockInterviewResultsPath(applicationId: string, sessionId: string) {
  return `${mockInterviewPath(applicationId, sessionId)}/results`;
}
export function mockInterviewError(code: string): string {
  switch (code) {
    case "CONFIGURATION_MISSING": return "Mockintervjun är inte fullständigt konfigurerad.";
    case "INVALID_REQUEST": return "Välj en ansökan och en sparad förberedelse för att starta en mockintervju.";
    case "APPLICATION_NOT_FOUND": return "Ansökan hittades inte.";
    case "PREPARATION_NOT_FOUND": return "Förberedelsen hittades inte för den här ansökan.";
    case "INTERVIEW_SESSION_NOT_FOUND": return "Övningsintervjun hittades inte för den här ansökan.";
    case "UNLINKED_SESSION": return "Det exakta förberedelseunderlaget är inte tillgängligt för den här äldre eller ofullständigt skapade övningsintervjun. Välj en sparad förberedelse och starta en ny mockintervju.";
    case "INVALID_INTERVIEW_DATA": return "Övningsintervjuns underlag kunde inte verifieras.";
    case "SESSION_CREATION_FAILED": return "Mockintervjun kunde inte startas med en verifierad koppling till förberedelsen. En ofullständig övningsintervju kan ha sparats. Försök igen från den sparade förberedelsen.";
    case "SESSION_ALREADY_COMPLETED": return "Övningsintervjun är redan klar och tar inte emot fler svar.";
    case "STALE_QUESTION": return "Frågan har ändrats i en annan flik. Läs in övningsintervjun igen innan du svarar.";
    case "INVALID_ANSWER": return "Skriv ett svar i ett format som kan behandlas.";
    case "ANSWER_SUBMISSION_FAILED": return "Svaret kunde inte sparas. Ingen progression bekräftades.";
    case "SKIP_FAILED": return "Frågan kunde inte hoppas över. Ingen progression bekräftades.";
    case "SESSION_INCOMPLETE": return "Slutför övningsintervjun innan träningsfeedbacken visas.";
    case "FEEDBACK_FAILED": return "Träningsfeedbacken kunde inte tas fram från övningsintervjun.";
    default: return "Övningsintervjun kunde inte läsas eller sparas. Försök igen senare.";
  }
}
