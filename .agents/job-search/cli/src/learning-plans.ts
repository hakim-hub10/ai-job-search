import type { CandidateProfile } from "./profile"
import type { RankedJob } from "./ranking"
import type { GapSeverity, GapType, SkillGap } from "./skillgaps"
import {
  createRequirementIdentity,
  normalizeRequirementText,
  parseLegacyRequirement,
  requirementCategoryForGapType,
  type RequirementImportance,
} from "./requirements"

export type { RequirementImportance } from "./requirements"

export interface PrioritizedSkillGap {
  /** Requirement text from SkillGap.jobRequirement, without its importance prefix. */
  skill: string
  type: GapType
  severity: GapSeverity
  importance: RequirementImportance
  priority: number
  frequencyScore: number
  impactScore: number
  canonicalKey: string
  sourceRequirements: string[]
  relatedJobs: Array<{ title: string; rank: number; score: number }>
  evidence: string[]
  reason: string
  candidateHas?: string
}

/** A deterministic result: it deliberately contains no generated timestamp. */
export interface LearningPlanResult {
  candidateHeadline: string
  targetJobCount: number
  totalGaps: number
  criticalGapCount: number
  highGapCount: number
  prioritizedGaps: PrioritizedSkillGap[]
  summary: string
}

export interface LearningPlanOptions {
  includeReasons?: boolean
  maxGaps?: number
  minImpactScore?: number
}

interface GapOccurrence {
  gap: SkillGap
  jobId: string
  jobTitle: string
  jobRank: number
  jobScore: number
}

interface GroupedGap {
  key: string
  requirement: string
  type: GapType
  importance: RequirementImportance
  severity: GapSeverity
  occurrences: GapOccurrence[]
  sourceRequirements: Set<string>
}

const SEVERITY_WEIGHTS: Record<GapSeverity, number> = { critical: 100, high: 75, medium: 50, low: 25 }
const IMPORTANCE_WEIGHTS: Record<RequirementImportance, number> = {
  required: 100,
  preferred: 75,
  optional: 75,
  useful: 75,
  unspecified: 50,
}
const SEVERITY_ORDER: Record<GapSeverity, number> = { critical: 4, high: 3, medium: 2, low: 1 }

function candidateKnownRequirements(candidate: CandidateProfile): Set<string> {
  return new Set([
    ...candidate.skills.technical,
    ...candidate.skills.soft,
    ...candidate.certifications,
    ...candidate.languages.map((language) => language.name),
    ...candidate.education.map((education) => education.degree),
  ].map(normalizeRequirementText))
}

function groupGapsByRequirement(rankedJobs: RankedJob[], candidate: CandidateProfile): Map<string, GroupedGap> {
  const knownRequirements = candidateKnownRequirements(candidate)
  const groups = new Map<string, GroupedGap>()

  for (const rankedJob of rankedJobs) {
    for (const gap of rankedJob.skillGapResult.gaps) {
      const legacy = parseLegacyRequirement(gap.jobRequirement)
      const descriptor = gap.requirement ?? {
        identity: createRequirementIdentity(requirementCategoryForGapType(gap.type), legacy.original),
        importance: legacy.importance,
      }
      const requirementKey = descriptor.identity.key
      // A stale result must not turn a profile-confirmed skill into a learning gap.
      if (!descriptor.identity.normalized || knownRequirements.has(descriptor.identity.normalized)) continue

      const key = requirementKey
      const occurrence: GapOccurrence = {
        gap,
        jobId: rankedJob.job.id,
        jobTitle: rankedJob.job.title,
        jobRank: rankedJob.rank,
        jobScore: rankedJob.score,
      }
      const existing = groups.get(key)

      if (!existing) {
        groups.set(key, {
          key,
          requirement: descriptor.identity.original,
          type: gap.type,
          importance: descriptor.importance,
          severity: gap.severity,
          occurrences: [occurrence],
          sourceRequirements: new Set([descriptor.identity.original]),
        })
        continue
      }

      existing.occurrences.push(occurrence)
      existing.sourceRequirements.add(descriptor.identity.original)
      if (SEVERITY_ORDER[gap.severity] > SEVERITY_ORDER[existing.severity]) existing.severity = gap.severity
      if (IMPORTANCE_WEIGHTS[descriptor.importance] > IMPORTANCE_WEIGHTS[existing.importance]) existing.importance = descriptor.importance
    }
  }

  return groups
}

function distinctOccurrences(occurrences: GapOccurrence[]): GapOccurrence[] {
  const byJob = new Map<string, GapOccurrence>()
  for (const occurrence of occurrences) {
    const previous = byJob.get(occurrence.jobId)
    if (!previous || occurrence.jobRank < previous.jobRank) byJob.set(occurrence.jobId, occurrence)
  }
  return [...byJob.values()].sort((a, b) =>
    a.jobRank - b.jobRank || a.jobId.localeCompare(b.jobId) || a.jobTitle.localeCompare(b.jobTitle),
  )
}

function calculateFrequencyScore(affectedJobs: number, totalJobs: number): number {
  return totalJobs === 0 ? 0 : (affectedJobs / totalJobs) * 100
}

function calculateImpactScore(occurrences: GapOccurrence[], totalRankedJobs: number): number {
  if (occurrences.length === 0 || totalRankedJobs === 0) return 0
  const weightedImpact = occurrences.reduce((total, occurrence) => {
    const positionWeight = (totalRankedJobs - Math.min(Math.max(occurrence.jobRank, 1), totalRankedJobs) + 1) / totalRankedJobs
    return total + positionWeight * (Math.min(Math.max(occurrence.jobScore, 0), 100) / 100)
  }, 0)
  return (weightedImpact / occurrences.length) * 100
}

function describePriority(
  group: Pick<GroupedGap, "severity" | "importance"> & { occurrences: GapOccurrence[] },
  frequencyScore: number,
  impactScore: number,
): string {
  const parts = [`${group.severity} severity`, `${group.importance} importance`]
  if (group.occurrences.length > 1) parts.push(`appears in ${group.occurrences.length} target jobs (${Math.round(frequencyScore)}%)`)
  if (impactScore > 0) parts.push(`affects ranked jobs (impact ${Math.round(impactScore)}%)`)
  return parts.join(" • ")
}

/**
 * Prioritizes confirmed SkillGap records only. Composite score: severity 40%,
 * explicit requirement importance 20%, distinct-job frequency 25%, and ranked
 * job impact 15%. Unknown evidence is never read as a learning gap.
 */
export function generateLearningPlan(
  rankedJobs: RankedJob[],
  candidate: CandidateProfile,
  options: LearningPlanOptions = {},
): LearningPlanResult {
  const { includeReasons = true, maxGaps, minImpactScore = 0 } = options
  const scored = [...groupGapsByRequirement(rankedJobs, candidate).values()].map((group) => {
    const occurrences = distinctOccurrences(group.occurrences)
    const sourceRequirements = [...group.sourceRequirements].sort((a, b) =>
      normalizeRequirementText(a).localeCompare(normalizeRequirementText(b)) || a.localeCompare(b),
    )
    const frequencyScore = calculateFrequencyScore(occurrences.length, rankedJobs.length)
    const impactScore = calculateImpactScore(occurrences, rankedJobs.length)
    const priorityScore =
      SEVERITY_WEIGHTS[group.severity] * 0.4 +
      IMPORTANCE_WEIGHTS[group.importance] * 0.2 +
      frequencyScore * 0.25 +
      impactScore * 0.15
    return { ...group, requirement: sourceRequirements[0] ?? group.requirement, sourceRequirements, occurrences, frequencyScore, impactScore, priorityScore }
  })

  const limited = scored
    .filter((group) => group.impactScore >= minImpactScore)
    .sort((a, b) => b.priorityScore - a.priorityScore || a.key.localeCompare(b.key))
    .slice(0, maxGaps && maxGaps > 0 ? maxGaps : undefined)

  const prioritizedGaps = limited.map((group, index): PrioritizedSkillGap => ({
    skill: group.requirement,
    type: group.type,
    severity: group.severity,
    importance: group.importance,
    priority: index + 1,
    frequencyScore: Math.round(group.frequencyScore),
    impactScore: Math.round(group.impactScore),
    canonicalKey: group.key,
    sourceRequirements: group.sourceRequirements,
    relatedJobs: group.occurrences.map((occurrence) => ({ title: occurrence.jobTitle, rank: occurrence.jobRank, score: occurrence.jobScore })),
    evidence: [...new Set(group.occurrences.map((occurrence) => occurrence.gap.evidence).filter(Boolean))].sort(),
    reason: includeReasons ? describePriority(group, group.frequencyScore, group.impactScore) : "",
    candidateHas: group.occurrences.find((occurrence) => occurrence.gap.candidateHas)?.gap.candidateHas,
  }))

  const criticalGapCount = prioritizedGaps.filter((gap) => gap.severity === "critical").length
  const highGapCount = prioritizedGaps.filter((gap) => gap.severity === "high").length

  return {
    candidateHeadline: candidate.headline,
    targetJobCount: rankedJobs.length,
    totalGaps: prioritizedGaps.length,
    criticalGapCount,
    highGapCount,
    prioritizedGaps,
    summary: prioritizedGaps.length === 0
      ? "No confirmed skill gaps identified across target jobs."
      : `${prioritizedGaps.length} confirmed skill gap(s) prioritized across ${rankedJobs.length} target job(s).`,
  }
}

export function formatLearningPlan(result: LearningPlanResult): string {
  const lines = [
    `Learning Plan for: ${result.candidateHeadline}`,
    `Target Jobs: ${result.targetJobCount}`,
    `Confirmed Skill Gaps: ${result.totalGaps}`,
    "",
    result.summary,
  ]
  for (const gap of result.prioritizedGaps) {
    lines.push("", `Priority ${gap.priority}: ${gap.skill}`)
    lines.push(`  Type: ${gap.type} | Severity: ${gap.severity} | Importance: ${gap.importance}`)
    lines.push(`  Frequency: ${gap.frequencyScore}% | Impact: ${gap.impactScore}%`)
    if (gap.reason) lines.push(`  Reason: ${gap.reason}`)
  }
  return lines.join("\n")
}

export function getLearningPlanSummary(result: LearningPlanResult): {
  totalGaps: number
  criticalGaps: number
  highGaps: number
  mediumGaps: number
  lowGaps: number
  averageFrequency: number
  averageImpact: number
} {
  const gaps = result.prioritizedGaps
  const average = (field: "frequencyScore" | "impactScore") =>
    gaps.length === 0 ? 0 : Math.round(gaps.reduce((total, gap) => total + gap[field], 0) / gaps.length)
  return {
    totalGaps: result.totalGaps,
    criticalGaps: result.criticalGapCount,
    highGaps: result.highGapCount,
    mediumGaps: gaps.filter((gap) => gap.severity === "medium").length,
    lowGaps: gaps.filter((gap) => gap.severity === "low").length,
    averageFrequency: average("frequencyScore"),
    averageImpact: average("impactScore"),
  }
}
