import type { CandidateProfile } from "./profile"
import type { NormalizedJob } from "./types"
import { LANGUAGE_REQUIREMENTS, candidateHasLanguage, jobLanguageEvidenceText, jobRequiresLanguage } from "./language-normalization"
import { SOFT_SKILL_CONCEPTS, SUPPORT_ROLE_CONCEPTS, TECHNICAL_CONCEPTS, canonicalConcept, conceptAliasInText, coreRoleTitle, equivalentConcepts, normalizedConceptText } from "./concept-normalization"

export type MatchDimension =
  | "targetRole"
  | "technicalSkills"
  | "softSkills"
  | "location"
  | "remotePreference"
  | "employmentType"
  | "yearsOfExperience"
  | "certifications"
  | "languages"
  | "preferredIndustries"

/**
 * Structured coverage of explicitly listed requirements. Values retain the
 * source-provided requirement text until canonical requirement identity exists.
 */
export interface RequirementCoverage {
  matchedRequirements: string[]
  missingRequirements: string[]
  coverageRatio: number
}

export interface MatchEvidence {
  dimension: MatchDimension
  status: "matched" | "missing" | "conflicting" | "unknown"
  detail: string
  requirementCoverage?: RequirementCoverage
}

export interface MatchingResult {
  jobId: string
  jobTitle: string
  candidateHeadline: string
  matched: MatchEvidence[]
  missing: MatchEvidence[]
  conflicting: MatchEvidence[]
  unknown: MatchEvidence[]
  totalMatched: number
  totalMissing: number
  totalConflicting: number
  totalUnknown: number
  matchedDimensions: MatchDimension[]
  missingDimensions: MatchDimension[]
  conflictingDimensions: MatchDimension[]
  unknownDimensions: MatchDimension[]
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Whole-word containment only - a bare substring (e.g. "java" inside "javascript") is not evidence. */
function containsWholeWord(haystack: string, needle: string): boolean {
  if (!needle) return false
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegex(needle)}(?:$|[^\\p{L}\\p{N}])`, "iu").test(haystack)
}

/**
 * Case-insensitive equality or whole-word containment. Deliberately NOT used
 * for job-title/role-identity comparisons (see checkTargetRole and
 * checkYearsOfExperience) - a whole-word title fragment like "Assistant"
 * inside "Assistant Nurse" is a clean word-boundary match yet still not
 * evidence that the two roles are the same job, so those callers rely only on
 * equivalentConcepts (exact or curated-alias equivalence).
 */
function fuzzyMatch(str1: string | null, str2: string | null): boolean {
  if (!str1 || !str2) return false
  const s1 = str1.toLowerCase().trim()
  const s2 = str2.toLowerCase().trim()
  return s1 === s2 || containsWholeWord(s1, s2) || containsWholeWord(s2, s1)
}

function getRequirementCoverage(candidateSkills: string[], requirements: string[]): RequirementCoverage {
  const matchedRequirements = requirements.filter((requirement) =>
    candidateSkills.some((candidateSkill) => equivalentConcepts(candidateSkill, requirement, TECHNICAL_CONCEPTS) || fuzzyMatch(candidateSkill, requirement)),
  )
  const missingRequirements = requirements.filter((requirement) => !matchedRequirements.includes(requirement))

  return {
    matchedRequirements,
    missingRequirements,
    coverageRatio: requirements.length === 0 ? 0 : matchedRequirements.length / requirements.length,
  }
}

/**
 * Check remote/hybrid/onsite compatibility
 */
function checkRemotePreference(candidate: CandidateProfile, job: NormalizedJob): MatchEvidence {
  const jobRemote = job.remote?.toLowerCase().trim() ?? null

  if (!jobRemote) {
    return {
      dimension: "remotePreference",
      status: "unknown",
      detail: "Job does not specify remote/hybrid/onsite work mode",
    }
  }

  const candidateRemote = candidate.remotePreference
  const candidateWorkMode = candidate.workMode

  // Job is fully remote - always matches if candidate accepts remote
  if (jobRemote.includes("remote") || jobRemote.includes("fully")) {
    if (candidateRemote) {
      return {
        dimension: "remotePreference",
        status: "matched",
        detail: `Candidate accepts remote work; job is ${jobRemote}`,
      }
    }
    return {
      dimension: "remotePreference",
      status: "conflicting",
      detail: `Job is ${jobRemote}, but candidate prefers onsite or hybrid`,
    }
  }

  // Job is hybrid - matches if candidate accepts hybrid or remote
  if (jobRemote.includes("hybrid")) {
    if (candidateRemote || candidateWorkMode === "hybrid") {
      return {
        dimension: "remotePreference",
        status: "matched",
        detail: "Candidate accepts hybrid work; job is hybrid",
      }
    }
    return {
      dimension: "remotePreference",
      status: "conflicting",
      detail: "Job is hybrid, but candidate prefers onsite only",
    }
  }

  // Job is onsite
  if (candidateWorkMode === "onsite" || candidateWorkMode === "open") {
    return {
      dimension: "remotePreference",
      status: "matched",
      detail: "Candidate accepts onsite work; job is onsite",
    }
  }

  return {
    dimension: "remotePreference",
    status: "conflicting",
    detail: `Job is onsite, but candidate prefers ${candidateWorkMode}`,
  }
}

/**
 * Check employment type compatibility
 */
function checkEmploymentType(candidate: CandidateProfile, job: NormalizedJob): MatchEvidence {
  const jobType = job.employmentType?.toLowerCase().trim() ?? null

  if (!jobType) {
    return {
      dimension: "employmentType",
      status: "unknown",
      detail: "Job does not specify employment type",
    }
  }

  const matchingTypes = candidate.preferredEmploymentType.some((type) => jobType.includes(type.toLowerCase()))

  if (matchingTypes || candidate.preferredEmploymentType.includes("open")) {
    return {
      dimension: "employmentType",
      status: "matched",
      detail: `Job is ${jobType}; candidate accepts ${candidate.preferredEmploymentType.join(", ")}`,
    }
  }

  return {
    dimension: "employmentType",
    status: "conflicting",
    detail: `Job is ${jobType}, but candidate prefers ${candidate.preferredEmploymentType.join(", ")}`,
  }
}

/**
 * Check location compatibility
 */
function checkLocation(candidate: CandidateProfile, job: NormalizedJob): MatchEvidence {
  const jobLocation = job.location?.toLowerCase().trim() ?? null

  if (!jobLocation) {
    return {
      dimension: "location",
      status: "unknown",
      detail: "Job does not specify location",
    }
  }

  // If candidate is open to remote, location is less critical
  if (candidate.remotePreference && job.remote?.toLowerCase().includes("remote")) {
    return {
      dimension: "location",
      status: "matched",
      detail: `Job is remote; candidate accepts remote`,
    }
  }

  if (candidate.locationPreferences.length === 0) {
    return {
      dimension: "location",
      status: "matched",
      detail: "Candidate has no location restriction",
    }
  }

  // Check if job location matches any candidate preference
  const locationMatch = candidate.locationPreferences.some((pref) => fuzzyMatch(jobLocation, pref.toLowerCase()))

  if (locationMatch) {
    return {
      dimension: "location",
      status: "matched",
      detail: `Job location ${jobLocation} matches candidate preference`,
    }
  }

  // A country-level preference (e.g. "Sweden") cannot be confirmed or
  // contradicted by a bare city name such as "Jönköping" - most sources
  // normalize `location` to a city without the country. Comparing against
  // the job's explicit `country` field avoids fabricating a conflict every
  // time a candidate states a country rather than listing every city; a real
  // country mismatch still falls through to the conflict below.
  const countryPreferenceKeys = candidate.locationPreferences.flatMap((pref) => {
    const key = countryKeyFor(pref)
    return key ? [key] : []
  })
  if (countryPreferenceKeys.length > 0) {
    const jobCountryKey = countryKeyFor(job.country)
    if (!jobCountryKey) {
      return {
        dimension: "location",
        status: "unknown",
        detail: "Job does not state a country to compare against candidate's country-level location preference",
      }
    }
    if (countryPreferenceKeys.includes(jobCountryKey)) {
      return {
        dimension: "location",
        status: "matched",
        detail: `Job is located in ${job.country}, matching candidate's country-level preference`,
      }
    }
  }

  return {
    dimension: "location",
    status: "conflicting",
    detail: `Job location is ${jobLocation}, but candidate prefers ${candidate.locationPreferences.join(", ")}`,
  }
}

/** Country name aliases recognized as a country-level location preference. */
const COUNTRY_NAME_ALIASES: Record<string, readonly string[]> = {
  sweden: ["sweden", "sverige"],
  denmark: ["denmark", "danmark"],
  norway: ["norway", "norge"],
  finland: ["finland", "suomi"],
}

/** Exact-match only: a multi-part value like "Jönköping, Sweden" is a city preference, not a country-level one. */
function countryKeyFor(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.toLowerCase().trim()
  for (const [key, aliases] of Object.entries(COUNTRY_NAME_ALIASES)) {
    if (aliases.includes(normalized)) return key
  }
  return null
}

/**
 * Check target role / job title
 */
function checkTargetRole(candidate: CandidateProfile, job: NormalizedJob): MatchEvidence {
  if (candidate.targetRoles.length === 0) {
    return {
      dimension: "targetRole",
      status: "unknown",
      detail: "Candidate has not specified target roles",
    }
  }

  // Canonical concept equivalence, plus bounded containment of a *recognized*
  // concept's own phrase (see conceptAliasInText) - e.g. "IT Support" inside
  // "English IT Support Technician". Deliberately NOT generic fuzzyMatch: a
  // whole-word overlap on unrecognized free text (e.g. a candidate's
  // "Assistant" target role against a job titled "Assistant Nurse") is not
  // evidence the roles are equivalent and must never fabricate a "matched"
  // targetRole.
  //
  // A third, still-conservative check: compare the same two titles again
  // after stripping only a punctuation-delimited annotation and/or a generic
  // seniority modifier (see coreRoleTitle) - e.g. "Data Analyst" against
  // "Data Analyst (Junior)", or "Systemutvecklare" against "Systemutvecklare
  // - Java". This never performs bare substring matching, so it cannot
  // reintroduce the "Assistant Nurse" problem: that title has no punctuation
  // boundary between "Assistant" and "Nurse" for anything to strip.
  const roleMatch = candidate.targetRoles.some((role) => {
    if (equivalentConcepts(role, job.title, SUPPORT_ROLE_CONCEPTS) || conceptAliasInText(role, job.title, SUPPORT_ROLE_CONCEPTS)) return true
    const coreRole = coreRoleTitle(role)
    const coreJobTitle = coreRoleTitle(job.title)
    return Boolean(coreRole) && Boolean(coreJobTitle) && (equivalentConcepts(coreRole, coreJobTitle, SUPPORT_ROLE_CONCEPTS) || conceptAliasInText(coreRole, coreJobTitle, SUPPORT_ROLE_CONCEPTS))
  })

  if (roleMatch) {
    return {
      dimension: "targetRole",
      status: "matched",
      detail: `Job title "${job.title}" matches target role`,
    }
  }

  return {
    dimension: "targetRole",
    status: "missing",
    detail: `Job title "${job.title}" does not match target roles: ${candidate.targetRoles.join(", ")}`,
  }
}

/**
 * Check technical skills
 */
function checkTechnicalSkills(candidate: CandidateProfile, job: NormalizedJob): MatchEvidence {
  if (!job.skills || job.skills.length === 0) {
    return {
      dimension: "technicalSkills",
      status: "unknown",
      detail: "Job does not list required technical skills",
    }
  }

  const requirementCoverage = getRequirementCoverage(candidate.skills.technical, job.skills)
  const matchedCount = requirementCoverage.matchedRequirements.length
  const totalRequirements = job.skills.length

  if (matchedCount === 0) {
    return {
      dimension: "technicalSkills",
      status: "missing",
      detail: `Candidate has none of the required skills: ${job.skills.slice(0, 5).join(", ")}${job.skills.length > 5 ? `... (${job.skills.length} total)` : ""}`,
      requirementCoverage,
    }
  }

  if (matchedCount === totalRequirements) {
    return {
      dimension: "technicalSkills",
      status: "matched",
      detail: `Candidate has all ${totalRequirements} listed skills: ${requirementCoverage.matchedRequirements.slice(0, 3).join(", ")}${matchedCount > 3 ? "..." : ""}`,
      requirementCoverage,
    }
  }

  return {
    dimension: "technicalSkills",
    status: "missing",
    detail: `Candidate has ${matchedCount} of ${totalRequirements} listed skills; ${requirementCoverage.missingRequirements.length} remain missing`,
    requirementCoverage,
  }
}

/**
 * Check soft skills (if description provides clues)
 */
function checkSoftSkills(candidate: CandidateProfile, job: NormalizedJob): MatchEvidence {
  if (!job.description) {
    return {
      dimension: "softSkills",
      status: "unknown",
      detail: "Job description not available to assess soft skill requirements",
    }
  }

  const description = normalizedConceptText(job.description)
  const softSkillKeywords: Record<string, readonly string[]> = {
    communication: ["communication", "present", "speak", "write", "articulate", "kommunikation"],
    "problem solving": ["problem solving", "analytical", "creative", "innovative", "problemlösning", "problemlosning"],
    collaboration: ["teamwork", "collaborate", "team player", "cross functional", "samarbete"],
    ownership: ["ownership", "drive", "initiative", "self directed", "autonomous", "ansvarstagande"],
    leadership: ["lead", "manage", "mentor", "guidance", "ledarskap"],
  }

  const matchedSoftSkills: string[] = []

  for (const [skill, keywords] of Object.entries(softSkillKeywords)) {
    if (candidate.skills.soft.some((candidateSkill) => canonicalConcept(candidateSkill, SOFT_SKILL_CONCEPTS) === skill || normalizedConceptText(candidateSkill).includes(skill))) {
      if (keywords.some((kw) => description.includes(kw))) {
        matchedSoftSkills.push(skill)
      }
    }
  }

  if (matchedSoftSkills.length > 0) {
    return {
      dimension: "softSkills",
      status: "matched",
      detail: `Candidate's soft skills (${matchedSoftSkills.join(", ")}) appear relevant to the role`,
    }
  }

  return {
    dimension: "softSkills",
    status: "unknown",
    detail: "Job description does not explicitly reference soft skill requirements",
  }
}

/**
 * Check years of experience vs job seniority
 */
function checkYearsOfExperience(candidate: CandidateProfile, job: NormalizedJob): MatchEvidence {
  const jobSeniority = job.seniority?.toLowerCase().trim() ?? null

  if (!jobSeniority) {
    const description = normalizedConceptText(job.description ?? "")
    const explicitlyRequiresExperience = /\b(?:experience|erfarenhet)\b/u.test(description)
    // Canonical concept equivalence only - a bare substring overlap (e.g. a
    // candidate's "Assistant" title against a job titled "Assistant Nurse")
    // is not evidence of relevant experience and must never fabricate a
    // "matched" score for this dimension.
    const hasRelevantExperience = candidate.workExperience.some((experience) =>
      equivalentConcepts(experience.title, job.title, SUPPORT_ROLE_CONCEPTS),
    )
    if (explicitlyRequiresExperience && hasRelevantExperience) {
      return {
        dimension: "yearsOfExperience",
        status: "matched",
        detail: "Candidate has structured experience relevant to the job title",
      }
    }
    return {
      dimension: "yearsOfExperience",
      status: "unknown",
      detail: "Job does not specify seniority level",
    }
  }

  // Map seniority to rough experience ranges
  const seniorityMap: Record<string, { min: number; max: number }> = {
    junior: { min: 0, max: 2 },
    mid: { min: 2, max: 5 },
    senior: { min: 5, max: 15 },
    lead: { min: 7, max: 20 },
    principal: { min: 10, max: 30 },
    internship: { min: 0, max: 1 },
    graduate: { min: 0, max: 1 },
    entry: { min: 0, max: 2 },
  }

  let matched = false
  for (const [key, range] of Object.entries(seniorityMap)) {
    if (jobSeniority.includes(key)) {
      if (candidate.yearsOfExperience >= range.min && candidate.yearsOfExperience <= range.max) {
        matched = true
      }
      break
    }
  }

  if (matched) {
    return {
      dimension: "yearsOfExperience",
      status: "matched",
      detail: `Candidate has ${candidate.yearsOfExperience} years experience; job requires ${jobSeniority}`,
    }
  }

  return {
    dimension: "yearsOfExperience",
    status: "conflicting",
    detail: `Candidate has ${candidate.yearsOfExperience} years experience, but job requires ${jobSeniority}`,
  }
}

/**
 * Check certifications (if listed in job description)
 */
function checkCertifications(candidate: CandidateProfile, job: NormalizedJob): MatchEvidence {
  if (!job.description) {
    return {
      dimension: "certifications",
      status: "unknown",
      detail: "Job description not available to assess certification requirements",
    }
  }

  const description = job.description.toLowerCase()
  const hasRequiredCerts = candidate.certifications.some((cert) => description.includes(cert.toLowerCase()))

  if (hasRequiredCerts) {
    return {
      dimension: "certifications",
      status: "matched",
      detail: `Candidate holds relevant certifications`,
    }
  }

  return {
    dimension: "certifications",
    status: "unknown",
    detail: "No specific certification match found in job description",
  }
}

/**
 * Check languages (if listed in job description or can be inferred)
 */
function checkLanguages(candidate: CandidateProfile, job: NormalizedJob): MatchEvidence {
  // Description-only (see jobLanguageEvidenceText): a job title is too weak a
  // signal to promote a language requirement, and analyzeSkillGaps reads
  // from the same function so this dimension and the language gap it may
  // produce never disagree about what counts as evidence.
  const fullText = jobLanguageEvidenceText(job).toLowerCase()

  const candidateLanguages = candidate.languages.map((language) => language.name)
  const requiredLanguages = LANGUAGE_REQUIREMENTS.filter((requirement) => jobRequiresLanguage(fullText, requirement))
  const matchedLanguages = requiredLanguages
    .filter((requirement) => candidateHasLanguage(candidateLanguages, requirement))
    .map((requirement) => requirement.canonical)

  if (matchedLanguages.length > 0) {
    return {
      dimension: "languages",
      status: "matched",
      detail: `Candidate speaks ${matchedLanguages.join(", ")}, which the job requires`,
    }
  }

  if (requiredLanguages.length > 0) {
    return {
      dimension: "languages",
      status: "conflicting",
      detail: `Job requires language not listed in candidate's profile`,
    }
  }

  return {
    dimension: "languages",
    status: "unknown",
    detail: "Job does not specify language requirements",
  }
}

/**
 * Check preferred industries (if available in job)
 */
function checkPreferredIndustries(candidate: CandidateProfile, job: NormalizedJob): MatchEvidence {
  if (!job.category) {
    return {
      dimension: "preferredIndustries",
      status: "unknown",
      detail: "Job does not specify industry category",
    }
  }

  if (candidate.preferredIndustries.length === 0) {
    return {
      dimension: "preferredIndustries",
      status: "unknown",
      detail: "Candidate has no industry restriction",
    }
  }

  const jobCategory = job.category.toLowerCase()
  const matchedIndustry = candidate.preferredIndustries.some((ind) => jobCategory.includes(ind.toLowerCase()) || ind.toLowerCase().includes(jobCategory))

  if (matchedIndustry) {
    return {
      dimension: "preferredIndustries",
      status: "matched",
      detail: `Job category "${job.category}" matches candidate's preferences`,
    }
  }

  return {
    dimension: "preferredIndustries",
    status: "unknown",
    detail: `Job category "${job.category}" does not directly match preferences, but not a conflict`,
  }
}

/**
 * Main matching function: compare candidate profile against job
 */
export function matchProfile(candidate: CandidateProfile, job: NormalizedJob): MatchingResult {
  const evidence: MatchEvidence[] = []

  // Evaluate all dimensions
  evidence.push(checkTargetRole(candidate, job))
  evidence.push(checkTechnicalSkills(candidate, job))
  evidence.push(checkSoftSkills(candidate, job))
  evidence.push(checkLocation(candidate, job))
  evidence.push(checkRemotePreference(candidate, job))
  evidence.push(checkEmploymentType(candidate, job))
  evidence.push(checkYearsOfExperience(candidate, job))
  evidence.push(checkCertifications(candidate, job))
  evidence.push(checkLanguages(candidate, job))
  evidence.push(checkPreferredIndustries(candidate, job))

  // Organize by status
  const matched = evidence.filter((e) => e.status === "matched")
  const missing = evidence.filter((e) => e.status === "missing")
  const conflicting = evidence.filter((e) => e.status === "conflicting")
  const unknown = evidence.filter((e) => e.status === "unknown")

  return {
    jobId: job.id,
    jobTitle: job.title,
    candidateHeadline: candidate.headline,
    matched,
    missing,
    conflicting,
    unknown,
    totalMatched: matched.length,
    totalMissing: missing.length,
    totalConflicting: conflicting.length,
    totalUnknown: unknown.length,
    matchedDimensions: matched.map((e) => e.dimension),
    missingDimensions: missing.map((e) => e.dimension),
    conflictingDimensions: conflicting.map((e) => e.dimension),
    unknownDimensions: unknown.map((e) => e.dimension),
  }
}
