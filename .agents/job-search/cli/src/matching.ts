import type { CandidateProfile } from "./profile"
import type { NormalizedJob } from "./types"

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

/**
 * Simple fuzzy string matching: case-insensitive substring or normalized comparison
 */
function fuzzyMatch(str1: string | null, str2: string | null, threshold = 0.5): boolean {
  if (!str1 || !str2) return false
  const s1 = str1.toLowerCase().trim()
  const s2 = str2.toLowerCase().trim()
  return s1 === s2 || s1.includes(s2) || s2.includes(s1)
}

function getRequirementCoverage(candidateSkills: string[], requirements: string[]): RequirementCoverage {
  const matchedRequirements = requirements.filter((requirement) =>
    candidateSkills.some((candidateSkill) => fuzzyMatch(candidateSkill, requirement)),
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

  // Check if job location matches any candidate preference
  const locationMatch = candidate.locationPreferences.some((pref) => fuzzyMatch(jobLocation, pref.toLowerCase()))

  if (locationMatch) {
    return {
      dimension: "location",
      status: "matched",
      detail: `Job location ${jobLocation} matches candidate preference`,
    }
  }

  return {
    dimension: "location",
    status: "conflicting",
    detail: `Job location is ${jobLocation}, but candidate prefers ${candidate.locationPreferences.join(", ")}`,
  }
}

/**
 * Check target role / job title
 */
function checkTargetRole(candidate: CandidateProfile, job: NormalizedJob): MatchEvidence {
  const jobTitle = job.title.toLowerCase().trim()

  const roleMatch = candidate.targetRoles.some((role) => fuzzyMatch(jobTitle, role.toLowerCase()))

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

  const description = job.description.toLowerCase()
  const softSkillKeywords = {
    communication: ["communication", "present", "speak", "write", "articulate"],
    "problem solving": ["problem solving", "analytical", "creative", "innovative"],
    collaboration: ["teamwork", "collaborate", "team player", "cross-functional"],
    ownership: ["ownership", "drive", "initiative", "self-directed", "autonomous"],
    leadership: ["lead", "manage", "mentor", "guidance"],
  }

  const matchedSoftSkills: string[] = []

  for (const [skill, keywords] of Object.entries(softSkillKeywords)) {
    if (candidate.skills.soft.some((s) => s.toLowerCase().includes(skill))) {
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
  const description = (job.description ?? "").toLowerCase()
  const title = (job.title ?? "").toLowerCase()
  const fullText = `${description} ${title}`.toLowerCase()

  const candidateLanguages = candidate.languages.map((l) => l.name.toLowerCase())

  // Look for language requirements in job
  const hasEnglishReq = fullText.includes("english") || fullText.includes("engelska")
  const hasSwedishReq = fullText.includes("swedish") || fullText.includes("svenska")

  const matchedLanguages: string[] = []

  if (hasEnglishReq && candidateLanguages.some((l) => l.includes("english"))) {
    matchedLanguages.push("English")
  }

  if (hasSwedishReq && candidateLanguages.some((l) => l.includes("swedish"))) {
    matchedLanguages.push("Swedish")
  }

  if (matchedLanguages.length > 0) {
    return {
      dimension: "languages",
      status: "matched",
      detail: `Candidate speaks ${matchedLanguages.join(", ")}, which the job requires`,
    }
  }

  if (hasEnglishReq || hasSwedishReq) {
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
