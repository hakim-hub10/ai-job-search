import type { CandidateProfile } from "./profile"
import type { NormalizedJob } from "./types"
import type { MatchingResult } from "./matching"
import {
  createRequirementDescriptor,
  type RequirementDescriptor,
} from "./requirements"

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

/**
 * Fuzzy match helper - reused from matching
 */
function fuzzyMatch(str1: string | null, str2: string | null): boolean {
  if (!str1 || !str2) return false
  const s1 = str1.toLowerCase().trim()
  const s2 = str2.toLowerCase().trim()
  return s1 === s2 || s1.includes(s2) || s2.includes(s1)
}

/**
 * Find overlap between two skill lists (case-insensitive)
 */
function skillsOverlap(candidateSkills: string[], jobSkills: string[]): string[] {
  if (jobSkills.length === 0) return []
  return candidateSkills.filter((cSkill) => jobSkills.some((jSkill) => fuzzyMatch(cSkill, jSkill)))
}

/**
 * Analyze technical skill gaps
 */
function analyzeTechnicalSkillGaps(candidate: CandidateProfile, job: NormalizedJob, matchingResult: MatchingResult): { gaps: SkillGap[]; strengths: SkillStrength[] } {
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
    ?? jobSkills.filter((jobSkill) => candidateTechSkills.some((candidateSkill) => fuzzyMatch(candidateSkill, jobSkill)))
  const missingJobSkills = requirementCoverage?.missingRequirements
    ?? jobSkills.filter((jobSkill) => !matchedJobSkills.includes(jobSkill))

  // Find matched skills (strengths)
  for (const jobSkill of matchedJobSkills) {
    const candidateSkill = candidateTechSkills.find((skill) => fuzzyMatch(skill, jobSkill)) ?? jobSkill
    strengths.push({
      title: candidateSkill,
      description: `Candidate has experience with ${candidateSkill}`,
      relevance: `Required by the job`,
      evidence: `Found in job requirements: ${jobSkill}`,
    })
  }

  for (const skill of missingJobSkills) {
    gaps.push({
      type: "missing_skill",
      title: `Missing: ${skill}`,
      description: `Candidate does not have the required skill: ${skill}`,
      jobRequirement: `Required: ${skill}`,
      severity: determineSkillSeverity(skill, jobSkills.length),
      evidence: `Job explicitly lists: ${skill}`,
      requirement: createRequirementDescriptor("skill", skill, "required"),
    })
  }

  return { gaps, strengths }
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

  const description = job.description.toLowerCase()
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
    const jobRequiresSoftSkill = keywords.some((kw) => description.includes(kw.toLowerCase()))

    if (jobRequiresSoftSkill) {
      if (hasSoftSkill) {
        strengths.push({
          title: skill,
          description: `Candidate demonstrates ${skill}`,
          relevance: `Job explicitly values ${skill}`,
          evidence: `Job description mentions: ${keywords.filter((kw) => description.includes(kw)).join(", ")}`,
        })
      } else {
        gaps.push({
          type: "missing_skill",
          title: `Soft skill gap: ${skill}`,
          description: `Job emphasizes ${skill}, which is not listed in candidate's profile`,
          jobRequirement: `Job requires: ${skill}`,
          severity: "medium",
          evidence: `Job description emphasizes: ${keywords.filter((kw) => description.includes(kw)).join(", ")}`,
          requirement: createRequirementDescriptor("skill", skill, "required"),
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

  // Look for common certification names in job description
  const commonCertifications = ["AWS", "Azure", "GCP", "Kubernetes", "Docker", "CISPA", "Security+", "PMP", "CAPM", "CPA", "CFA"]

  for (const cert of commonCertifications) {
    if (description.includes(cert.toLowerCase())) {
      // Job mentions this certification - check if candidate has it
      const candidateHasCert = candidate.certifications.some((c) => c.toLowerCase().includes(cert.toLowerCase()))

      if (candidateHasCert) {
        const actualCert = candidate.certifications.find((c) => c.toLowerCase().includes(cert.toLowerCase()))
        strengths.push({
          title: actualCert || cert,
          description: `Candidate holds: ${actualCert || cert}`,
          relevance: `Required or valued by the job`,
          evidence: `Job mentions: ${cert}`,
        })
      } else {
        gaps.push({
          type: "missing_certification",
          title: `Missing: ${cert} certification`,
          description: `Job mentions ${cert} certification, which candidate does not have`,
          jobRequirement: `Mentions: ${cert}`,
          severity: "medium",
          evidence: `Found in job description`,
          requirement: createRequirementDescriptor("certification", cert),
        })
      }
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

  const description = (job.description ?? "").toLowerCase()
  const title = (job.title ?? "").toLowerCase()
  const fullText = `${description} ${title}`.toLowerCase()

  const candidateLanguages = candidate.languages
  const candidateLanguageNames = candidateLanguages.map((l) => l.name.toLowerCase())

  // Look for language requirements
  const languageTests: Record<string, string[]> = {
    English: ["english", "engelska", "fluent english"],
    Swedish: ["swedish", "svenska", "fluent swedish"],
    German: ["german", "deutsch"],
    French: ["french", "français"],
    Spanish: ["spanish", "español"],
  }

  for (const [language, keywords] of Object.entries(languageTests)) {
    const jobRequiresLanguage = keywords.some((kw) => fullText.includes(kw))

    if (jobRequiresLanguage) {
      const candidateHasLanguage = candidateLanguageNames.some((l) => l.includes(language.toLowerCase()))

      if (candidateHasLanguage) {
        const lang = candidateLanguages.find((l) => l.name.toLowerCase().includes(language.toLowerCase()))
        strengths.push({
          title: language,
          description: `Candidate speaks ${language} (${lang?.level || "unknown level"})`,
          relevance: `Required by the job`,
          evidence: `Job requires: ${language}`,
        })
      } else {
        gaps.push({
          type: "missing_language",
          title: `Missing: ${language}`,
          description: `Job requires ${language} language skills, candidate does not list them`,
          jobRequirement: `Required: ${language}`,
          severity: "high",
          evidence: `Job description mentions: ${keywords.filter((kw) => fullText.includes(kw)).join(", ")}`,
          requirement: createRequirementDescriptor("language", language, "required"),
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

  const description = job.description.toLowerCase()

  // Check for degree requirements
  const degreeTests: Record<string, string[]> = {
    Bachelor: ["bachelor", "ba ", "bsc", "b.s."],
    Master: ["master", "ma ", "msc", "m.s.", "graduate degree"],
    PhD: ["phd", "doctorate", "ph.d"],
  }

  for (const [degree, keywords] of Object.entries(degreeTests)) {
    const jobRequiresDegree = keywords.some((kw) => description.includes(kw))

    if (jobRequiresDegree) {
      const candidateHasDegree = candidate.education.some((e) => e.degree.toLowerCase().includes(degree.toLowerCase()))

      if (candidateHasDegree) {
        strengths.push({
          title: `${degree} degree`,
          description: `Candidate holds ${degree} degree in ${candidate.education.find((e) => e.degree.toLowerCase().includes(degree.toLowerCase()))?.field}`,
          relevance: `Satisfies job education requirement`,
          evidence: `Job requires: ${degree}`,
        })
      } else {
        gaps.push({
          type: "education_gap",
          title: `Missing: ${degree} degree`,
          description: `Job requires ${degree} degree, candidate does not list one`,
          jobRequirement: `Requires: ${degree}`,
          severity: "medium",
          evidence: `Job mentions: ${keywords.filter((kw) => description.includes(kw)).join(", ")}`,
          requirement: createRequirementDescriptor("education", degree, "required"),
        })
      }
    }
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
export function analyzeSkillGaps(candidate: CandidateProfile, job: NormalizedJob, matchingResult: MatchingResult): SkillGapResult {
  const gaps: SkillGap[] = []
  const strengths: SkillStrength[] = []
  const unknowns: SkillUnknown[] = []

  // Analyze each category
  const { gaps: techGaps, strengths: techStrengths } = analyzeTechnicalSkillGaps(candidate, job, matchingResult)
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
