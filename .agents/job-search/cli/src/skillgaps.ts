import type { CandidateProfile } from "./profile"
import type { NormalizedJob } from "./types"
import type { MatchingResult } from "./matching"
import {
  createRequirementDescriptor,
  type RequirementDescriptor,
} from "./requirements"
import { explicitRequirementSegments } from "./requirement-context"
import type { ExtractedTechnicalRequirement } from "./job-requirement-extraction"
import { LANGUAGE_REQUIREMENTS, candidateHasLanguage, jobLanguageEvidenceText, jobRequiresLanguage } from "./language-normalization"
import { TECHNICAL_CONCEPTS, equivalentConcepts } from "./concept-normalization"

export type GapType = "missing_skill" | "insufficient_skill" | "missing_certification" | "missing_language" | "experience_gap" | "education_gap" | "other"
export type GapSeverity = "critical" | "high" | "medium" | "low"

export interface SkillGap {
  type: GapType
  title: string
  description: string
  jobRequirement: string
  candidateHas?: string // What the candidate has, if anything
  severity: GapSeverity
  evidence: string
  requirement?: RequirementDescriptor
}

export interface SkillStrength {
  title: string
  description: string
  relevance: string // How relevant to the job
  evidence: string
}

export interface SkillUnknown {
  dimension: string
  reason: string
}

export interface SkillGapRecommendation {
  title: string
  description: string
  targetGaps: string[] // titles of gaps this addresses
  priority: "high" | "medium" | "low"
  estimatedEffort?: string
  targetRequirementKeys?: string[]
}

export interface SkillGapResult {
  jobId: string
  jobTitle: string
  candidateHeadline: string
  gaps: SkillGap[]
  strengths: SkillStrength[]
  unknowns: SkillUnknown[]
  recommendations: SkillGapRecommendation[]
  totalGaps: number
  criticalGaps: number
  highGaps: number
  summary: string
}

export interface SkillGapAnalysisOptions {
  technicalRequirements?: readonly ExtractedTechnicalRequirement[]
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
 * Fuzzy match helper - kept in sync with matching.ts's fuzzyMatch so the
 * matching engine and skill-gap analysis never disagree about what counts as
 * a skill match.
 */
function fuzzyMatch(str1: string | null, str2: string | null): boolean {
  if (!str1 || !str2) return false
  const s1 = str1.toLowerCase().trim()
  const s2 = str2.toLowerCase().trim()
  return s1 === s2 || containsWholeWord(s1, s2) || containsWholeWord(s2, s1)
}

/**
 * Find overlap between two skill lists (case-insensitive)
 */
function skillsOverlap(candidateSkills: string[], jobSkills: string[]): string[] {
  if (jobSkills.length === 0) return []
  return candidateSkills.filter((cSkill) => jobSkills.some((jSkill) => equivalentConcepts(cSkill, jSkill, TECHNICAL_CONCEPTS) || fuzzyMatch(cSkill, jSkill)))
}

/**
 * Analyze technical skill gaps
 */
function analyzeTechnicalSkillGaps(
  candidate: CandidateProfile,
  job: NormalizedJob,
  matchingResult: MatchingResult,
  requirements: readonly ExtractedTechnicalRequirement[] = [],
): { gaps: SkillGap[]; strengths: SkillStrength[] } {
  const gaps: SkillGap[] = []
  const strengths: SkillStrength[] = []

  if (!job.skills || job.skills.length === 0) {
    // No skills in job posting - cannot identify gaps
    return { gaps, strengths }
  }

  const candidateTechSkills = candidate.skills.technical
  const jobSkills = job.skills

  const technicalEvidence = [...matchingResult.matched, ...matchingResult.missing]
    .find((evidence) => evidence.dimension === "technicalSkills")
  const requirementCoverage = technicalEvidence?.requirementCoverage
  const matchedJobSkills = requirementCoverage?.matchedRequirements
    ?? jobSkills.filter((jobSkill) => candidateTechSkills.some((candidateSkill) => equivalentConcepts(candidateSkill, jobSkill, TECHNICAL_CONCEPTS) || fuzzyMatch(candidateSkill, jobSkill)))
  const missingJobSkills = requirementCoverage?.missingRequirements
    ?? jobSkills.filter((jobSkill) => !matchedJobSkills.includes(jobSkill))

  // Find matched skills (strengths)
  for (const jobSkill of matchedJobSkills) {
    const candidateSkill = candidateTechSkills.find((skill) => equivalentConcepts(skill, jobSkill, TECHNICAL_CONCEPTS) || fuzzyMatch(skill, jobSkill)) ?? jobSkill
    strengths.push({
      title: candidateSkill,
      description: `Candidate has experience with ${candidateSkill}`,
      relevance: `Required by the job`,
      evidence: `Found in job requirements: ${jobSkill}`,
    })
  }

  for (const skill of missingJobSkills) {
    const extracted = requirements.find((requirement) => requirement.canonical === skill)
    const requirementLabel = extracted?.importance === "preferred" ? "Preferred" : "Required"
    gaps.push({
      type: "missing_skill",
      title: `Missing: ${skill}`,
      description: extracted?.importance === "preferred"
        ? `Candidate profile does not list the preferred skill: ${skill}`
        : `Candidate does not have the required skill: ${skill}`,
      jobRequirement: `${requirementLabel}: ${skill}`,
      severity: extracted ? determineExtractedRequirementSeverity(extracted) : determineSkillSeverity(skill, jobSkills.length),
      evidence: extracted?.evidence ?? `Job explicitly lists: ${skill}`,
      requirement: createRequirementDescriptor("skill", skill, extracted?.importance ?? "required"),
    })
  }

  return { gaps, strengths }
}

function determineExtractedRequirementSeverity(requirement: ExtractedTechnicalRequirement): GapSeverity {
  if (requirement.importance === "preferred") return "low"
  if (/\b(?:mandatory|essential|critical|non-negotiable|obligatorisk|avgörande|nödvändig)\b/i.test(requirement.evidence)) return "high"
  return "medium"
}

/**
 * Determine severity of missing skill based on context
 */
function determineSkillSeverity(skill: string, totalSkills: number): GapSeverity {
  // Core infrastructure skills are critical
  if (["Kubernetes", "Docker", "AWS", "Azure", "GCP", "Terraform"].some((s) => skill.toLowerCase().includes(s.toLowerCase()))) {
    return "critical"
  }
  // Programming languages are high priority
  if (["Python", "Java", "Rust", "Go", "C++", "JavaScript", "TypeScript"].some((s) => skill.toLowerCase().includes(s.toLowerCase()))) {
    return "high"
  }
  // Frameworks/libraries are medium
  if (["React", "Vue", "Angular", "Django", "Flask", "Rails"].some((s) => skill.toLowerCase().includes(s.toLowerCase()))) {
    return "medium"
  }
  // Tools are lower priority
  return "low"
}

/**
 * Analyze soft skill requirements
 */
function analyzeSoftSkillGaps(candidate: CandidateProfile, job: NormalizedJob): { gaps: SkillGap[]; strengths: SkillStrength[] } {
  const gaps: SkillGap[] = []
  const strengths: SkillStrength[] = []

  if (!job.description) {
    // Cannot analyze soft skills without description
    return { gaps, strengths }
  }

  const candidateSoftSkills = candidate.skills.soft

  const softSkillKeywords: Record<string, string[]> = {
    communication: ["communication", "present", "speak", "write", "articulate"],
    "problem solving": ["problem solving", "analytical", "creative", "innovative"],
    collaboration: ["teamwork", "collaborate", "team player", "cross-functional"],
    ownership: ["ownership", "drive", "initiative", "self-directed", "autonomous"],
    leadership: ["lead", "manage", "mentor", "guidance"],
  }

  for (const [skill, keywords] of Object.entries(softSkillKeywords)) {
    const hasSoftSkill = candidateSoftSkills.some((s) => s.toLowerCase().includes(skill.toLowerCase()))
    const requirementSegments = explicitRequirementSegments(job.description, keywords)
    const jobRequiresSoftSkill = requirementSegments.length > 0

    if (jobRequiresSoftSkill) {
      if (hasSoftSkill) {
        strengths.push({
          title: skill,
          description: `Candidate demonstrates ${skill}`,
          relevance: `Job explicitly values ${skill}`,
          evidence: `Job explicitly requires: ${skill}`,
        })
      }
    }
  }

  return { gaps, strengths }
}

/**
 * Analyze certification gaps
 */
function analyzeCertificationGaps(candidate: CandidateProfile, job: NormalizedJob): { gaps: SkillGap[]; strengths: SkillStrength[] } {
  const gaps: SkillGap[] = []
  const strengths: SkillStrength[] = []

  if (!job.description) {
    // Cannot determine cert requirements without description
    return { gaps, strengths }
  }

  const description = job.description.toLowerCase()

  // A product or platform mention is not a certification requirement. Require
  // both certification wording and explicit requirement language in context.
  const commonCertifications = ["AWS", "Azure", "GCP", "Kubernetes", "CISSP", "Security+", "PMP", "CAPM", "CPA", "CFA"]

  for (const cert of commonCertifications) {
    const certificationTerms = [`${cert} certification`, `${cert} certificate`, `certified ${cert}`, `${cert}-certifier`]
    const requirementSegments = explicitRequirementSegments(job.description, certificationTerms)
    const certificationMentioned = description.includes(cert.toLowerCase())
      && /certif|certificate|certifier/.test(description)
    const candidateHasCert = candidate.certifications.some((c) => c.toLowerCase().includes(cert.toLowerCase()))

    if (certificationMentioned && candidateHasCert) {
      const actualCert = candidate.certifications.find((c) => c.toLowerCase().includes(cert.toLowerCase()))
      strengths.push({
        title: actualCert || cert,
        description: `Candidate holds: ${actualCert || cert}`,
        relevance: `Required or valued by the job`,
        evidence: `Job mentions: ${cert}`,
      })
    } else if (requirementSegments.length > 0) {
      gaps.push({
        type: "missing_certification",
        title: `Missing: ${cert} certification`,
        description: `Job mentions ${cert} certification, which candidate does not have`,
        jobRequirement: `Mentions: ${cert}`,
        severity: "medium",
        evidence: `Job explicitly requires ${cert} certification`,
        requirement: createRequirementDescriptor("certification", cert, "required"),
      })
    }
  }

  // Also check for non-standard certifications candidate has
  for (const cert of candidate.certifications) {
    if (description.includes(cert.toLowerCase())) {
      // Already handled above if it's a common cert
      const isCommon = commonCertifications.some((c) => cert.toLowerCase().includes(c.toLowerCase()))
      if (!isCommon) {
        strengths.push({
          title: cert,
          description: `Candidate holds: ${cert}`,
          relevance: `Required or valued by the job`,
          evidence: `Job mentions: ${cert}`,
        })
      }
    }
  }

  return { gaps, strengths }
}

/**
 * Analyze language gaps
 */
function analyzeLanguageGaps(candidate: CandidateProfile, job: NormalizedJob): { gaps: SkillGap[]; strengths: SkillStrength[] } {
  const gaps: SkillGap[] = []
  const strengths: SkillStrength[] = []

  // Description-only, matching checkLanguages in matching.ts (via the same
  // jobLanguageEvidenceText helper) - a job title is too weak a signal to
  // promote a language requirement. Reading from a different text than the
  // matching dimension would let this gap disagree with the score: a
  // title-only mention could raise a "high" severity gap here while the
  // corresponding match dimension stays "unknown", which is exactly the kind
  // of unexplainable inconsistency that must not happen.
  const fullText = jobLanguageEvidenceText(job).toLowerCase()

  const candidateLanguages = candidate.languages
  const candidateLanguageNames = candidateLanguages.map((language) => language.name)

  for (const requirement of LANGUAGE_REQUIREMENTS) {
    if (jobRequiresLanguage(fullText, requirement)) {
      if (candidateHasLanguage(candidateLanguageNames, requirement)) {
        const lang = candidateLanguages.find((language) => candidateHasLanguage([language.name], requirement))
        strengths.push({
          title: requirement.canonical,
          description: `Candidate speaks ${requirement.canonical} (${lang?.level || "unknown level"})`,
          relevance: `Required by the job`,
          evidence: `Job requires: ${requirement.canonical}`,
        })
      } else {
        gaps.push({
          type: "missing_language",
          title: `Missing: ${requirement.canonical}`,
          description: `Job requires ${requirement.canonical} language skills, candidate does not list them`,
          jobRequirement: `Required: ${requirement.canonical}`,
          severity: "high",
          evidence: `Job description mentions: ${requirement.aliases.filter((alias) => fullText.includes(alias)).join(", ")}`,
          requirement: createRequirementDescriptor("language", requirement.canonical, "required"),
        })
      }
    }
  }

  return { gaps, strengths }
}

/**
 * Analyze experience gaps
 */
function analyzeExperienceGaps(candidate: CandidateProfile, job: NormalizedJob): { gaps: SkillGap[]; strengths: SkillStrength[] } {
  const gaps: SkillGap[] = []
  const strengths: SkillStrength[] = []

  if (!job.seniority) {
    // No seniority requirement
    return { gaps, strengths }
  }

  const jobSeniority = job.seniority.toLowerCase()
  const candidateYears = candidate.yearsOfExperience

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

  for (const [key, range] of Object.entries(seniorityMap)) {
    if (jobSeniority.includes(key)) {
      if (candidateYears >= range.min && candidateYears <= range.max) {
        strengths.push({
          title: `Experience level: ${key}`,
          description: `Candidate has ${candidateYears} years experience, matching job requirement of ${key}-level`,
          relevance: `Exact level match`,
          evidence: `Job requires: ${key}`,
        })
      } else if (candidateYears < range.min) {
        gaps.push({
          type: "experience_gap",
          title: `Insufficient experience`,
          description: `Job requires ${key}-level experience (${range.min}+ years), candidate has ${candidateYears} years`,
          jobRequirement: `Requires: ${key} (${range.min}+ years)`,
          candidateHas: `${candidateYears} years`,
          severity: "high",
          evidence: `Job listing specifies: ${key}`,
          requirement: createRequirementDescriptor("experience", `${key} (${range.min}+ years)`, "required"),
        })
      }
      break
    }
  }

  return { gaps, strengths }
}

/**
 * Analyze education gaps
 */
function analyzeEducationGaps(candidate: CandidateProfile, job: NormalizedJob): { gaps: SkillGap[]; strengths: SkillStrength[] } {
  const gaps: SkillGap[] = []
  const strengths: SkillStrength[] = []

  if (!job.description) {
    return { gaps, strengths }
  }

  const degreeTests = [
    { degree: "PhD", level: 3, keywords: ["phd", "doctorate", "ph.d", "doktorsexamen"] },
    { degree: "Master", level: 2, keywords: ["master", "msc", "m.s.", "graduate degree", "masterexamen"] },
    { degree: "Bachelor", level: 1, keywords: ["bachelor", "bsc", "b.s.", "kandidatexamen"] },
  ] as const
  const explicitDegrees = degreeTests.filter(({ keywords }) => explicitRequirementSegments(job.description!, keywords).length > 0)
  if (explicitDegrees.length === 0) return { gaps, strengths }

  // "Bachelor's or Master's" expresses one minimum threshold, not two gaps.
  const requiredDegree = explicitDegrees.reduce((lowest, current) => current.level < lowest.level ? current : lowest)
  const candidateLevel = candidate.education.reduce((highest, education) => {
    const text = education.degree.toLowerCase()
    const level = degreeTests.find(({ keywords }) => keywords.some((keyword) => text.includes(keyword)))?.level ?? 0
    return Math.max(highest, level)
  }, 0)
  const candidateHasDegree = candidateLevel >= requiredDegree.level

  if (candidateHasDegree) {
    strengths.push({
      title: `${requiredDegree.degree} degree`,
      description: `Candidate meets the ${requiredDegree.degree} degree threshold`,
      relevance: `Satisfies job education requirement`,
      evidence: `Job requires: ${requiredDegree.degree}`,
    })
  } else {
    gaps.push({
      type: "education_gap",
      title: `Missing: ${requiredDegree.degree} degree`,
      description: `Job requires ${requiredDegree.degree} degree, candidate does not list an equivalent level`,
      jobRequirement: `Requires: ${requiredDegree.degree}`,
      severity: "medium",
      evidence: `Job explicitly requires: ${requiredDegree.degree}`,
      requirement: createRequirementDescriptor("education", requiredDegree.degree, "required"),
    })
  }

  return { gaps, strengths }
}

/**
 * Generate recommendations based on identified gaps
 */
function generateRecommendations(gaps: SkillGap[]): SkillGapRecommendation[] {
  const recommendations: SkillGapRecommendation[] = []

  const criticalSkillGaps = gaps.filter((g) => g.type === "missing_skill" && g.severity === "critical")
  const highSkillGaps = gaps.filter((g) => g.type === "missing_skill" && g.severity === "high")
  const languageGaps = gaps.filter((g) => g.type === "missing_language")
  const certGaps = gaps.filter((g) => g.type === "missing_certification")
  const expGaps = gaps.filter((g) => g.type === "experience_gap")

  if (criticalSkillGaps.length > 0) {
    recommendations.push({
      title: "Master critical technical skills",
      description: `The job requires infrastructure expertise in ${criticalSkillGaps.map((g) => g.jobRequirement).join(", ")}. These are essential for the role.`,
      targetGaps: criticalSkillGaps.map((g) => g.title),
      targetRequirementKeys: criticalSkillGaps.flatMap((g) => g.requirement ? [g.requirement.identity.key] : []),
      priority: "high",
      estimatedEffort: "3-6 months of intensive study",
    })
  }

  if (highSkillGaps.length > 0) {
    recommendations.push({
      title: "Develop required programming and framework skills",
      description: `Strengthen expertise in ${highSkillGaps.map((g) => g.jobRequirement).join(", ")} through hands-on projects.`,
      targetGaps: highSkillGaps.map((g) => g.title),
      targetRequirementKeys: highSkillGaps.flatMap((g) => g.requirement ? [g.requirement.identity.key] : []),
      priority: "high",
      estimatedEffort: "2-4 months",
    })
  }

  if (languageGaps.length > 0) {
    recommendations.push({
      title: "Achieve language proficiency",
      description: `The job requires ${languageGaps.map((g) => g.jobRequirement).join(", ")}. Consider language courses or immersion.`,
      targetGaps: languageGaps.map((g) => g.title),
      targetRequirementKeys: languageGaps.flatMap((g) => g.requirement ? [g.requirement.identity.key] : []),
      priority: "high",
      estimatedEffort: "Varies by target proficiency (3-12 months)",
    })
  }

  if (certGaps.length > 0) {
    recommendations.push({
      title: "Obtain required certifications",
      description: `Pursue ${certGaps.map((g) => g.jobRequirement).join(", ")} to strengthen candidacy.`,
      targetGaps: certGaps.map((g) => g.title),
      targetRequirementKeys: certGaps.flatMap((g) => g.requirement ? [g.requirement.identity.key] : []),
      priority: "medium",
      estimatedEffort: "1-3 months per certification",
    })
  }

  if (expGaps.length > 0) {
    recommendations.push({
      title: "Gain experience in the target seniority level",
      description: `Seek roles that develop mid-to-senior level capabilities through project ownership and mentorship.`,
      targetGaps: expGaps.map((g) => g.title),
      targetRequirementKeys: expGaps.flatMap((g) => g.requirement ? [g.requirement.identity.key] : []),
      priority: "medium",
      estimatedEffort: "1-2 years",
    })
  }

  return recommendations
}

/**
 * Analyze skill gaps for a candidate against a job posting
 */
export function analyzeSkillGaps(
  candidate: CandidateProfile,
  job: NormalizedJob,
  matchingResult: MatchingResult,
  options: SkillGapAnalysisOptions = {},
): SkillGapResult {
  const gaps: SkillGap[] = []
  const strengths: SkillStrength[] = []
  const unknowns: SkillUnknown[] = []

  // Analyze each category
  const { gaps: techGaps, strengths: techStrengths } = analyzeTechnicalSkillGaps(candidate, job, matchingResult, options.technicalRequirements)
  gaps.push(...techGaps)
  strengths.push(...techStrengths)

  const { gaps: softGaps, strengths: softStrengths } = analyzeSoftSkillGaps(candidate, job)
  gaps.push(...softGaps)
  strengths.push(...softStrengths)

  const { gaps: certGaps, strengths: certStrengths } = analyzeCertificationGaps(candidate, job)
  gaps.push(...certGaps)
  strengths.push(...certStrengths)

  const { gaps: langGaps, strengths: langStrengths } = analyzeLanguageGaps(candidate, job)
  gaps.push(...langGaps)
  strengths.push(...langStrengths)

  const { gaps: expGaps, strengths: expStrengths } = analyzeExperienceGaps(candidate, job)
  gaps.push(...expGaps)
  strengths.push(...expStrengths)

  const { gaps: eduGaps, strengths: eduStrengths } = analyzeEducationGaps(candidate, job)
  gaps.push(...eduGaps)
  strengths.push(...eduStrengths)

  // Track unknowns from matching result
  for (const unknown of matchingResult.unknown) {
    if (unknown.dimension === "technicalSkills" || unknown.dimension === "languages" || unknown.dimension === "certifications") {
      unknowns.push({
        dimension: unknown.dimension,
        reason: unknown.detail,
      })
    }
  }

  const totalGaps = gaps.length
  const criticalGaps = gaps.filter((g) => g.severity === "critical").length
  const highGaps = gaps.filter((g) => g.severity === "high").length

  const recommendations = generateRecommendations(gaps)

  const summaryParts: string[] = []
  if (totalGaps === 0) {
    summaryParts.push("No skill gaps identified")
  } else {
    if (criticalGaps > 0) summaryParts.push(`${criticalGaps} critical gap(s)`)
    if (highGaps > 0) summaryParts.push(`${highGaps} high-priority gap(s)`)
    summaryParts.push(`${totalGaps} total gap(s)`)
  }
  if (strengths.length > 0) summaryParts.push(`${strengths.length} strength(s)`)

  const summary = summaryParts.join(", ")

  return {
    jobId: job.id,
    jobTitle: job.title,
    candidateHeadline: candidate.headline,
    gaps,
    strengths,
    unknowns,
    recommendations,
    totalGaps,
    criticalGaps,
    highGaps,
    summary,
  }
}
