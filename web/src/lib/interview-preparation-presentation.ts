import { applicationInterviewPath } from "./interview-presentation";

export function preparationPath(applicationId: string, preparationId?: string): string {
  const base = applicationInterviewPath(applicationId);
  return preparationId === undefined ? `${base}/prepare` : `${base}/preparations/${encodeURIComponent(preparationId)}`;
}
export function preparationError(code: string): string {
  switch (code) {
    case "CONFIGURATION_MISSING": return "Intervjuförberedelsen är inte fullständigt konfigurerad.";
    case "INVALID_REQUEST": return "Kontrollera ansökan, intervjutyp och språk och försök igen.";
    case "APPLICATION_NOT_FOUND": return "Ansökan hittades inte.";
    case "ASSOCIATION_NOT_FOUND": return "Koppla ansökan till en kandidat innan du förbereder intervjun.";
    case "CANDIDATE_PROFILE_NOT_FOUND": return "Den kopplade kandidatens verifierade profil saknas.";
    case "PREPARATION_NOT_FOUND": return "Förberedelsen hittades inte för den här ansökan.";
    case "INVALID_PREPARATION_DATA": return "Intervjuunderlaget är ogiltigt och kunde inte användas.";
    case "PREPARATION_CREATION_FAILED": return "Förberedelsen kunde inte skapas från det tillgängliga underlaget.";
    default: return "Intervjuunderlaget kunde inte läsas eller sparas. Försök igen senare.";
  }
}
export function requirementStatus(value: string): string {
  switch (value) {
    case "matched": return "Matchat i ansökans underlag";
    case "missing": return "Saknas i ansökans underlag";
    case "conflicting": return "Motstridigt underlag";
    default: return "Behöver förtydligas";
  }
}
export function preparationWarning(code: string): string {
  switch (code) {
    case "SPARSE_CANDIDATE_EVIDENCE": return "Profilen innehåller få verifierade exempel. Utgå bara från det du faktiskt har gjort.";
    case "LOW_JOB_EVIDENCE_CONFIDENCE": return "Jobbunderlaget är osäkert. Be gärna arbetsgivaren förtydliga rollen.";
    case "PARTIAL_REQUIREMENT_COVERAGE": return "Profilen täcker bara delar av jobbkraven. Var tydlig med vad du kan och vad du behöver lära dig.";
    case "MISSING_REQUIREMENT_PREPARATION": return "Det saknas stöd för ett jobbkrav. Beskriv ärligt din nuvarande kunskap.";
    case "CONFLICTING_REQUIREMENT_PREPARATION": return "Underlaget är motstridigt för ett jobbkrav. Förtydliga vad som faktiskt stämmer.";
    case "UNKNOWN_REQUIREMENT_CONTEXT": return "Det är oklart hur din profil motsvarar ett jobbkrav.";
    case "UNSUPPORTED_MATCHED_REQUIREMENT": return "Ett matchat krav saknar ett verifierat exempel att använda i svaret.";
    case "MISSING_MOTIVATION": return "Formulera själv en ärlig anledning till att du söker rollen.";
    case "NO_SUPPORTED_STAR_RESULT": return "Inget verifierat resultat finns för exemplet. Hitta inte på siffror eller resultat.";
    default: return "Underlaget behöver förtydligas. Använd bara uppgifter som stämmer.";
  }
}
export const answerGuidance = [
  "Svara direkt på frågan och använd ett konkret, verkligt exempel.",
  "Förklara din egen roll och vad du faktiskt gjorde.",
  "Beskriv resultatet utan att hitta på siffror eller effekter.",
  "Koppla svaret till ett relevant jobbkrav där det stämmer.",
];
