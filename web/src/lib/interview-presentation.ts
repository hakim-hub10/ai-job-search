import type { InterviewReadErrorCode, InterviewSessionReadModel } from "./interview-data";

export function applicationInterviewPath(applicationId: string): string {
  return `/applications/${encodeURIComponent(applicationId)}/interview`;
}

export function formatInterviewStatus(value: string): string {
  switch (value) {
    case "inProgress": return "Pågående";
    case "completed": return "Slutförd";
    default: return "Okänd status";
  }
}

export function formatInterviewType(value: string): string {
  switch (value) {
    case "recruiterScreening": return "Inledande rekryterarsamtal";
    case "hiringManager": return "Samtal med rekryterande chef";
    case "behavioral": return "Beteendeinriktad intervju";
    case "roleSpecific": return "Rollspecifik intervju";
    case "situational": return "Situationsbaserad intervju";
    default: return "Övningsintervju";
  }
}

export function formatInterviewLanguage(value: string): string {
  switch (value) {
    case "sv": return "Svenska";
    case "en": return "Engelska";
    default: return "Språk ej angivet";
  }
}

/** Totals across the returned collection, not an assessment of readiness. */
export function summarizeInterviewSessions(sessions: InterviewSessionReadModel[]) {
  return {
    sessions: sessions.length,
    answered: sessions.reduce((total, session) => total + session.answeredQuestions, 0),
    remaining: sessions.reduce((total, session) => total + session.remainingQuestions, 0),
  };
}

export function interviewOverviewError(code: InterviewReadErrorCode): string {
  switch (code) {
    case "APPLICATION_NOT_FOUND": return "Ansökan hittades inte. Gå tillbaka till dina ansökningar och välj en ansökan.";
    case "CONFIGURATION_MISSING": return "Intervjuöversikten är inte tillgänglig ännu. Du kan gå tillbaka och arbeta vidare med din ansökan.";
    case "INVALID_INTERVIEW_DATA": return "Intervjuuppgifterna kunde inte visas. Gå tillbaka till ansökan och försök igen senare.";
    default: return "Intervjuöversikten kunde inte laddas. Försök igen senare eller gå tillbaka till ansökan.";
  }
}
