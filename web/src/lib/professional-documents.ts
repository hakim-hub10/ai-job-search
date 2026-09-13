import type { ApplicationDocumentGenerator, DocumentGenerationRequest, GenerationEvidence, GeneratedDocumentClaim, GeneratedDocumentSection } from "../../../.agents/job-search/cli/src/document-generation";
import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import type { DocumentLanguage } from "../../../.agents/job-search/cli/src/application-documents";
import { looksLikeRawImportBlock, reviewProfileQuality, summaryReviewItem, type SkillReviewItem } from "./profile-quality";
import { skillConcept } from "./skill-presentation";

/** Projection only: stored approved values are never mutated. */
export function documentQualityProfile(profile: CandidateProfile): CandidateProfile {
  const next = structuredClone(profile);
  const review = reviewProfileQuality(profile);
  for (const field of ["technical", "soft"] as const) next.skills[field] = review.filter(x => x.field === field && !x.suspicious).map(x => x.value);
  // A summary that reads like a pasted CV (dates, contact details,
  // certifications restated as prose) must not be dumped verbatim into a
  // generated document - dropping it here lets composeProfessionalSummary
  // fall back to a short summary composed from the other approved evidence.
  // The candidate's own stored profile.summary is untouched.
  if (next.summary && looksLikeRawImportBlock(next.summary)) next.summary = undefined;
  return next;
}
/**
 * What documentQualityProfile excluded from a profile and why. Approved
 * skills that look like pollution (sentence fragments, dates, employers,
 * roles...) are kept out of "Kompetenser", and a summary that reads like
 * pasted CV text is kept out of "Profil", so the CV stays factual - but that
 * decision must stay inspectable rather than silently disappearing - callers
 * can surface this list to the candidate instead of just losing the data.
 */
export function documentQualityExclusions(profile: CandidateProfile): SkillReviewItem[] {
  const summaryExclusion = summaryReviewItem(profile);
  return [...reviewProfileQuality(profile).filter(item => item.suspicious), ...(summaryExclusion ? [summaryExclusion] : [])];
}
export function resolveDocumentLanguage(explicit: DocumentLanguage | undefined, description?: string | null): DocumentLanguage {
  if (explicit) return explicit;
  const text = description ?? "";
  const sv = (text.match(/\b(?:och|du|vi|erfarenhet|söker|kunskaper|arbete|krav)\b/giu) ?? []).length;
  const en = (text.match(/\b(?:and|you|we|experience|required|skills|role|the)\b/giu) ?? []).length;
  return en > sv ? "en" : "sv";
}
function relevance(item: GenerationEvidence, request: DocumentGenerationRequest): number {
  const direct = request.matchedRequirementSupport.some(x => x.evidenceIds.includes(item.id)) ? 100 : 0;
  const words = new Set(`${request.applicationContext.jobTitle} ${request.untrustedJobContext.description ?? ""}`.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);
  return direct + [...new Set(item.content.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])].filter(x => words.has(x)).length;
}
export function selectProfessionalEvidence(request: DocumentGenerationRequest): GenerationEvidence[] {
  const limits: Partial<Record<GenerationEvidence["kind"], number>> = { skill: 12, experience: 3, education: 2, certification: 4, language: 4, summary: 2, identity: 4, project: 2, achievement: 2, motivation: 1, other: 1 };
  const counts = new Map<string, number>(); const concepts = new Set<string>();
  return [...request.selectedEvidence].sort((a, b) => relevance(b, request) - relevance(a, request)).filter(item => {
    const key = skillConcept(item.content).toLocaleLowerCase();
    if (item.kind === "skill" && concepts.has(key)) return false;
    const group = item.kind === "skill" ? item.id.includes("soft-skill") ? "softSkills" : "technicalSkills" : item.kind;
    const groupLimit = group === "softSkills" ? 3 : group === "technicalSkills" ? 9 : limits[item.kind] ?? 1;
    const count = counts.get(group) ?? 0;
    if (count >= groupLimit) return false;
    counts.set(group, count + 1); if (item.kind === "skill") concepts.add(key); return true;
  });
}
function fact(item: GenerationEvidence, text = item.content, extraEvidenceIds: readonly string[] = []): GeneratedDocumentClaim {
  return { id: `professional:${item.id}`, kind: "candidateFact", provenance: text === item.content ? "verbatim" : "paraphrased", text, evidenceIds: [item.id, ...extraEvidenceIds] };
}
/** Existing user summary takes precedence. Otherwise compose at most four short factual lines. */
export function composeProfessionalSummary(evidence: GenerationEvidence[], language: DocumentLanguage): GeneratedDocumentClaim[] {
  const authored = evidence.find(x => x.id === "profile:summary");
  if (authored) return [fact(authored)];
  const sv = language === "sv";
  const lines: GeneratedDocumentClaim[] = [];
  const role = evidence.find(x => x.kind === "experience");
  const skills = evidence.filter(x => x.kind === "skill").slice(0, 3);
  const education = evidence.find(x => x.kind === "education");
  const languages = evidence.filter(x => x.kind === "language").slice(0, 2);
  const add = (id: string, text: string, items: GenerationEvidence[]) => lines.push({ id, text, kind: "candidateFact", provenance: "paraphrased", evidenceIds: items.map(x => x.id) });
  if (role) add("professional:summary:experience", `${sv ? "Erfarenhet" : "Experience"}: ${[role.context?.role, role.context?.employer].filter(Boolean).join(", ") || role.content}.`, [role]);
  if (skills.length) add("professional:summary:skills", `${sv ? "Kompetenser" : "Skills"}: ${skills.map(x => skillConcept(x.content)).join(", ")}.`, skills);
  if (education) add("professional:summary:education", `${sv ? "Utbildning" : "Education"}: ${education.content}.`, [education]);
  if (languages.length) add("professional:summary:languages", `${sv ? "Språk" : "Languages"}: ${languages.map(x => x.content).join(", ")}.`, languages);
  return lines;
}
/**
 * Deterministic seed derived from stable, job-tied facts (never randomness):
 * the same application always renders the same letter, but different jobs
 * or candidates naturally land on different phrasing.
 */
function variantSeed(...parts: string[]): number {
  let hash = 0;
  for (const char of parts.join("|")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}
function pickVariant<T>(seed: number, variants: readonly T[]): T {
  return variants[seed % variants.length];
}
function composeLetter(request: DocumentGenerationRequest, selected: GenerationEvidence[]): GeneratedDocumentSection[] {
  const sv = request.language === "sv"; let sequence = 0;
  const claims: GeneratedDocumentClaim[] = [];
  const neutral = (text: string) => claims.push({ id: `professional:letter:${sequence++}`, kind: "neutralContext", provenance: "neutral", text, evidenceIds: [] });
  const paragraph = (text: string, evidence: GenerationEvidence[]) => claims.push({ id: `professional:letter:${sequence++}`, kind: "candidateFact", provenance: "paraphrased", text, evidenceIds: evidence.map(x => x.id) });
  const context = `${request.applicationContext.jobTitle}${request.applicationContext.company ? `${sv ? " hos " : " at "}${request.applicationContext.company}` : ""}`;
  const seed = variantSeed(request.applicationId, request.applicationContext.jobTitle, request.applicationContext.company ?? "");
  neutral(sv ? "Hej," : "Dear Hiring Manager,");
  const openingVariants = sv
    ? [
        `Jag vill anmäla mitt intresse för rollen som ${context}. Jag vill gärna diskutera hur min bakgrund kan komma till nytta i den här tjänsten. För mig är det viktigt att förstå uppdragets prioriteringar och förväntningar, så att vi kan bedöma hur min erfarenhet passar arbetet ni behöver få gjort.`,
        `Jag söker härmed rollen som ${context} och vill gärna berätta mer om varför min bakgrund kan vara relevant. Jag är särskilt intresserad av att förstå vad rollen innebär i praktiken, så att vi tillsammans kan se hur min erfarenhet matchar det ni behöver få gjort.`,
      ]
    : [
        `I would like to express my interest in the ${context} role. I welcome the opportunity to discuss how my background could contribute to this position. Understanding the responsibilities and priorities of the role would help us assess how my experience fits the work you need to accomplish.`,
        `I am writing to apply for the ${context} position and would welcome the chance to share why my background may be a good fit. I am especially keen to understand what the role involves day to day, so we can assess together how my experience matches what you need done.`,
      ];
  neutral(pickVariant(seed, openingVariants));
  const experience = selected.filter(x => x.kind === "experience").slice(0, 2);
  if (experience.length) {
    const history = experience.map(item => {
      const context = item.context;
      if (!context?.role || !context?.employer) return item.content;
      const dates = [context.startDate, context.endDate].filter(Boolean).join("–");
      return `${sv ? "Jag har arbetat som" : "I have worked as"} ${context.role} ${sv ? "hos" : "at"} ${context.employer}${context.location ? ` ${sv ? "i" : "in"} ${context.location}` : ""}${dates ? ` (${dates})` : ""}.`;
    }).join(" ");
    const experienceClosings = sv
      ? [
          "Jag berättar gärna mer om dessa uppdrag och vilka delar som är mest relevanta för tjänsten vid ett samtal. Då kan vi också gå igenom konkreta exempel från mitt arbete och diskutera vilka erfarenheter som bäst motsvarar det ni söker.",
          "Vid ett samtal ser jag gärna att vi går igenom vilka delar av den här erfarenheten som är mest relevanta för er, samt konkreta exempel på hur jag har löst liknande uppgifter tidigare.",
        ]
      : [
          "I would welcome a conversation about these roles and the aspects of my work that are most relevant to this position. We could also discuss specific examples from my work and explore which parts of my experience best address your priorities.",
          "In a conversation, I would be glad to walk through which parts of this experience are most relevant to your needs, along with concrete examples of how I have handled similar responsibilities before.",
        ];
    paragraph(`${history} ${pickVariant(seed, experienceClosings)}`, experience);
  }
  const skills = selected.filter(x => x.kind === "skill").slice(0, 5);
  const education = selected.filter(x => x.kind === "education").slice(0, 1);
  const certifications = selected.filter(x => x.kind === "certification").slice(0, 2);
  const qualifications = [...skills, ...education, ...certifications];
  if (qualifications.length) {
    const qualificationClosings = sv
      ? [
          "Jag ser fram emot att diskutera hur denna bakgrund kan användas i era konkreta arbetsuppgifter och vad jag behöver sätta mig in i när jag börjar i rollen.",
          "Jag vill gärna gå igenom hur dessa kompetenser kan komma till nytta i era specifika arbetsuppgifter, och vad jag i så fall behöver lära mig när jag börjar.",
        ]
      : [
          "I would be glad to discuss how this background could be applied to your specific responsibilities and what I would need to learn when starting in the role.",
          "I would welcome the chance to go through how these qualifications could support your specific responsibilities, and what I would need to get up to speed on when starting.",
        ];
    paragraph([
      skills.length ? `${sv ? "Bland mina kompetenser finns" : "My skills include"} ${skills.map(x => skillConcept(x.content)).join(", ")}.` : "",
      education.length ? `${sv ? "Min utbildningsbakgrund omfattar" : "My education includes"} ${education.map(x => x.content).join("; ")}.` : "",
      certifications.length ? `${sv ? "Jag har även följande certifieringar" : "I also hold the following certifications"}: ${certifications.map(x => x.content).join(", ")}.` : "",
      pickVariant(seed, qualificationClosings),
    ].filter(Boolean).join(" "), qualifications);
  }
  const closingVariants = sv
    ? [
        "Jag vill gärna få möjlighet att bidra i rollen och lära känna hur ni arbetar. Ett samtal skulle ge oss möjlighet att gå igenom era behov, arbetsuppgifterna och förutsättningarna för ett gott samarbete. Jag svarar gärna på frågor om min bakgrund och utvecklar de delar som ni vill veta mer om. Tack för att ni tar er tid att läsa min ansökan. Jag ser fram emot möjligheten till fortsatt kontakt.",
        "Jag skulle uppskatta möjligheten att bidra i rollen och lära mig mer om hur ni arbetar. Vid ett samtal kan vi gå igenom era behov och vad som krävs för ett bra samarbete, och jag svarar gärna på frågor om min bakgrund. Tack för att ni tar er tid att läsa min ansökan - jag ser fram emot att höra från er.",
      ]
    : [
        "I would appreciate the opportunity to contribute in this role and learn more about how you work. A conversation would allow us to explore your needs, the responsibilities of the position and the basis for a productive working relationship. I would be happy to answer questions about my background and expand on any areas you would like to discuss. Thank you for taking the time to consider my application. I look forward to the opportunity to speak with you.",
        "I would welcome the opportunity to contribute in this role and to learn more about how your team works. A conversation would let us cover your needs and what a good working relationship would look like, and I am happy to answer any questions about my background. Thank you for considering my application - I look forward to hearing from you.",
      ];
  neutral(pickVariant(seed, closingVariants));
  neutral(sv ? "Med vänliga hälsningar" : "Kind regards,");
  const name = selected.find(x => x.id === "document:identity:full-name");
  const contactDetails = selected.filter(x => x.id === "document:identity:email" || x.id === "document:identity:phone");
  if (name) {
    const signature = contactDetails.length ? `${name.content}\n${contactDetails.map(x => x.content).join(" · ")}` : name.content;
    claims.push(fact(name, signature, contactDetails.map(x => x.id)));
  }
  return [{ id: "professional:letter", kind: "context", claims }];
}
export function createProfessionalDocumentGenerator(options: { composeSummary?: boolean } = {}): ApplicationDocumentGenerator {
  return {
  async generate(request) {
    const selected = selectProfessionalEvidence(request);
    let sections: GeneratedDocumentSection[];
    if (request.type === "coverLetter") sections = composeLetter(request, selected);
    else {
      const order: GenerationEvidence["kind"][] = ["identity", "summary", "experience", "education", "skill", "certification", "language", "project", "achievement", "other"];
      sections = order.flatMap((kind): GeneratedDocumentSection[] => {
        const items = selected.filter(x => x.kind === kind);
        const claims = kind === "summary" ? [...items.filter(x => x.id === "profile:headline").map(x => fact(x)), ...(options.composeSummary === false ? [] : composeProfessionalSummary(selected, request.language))] : items.map(x => fact(x, kind === "skill" ? skillConcept(x.content) : x.content));
        if (kind === "skill") return ["technicalSkills", "softSkills"].flatMap(group => {
          const grouped = items.filter(x => x.id.includes("soft-skill") === (group === "softSkills")).map(x => fact(x, skillConcept(x.content)));
          return grouped.length ? [{ id: `professional:${group}`, kind, claims: grouped }] : [];
        });
        return claims.length ? [{ id: `professional:${kind}`, kind, claims }] : [];
      });
    }
    return { ok: true, value: { applicationId: request.applicationId, type: request.type, language: request.language, sections } };
  },
  };
}

export const professionalDocumentGenerator = createProfessionalDocumentGenerator();
