import { applicationInterviewPath } from "./interview-presentation";
export function mockInterviewPath(applicationId: string, sessionId: string) {
  return `${applicationInterviewPath(applicationId)}/sessions/${encodeURIComponent(sessionId)}`;
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
    default: return "Övningsintervjun kunde inte läsas eller sparas. Försök igen senare.";
  }
}
