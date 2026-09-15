import type { ApplicationDocumentGenerator, DocumentGenerationRequest, GenerationEvidence, GeneratedDocumentClaim, GeneratedDocumentSection } from "../../../.agents/job-search/cli/src/document-generation";
import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import type { DocumentLanguage } from "../../../.agents/job-search/cli/src/application-documents";
import { normalizedConceptText } from "../../../.agents/job-search/cli/src/concept-normalization";
import { looksLikeRawImportBlock, reviewProfileQuality, summaryReviewItem, deepRepairMojibake, type SkillReviewItem } from "./profile-quality";
import { dedupeNormalized, skillConcept } from "./skill-presentation";

/**
 * Projection only: stored approved values are never mutated. Applies the
 * exact same reviewProfileQuality classification to every field it covers
 * (technical/soft skills, certifications, summary) - certifications were
 * previously exempt from this filtering even though reviewProfileQuality
 * already classified suspicious entries there, which let a misclassified
 * value (e.g. a school name with a trailing date range that reads as
 * education-like/DATE-suspicious, not a certification) reach a generated
 * document unfiltered. Reused identically by both the AI and deterministic
 * generation paths, since both call this function to build their shared
 * "matchingProfile" input.
 */
export function documentQualityProfile(profile: CandidateProfile): CandidateProfile {
  const next = deepRepairMojibake(structuredClone(profile));
  const review = reviewProfileQuality(next);
  // Conservative, normalization-only deduplication (see dedupeNormalized) -
  // never merges two genuinely different skill phrases, only exact and safe
  // case/whitespace-equivalent repeats. Applied after classification so a
  // suspicious entry can never "win" a dedup slot over a legitimate one.
  for (const field of ["technical", "soft"] as const) {
    next.skills[field] = dedupeNormalized(review.filter(x => x.field === field && !x.suspicious).map(x => x.value));
  }
  next.certifications = review.filter(x => x.field === "certifications" && !x.suspicious).map(x => x.value);
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
  const repaired = deepRepairMojibake(profile);
  const summaryExclusion = summaryReviewItem(repaired);
  return [...reviewProfileQuality(repaired).filter(item => item.suspicious), ...(summaryExclusion ? [summaryExclusion] : [])];
}
export function resolveDocumentLanguage(explicit: DocumentLanguage | undefined, description?: string | null): DocumentLanguage {
  if (explicit) return explicit;
  const text = description ?? "";
  const sv = (text.match(/\b(?:och|du|vi|erfarenhet|söker|kunskaper|arbete|krav)\b/giu) ?? []).length;
  const en = (text.match(/\b(?:and|you|we|experience|required|skills|role|the)\b/giu) ?? []).length;
  return en > sv ? "en" : "sv";
}
/** Significant (4+ letter) words from the job title/description, used to score evidence relevance without altering matching's own scoring. */
function jobKeywords(request: DocumentGenerationRequest): Set<string> {
  return new Set(`${request.applicationContext.jobTitle} ${request.untrustedJobContext.description ?? ""}`.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);
}
function keywordOverlap(text: string, jobWords: Set<string>): number {
  return [...new Set(text.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])].filter(x => jobWords.has(x)).length;
}
function relevance(item: GenerationEvidence, request: DocumentGenerationRequest): number {
  const direct = request.matchedRequirementSupport.some(x => x.evidenceIds.includes(item.id)) ? 100 : 0;
  return direct + keywordOverlap(item.content, jobKeywords(request));
}
export function selectProfessionalEvidence(request: DocumentGenerationRequest): GenerationEvidence[] {
  const limits: Partial<Record<GenerationEvidence["kind"], number>> = { skill: 12, experience: 3, education: 2, certification: 4, language: 4, summary: 2, identity: 4, project: 2, achievement: 2, motivation: 1, other: 1 };
  const counts = new Map<string, number>(); const concepts = new Set<string>();
  return [...request.selectedEvidence].sort((a, b) => relevance(b, request) - relevance(a, request)).filter(item => {
    const key = normalizedConceptText(skillConcept(item.content));
    if (item.kind === "skill" && concepts.has(key)) return false;
    const group = item.kind === "skill" ? item.id.includes("soft-skill") ? "softSkills" : "technicalSkills" : item.kind;
    const groupLimit = group === "softSkills" ? 3 : group === "technicalSkills" ? 9 : limits[item.kind] ?? 1;
    const count = counts.get(group) ?? 0;
    if (count >= groupLimit) return false;
    counts.set(group, count + 1); if (item.kind === "skill") concepts.add(key); return true;
  });
}
/**
 * Wraps any ApplicationDocumentGenerator so it only ever sees the same
 * job-relevance-prioritized evidence subset the deterministic generator
 * already writes from (selectProfessionalEvidence - reused, not duplicated,
 * so this stays domain-agnostic with no IT-specific rules). This narrows what
 * the wrapped generator is shown; validateGeneratedDocumentProposal still
 * validates the returned proposal against the full original request it
 * receives independently, so the trust boundary and approved-evidence set
 * are unaffected - this only changes which verified evidence a writer is
 * steered toward emphasizing for this specific job, never what is allowed.
 */
export function createJobAwareDocumentGenerator(generator: ApplicationDocumentGenerator): ApplicationDocumentGenerator {
  return {
    async generate(request) {
      const selectedEvidence = selectProfessionalEvidence(request);
      const prioritizedIds = new Set(selectedEvidence.map((item) => item.id));
      const matchedRequirementSupport = request.matchedRequirementSupport.map((support) => ({
        ...support,
        evidenceIds: support.evidenceIds.filter((id) => prioritizedIds.has(id)),
      }));
      return generator.generate({ ...request, selectedEvidence, matchedRequirementSupport });
    },
  };
}
/**
 * Relevance-based selection (selectProfessionalEvidence) is not chronological
 * - the strongest keyword match for a given job is not necessarily the most
 * recent role or degree. A CV's experience and education must still read
 * most-recent-first regardless of why each entry was selected, so this
 * re-sorts only those two kinds after selection, purely for presentation.
 */
function mostRecentYear(item: GenerationEvidence): number {
  if (item.kind === "experience") {
    const year = Number.parseInt(item.context?.endDate ?? item.context?.startDate ?? "", 10);
    return Number.isFinite(year) ? year : -Infinity;
  }
  const years = [...item.content.matchAll(/\d{4}/gu)].map((match) => Number.parseInt(match[0], 10));
  return years.length ? Math.max(...years) : -Infinity;
}
function mostRecentFirst(items: GenerationEvidence[]): GenerationEvidence[] {
  return [...items].sort((a, b) => mostRecentYear(b) - mostRecentYear(a));
}
function fact(item: GenerationEvidence, text = item.content, extraEvidenceIds: readonly string[] = [], idSuffix = ""): GeneratedDocumentClaim {
  return { id: `professional:${item.id}${idSuffix}`, kind: "candidateFact", provenance: text === item.content ? "verbatim" : "paraphrased", text, evidenceIds: [item.id, ...extraEvidenceIds] };
}
const MAX_EXPERIENCE_BULLETS = 5;
/**
 * The evidence catalog joins "Title at Company · Location · Dates · Summary"
 * into one content string (application-documents.ts, shared with matching -
 * never edited here). Splitting on the same " · " delimiter used to build it
 * (rather than re-parsing text) exactly separates the header fields, already
 * available structured on item.context, from the verified description text -
 * which is then split on genuine sentence boundaries into separate bullets,
 * never rewritten or invented, so a role with real detail reads as several
 * concise lines instead of one dense paragraph. When a role has more verified
 * claims than fit (MAX_EXPERIENCE_BULLETS), the ones with the most keyword
 * overlap with this specific job are kept - never dropping evidence just
 * because it comes later in the stored description - and re-sorted back to
 * their original order so the role still reads as a coherent narrative.
 */
function experienceClaims(item: GenerationEvidence, sv: boolean, jobWords: Set<string>): GeneratedDocumentClaim[] {
  const parts = item.content.split(" · ");
  const headerPartCount = 1 + (item.context?.location ? 1 : 0) + ((item.context?.startDate || item.context?.endDate) ? 1 : 0);
  const role = item.context?.role;
  const employer = item.context?.employer;
  const dates = [item.context?.startDate, item.context?.endDate].filter(Boolean).join(" – ");
  const header = [
    role && employer ? `${role}${sv ? " hos " : " at "}${employer}` : parts[0],
    item.context?.location,
    dates || undefined,
  ].filter(Boolean).join(" · ");
  const bodySentences = parts.slice(headerPartCount)
    .flatMap(part => part.split(/(?<=[.!?])\s+(?=\p{Lu})/u))
    .map(sentence => sentence.trim())
    .filter(Boolean);
  const kept = bodySentences
    .map((sentence, index) => ({ sentence, index, score: keywordOverlap(sentence, jobWords) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_EXPERIENCE_BULLETS)
    .sort((a, b) => a.index - b.index);
  return [fact(item, header, [], ":header"), ...kept.map(({ sentence }, index) => fact(item, sentence, [], `:body:${index}`))];
}
/** Strips a trailing " · <year(s)>" date suffix so an education/experience content string reads as a clause, not a database row. */
function withoutTrailingDates(content: string): string {
  return content.replace(/\s*·\s*\d{4}[^·]*$/u, "").trim();
}
/** "A, B and C" rather than "A and B and C". */
function joinNatural(items: readonly string[], conjunction: string): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items.at(-1)}`;
}
/**
 * The stored headline can be a single professional title ("IT-supporttekniker",
 * which already reads as a natural sentence subject) or a multi-value visual
 * tagline for the CV header, delimited with "|" ("IT-support | IT Coordinator
 * | Nätverk | Cloud | Cybersäkerhet"). Both places that render the headline
 * (the composed summary sentence, and the Profil section's own headline
 * claim) must agree on this split so a multi-value headline is represented
 * exactly once, never leaking its raw "|" delimiter into either.
 */
function headlineDirections(headlineText: string): string[] {
  return headlineText.split("|").map((part) => part.trim()).filter(Boolean);
}
/**
 * Existing user summary takes precedence. Otherwise composes one coherent
 * paragraph (roughly 3-5 sentences) from verified evidence only - never
 * "Label: value" lines, and never a language mention (languages belong only
 * in the dedicated Languages section, never repeated in the profile).
 */
export function composeProfessionalSummary(evidence: GenerationEvidence[], language: DocumentLanguage): GeneratedDocumentClaim[] {
  const authored = evidence.find(x => x.id === "profile:summary");
  if (authored) return [fact(authored)];
  const sv = language === "sv";
  const headline = evidence.find(x => x.id === "profile:headline");
  const role = evidence.find(x => x.kind === "experience");
  const technicalSkills = evidence.filter(x => x.kind === "skill" && !x.id.includes("soft-skill")).slice(0, 4);
  const softSkills = evidence.filter(x => x.kind === "skill" && x.id.includes("soft-skill")).slice(0, 3);
  const education = evidence.find(x => x.kind === "education");
  const certifications = evidence.filter(x => x.kind === "certification").slice(0, 3);
  const sentences: string[] = [];
  const used: GenerationEvidence[] = [];
  const roleTitle = role?.context?.role;
  const employer = role?.context?.employer;
  const headlineText = headline?.content?.trim();
  // The raw "|" delimiter must never leak into prose - a multi-value headline
  // is instead phrased as a natural list of the same stated directions (never
  // translated, never invented), exactly like any other evidence list here
  // (see joinNatural). A single-value headline is left exactly as before.
  const headlineParts = headlineText ? headlineDirections(headlineText) : [];
  const headlineSubject = headlineParts.length > 1
    ? (sv ? `Professionell inriktning mot ${joinNatural(headlineParts, "och")}` : `Professional focus on ${joinNatural(headlineParts, "and")}`)
    : headlineText;
  // Opens with professional direction (headline) and strongest technical
  // competencies - never with "role at employer", which reads as a
  // mechanical database dump rather than a professional profile.
  if (headlineSubject || technicalSkills.length) {
    if (headline) used.push(headline);
    const skillList = joinNatural(technicalSkills.map(x => skillConcept(x.content)), sv ? "och" : "and");
    used.push(...technicalSkills);
    if (headlineSubject && skillList) sentences.push(sv ? `${headlineSubject} med erfarenhet av ${skillList}.` : `${headlineSubject} with experience in ${skillList}.`);
    else if (headlineSubject) sentences.push(`${headlineSubject}.`);
    else sentences.push(sv ? `Erfarenhet av ${skillList}.` : `Experience with ${skillList}.`);
  }
  // Relevant verified experience follows as its own sentence, naming the role
  // and employer in context rather than as the profile's opening subject.
  if (role && roleTitle) {
    used.push(role);
    const roleClause = `${roleTitle}${employer ? (sv ? ` hos ${employer}` : ` at ${employer}`) : ""}`;
    sentences.push(sv ? `Har arbetat som ${roleClause}.` : `Has worked as ${roleClause}.`);
  }
  if (education) {
    used.push(education);
    const educationClause = withoutTrailingDates(education.content);
    sentences.push(sv ? `Har en utbildning inom ${educationClause}.` : `Holds an education in ${educationClause}.`);
  }
  if (certifications.length) {
    used.push(...certifications);
    const certList = joinNatural(certifications.map(x => x.content), sv ? "och" : "and");
    sentences.push(sv ? `Innehar certifieringar som ${certList}.` : `Holds certifications including ${certList}.`);
  }
  if (softSkills.length) {
    used.push(...softSkills);
    const softList = joinNatural(softSkills.map(x => skillConcept(x.content)), sv ? "och" : "and");
    sentences.push(sv ? `Van vid att arbeta med ${softList}.` : `Experienced in ${softList}.`);
  }
  if (!sentences.length) return [];
  return [{ id: "professional:summary:composed", text: sentences.join(" "), kind: "candidateFact", provenance: "paraphrased", evidenceIds: used.map(x => x.id) }];
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
      const order: GenerationEvidence["kind"][] = ["identity", "summary", "experience", "education", "skill", "certification", "project", "language", "achievement", "other"];
      const sv = request.language === "sv";
      const jobWords = jobKeywords(request);
      sections = order.flatMap((kind): GeneratedDocumentSection[] => {
        const items = (kind === "experience" || kind === "education") ? mostRecentFirst(selected.filter(x => x.kind === kind)) : selected.filter(x => x.kind === kind);
        const claims = kind === "summary"
          ? [
              // A multi-value headline is represented only once, by the composed
              // summary sentence below (see headlineDirections) - emitting it here
              // too would reintroduce the raw "|"-delimited string verbatim as its
              // own bullet. A single-value headline keeps its existing standalone
              // tagline claim, unchanged.
              ...items.filter(x => x.id === "profile:headline" && headlineDirections(x.content).length <= 1).map(x => fact(x)),
              ...(options.composeSummary === false ? [] : composeProfessionalSummary(selected, request.language)),
            ]
          : kind === "experience"
          ? items.flatMap(item => experienceClaims(item, sv, jobWords))
          : items.map(x => fact(x, kind === "skill" ? skillConcept(x.content) : x.content));
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
