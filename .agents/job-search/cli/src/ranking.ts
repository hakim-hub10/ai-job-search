import type { CandidateProfile } from "./profile"
import type { NormalizedJob } from "./types"
import type { MatchingResult } from "./matching"
import type { ScoringResult } from "./scoring"
import type { SkillGapResult } from "./skillgaps"

export interface RankedJob {
  rank: number
  job: NormalizedJob
  score: number
  matchingResult: MatchingResult
  scoringBreakdown: ScoringResult
  skillGapResult: SkillGapResult
  explanation: string
}

export interface RankingOptions {
  minScore?: number // Filter out jobs below this score (0-100)
  includeExplanation?: boolean // Generate detailed explanation (default: true)
}

export interface RankingInput {
  job: NormalizedJob
  matchingResult: MatchingResult
  scoringResult: ScoringResult
  skillGapResult: SkillGapResult
}

/**
 * Calculates a numeric tie-breaker score for equal match scores.
 * Lower values = better (to maintain descending order).
 * 
 * Prioritizes:
 * 1. Fewer critical gaps
 * 2. Fewer high-severity gaps
 * 3. Fewer total gaps
 * 4. Fewer conflicting requirements
 * 5. More matched dimensions
 * 6. Fewer missing dimensions
 */
function calculateTieBreakerScore(
  skillGapResult: SkillGapResult,
  matchingResult: MatchingResult
): number {
  // Weight gaps heavily - critical gaps are biggest differentiator
  const criticalGapPenalty = skillGapResult.criticalGaps * 1000
  const highGapPenalty = skillGapResult.highGaps * 100
  const totalGapPenalty = skillGapResult.totalGaps * 10

  // Weight conflicts - they're harder to fix than gaps
  const conflictPenalty = matchingResult.conflicting.length * 5

  // Fewer misses is better than unknowns (unknowns might resolve favorably)
  const missingPenalty = matchingResult.missing.length * 2

  // More matches is good (but normalized by total possible)
  const matchBonus = -matchingResult.matched.length * 1

  // Calculate final tie-breaker (lower is better for ranking)
  return criticalGapPenalty + highGapPenalty + totalGapPenalty + conflictPenalty + missingPenalty + matchBonus
}

/**
 * Generate a human-readable explanation of why a job is ranked at a particular position
 */
function generateRankingExplanation(rankedJob: RankedJob, allRankedJobs: RankedJob[]): string {
  const parts: string[] = []

  // Overall score assessment
  if (rankedJob.score >= 80) {
    parts.push("Strong overall match")
  } else if (rankedJob.score >= 60) {
    parts.push("Moderate match with addressable gaps")
  } else if (rankedJob.score >= 40) {
    parts.push("Fair match but notable gaps")
  } else {
    parts.push("Weak match - significant work needed")
  }

  parts.push(`Evidence coverage ${Math.round(rankedJob.scoringBreakdown.confidence * 100)}% (${rankedJob.scoringBreakdown.confidenceLabel})`)

  // Score drivers
  const matched = rankedJob.matchingResult.matched.length
  if (matched > 0) {
    parts.push(`Strong match on ${matched} dimension(s)`)
  }

  const conflicting = rankedJob.matchingResult.conflicting.length
  if (conflicting > 0) {
    parts.push(`${conflicting} conflicting requirement(s)`)
  }

  // Gap information
  if (rankedJob.skillGapResult.totalGaps === 0) {
    parts.push("No skill gaps identified")
  } else if (rankedJob.skillGapResult.criticalGaps > 0) {
    parts.push(
      `${rankedJob.skillGapResult.criticalGaps} critical gap(s) requiring intensive focus`
    )
  } else if (rankedJob.skillGapResult.highGaps > 0) {
    parts.push(`${rankedJob.skillGapResult.highGaps} high-priority gaps to address`)
  }

  // Position vs others
  const jobsWithSameScore = allRankedJobs.filter((j) => j.score === rankedJob.score)
  if (jobsWithSameScore.length > 1) {
    const tiePosition = jobsWithSameScore.indexOf(rankedJob)
    if (tiePosition > 0) {
      parts.push(`Ranked ${tiePosition + 1} among ${jobsWithSameScore.length} jobs with score ${rankedJob.score}`)
    }
  }

  return parts.join(" • ")
}

/**
 * Rank jobs by match score, with deterministic tie-breaking
 * 
 * Primary ranking: by score (descending, 100 = best)
 * Tie-breaking (for equal scores):
 *   1. Higher evidence confidence
 *   2. Fewer critical skill gaps
 *   3. Fewer high-severity gaps
 *   4. Fewer total gaps
 *   5. Fewer conflicting requirements
 *   6. More matched dimensions
 *   7. Original order (stable)
 * 
 * @param inputs Array of RankingInput (job + analysis results)
 * @param candidate Candidate profile (for context)
 * @param options Ranking options (minScore, includeExplanation)
 * @returns Ranked jobs with rank numbers and explanations
 */
export function rankJobs(
  inputs: RankingInput[],
  candidate: CandidateProfile,
  options?: RankingOptions
): RankedJob[] {
  const minScore = options?.minScore ?? 0
  const includeExplanation = options?.includeExplanation !== false

  // Create RankedJob entries with tie-breaker scores
  const rankedWithTieBreaker = inputs.map((input, originalIndex) => {
    const tieBreaker = calculateTieBreakerScore(input.skillGapResult, input.matchingResult)

    return {
      job: input.job,
      matchingResult: input.matchingResult,
      scoringBreakdown: input.scoringResult,
      skillGapResult: input.skillGapResult,
      score: input.scoringResult.score,
      tieBreaker,
      originalIndex, // For stable sort
    }
  })

  // Sort: primary by score (desc), tie-break by tieBreaker (asc), then by original order
  const sorted = rankedWithTieBreaker.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score // Higher score first
    }
    if (a.scoringBreakdown.confidence !== b.scoringBreakdown.confidence) {
      return b.scoringBreakdown.confidence - a.scoringBreakdown.confidence
    }
    if (a.tieBreaker !== b.tieBreaker) {
      return a.tieBreaker - b.tieBreaker // Lower tie-breaker first
    }
    return a.originalIndex - b.originalIndex // Original order for stability
  })

  // Filter by minScore and apply rank numbers
  const filtered = sorted
    .filter((item) => item.score >= minScore)
    .map((item, rankIndex) => {
      const rankedJob: RankedJob = {
        rank: rankIndex + 1,
        job: item.job,
        score: item.score,
        matchingResult: item.matchingResult,
        scoringBreakdown: item.scoringBreakdown,
        skillGapResult: item.skillGapResult,
        explanation: "", // Will be populated below
      }

      if (includeExplanation) {
        // Generate explanations after all filtering/ranking is done
        rankedJob.explanation = ""
      }

      return rankedJob
    })

  // Now generate explanations with full context
  if (includeExplanation) {
    for (const rankedJob of filtered) {
      rankedJob.explanation = generateRankingExplanation(rankedJob, filtered)
    }
  }

  return filtered
}

/**
 * Get a summary of ranking results
 */
export function getRankingSummary(rankedJobs: RankedJob[]): {
  totalJobs: number
  topScores: number[]
  averageScore: number
  bestMatch: RankedJob | null
  worstMatch: RankedJob | null
} {
  if (rankedJobs.length === 0) {
    return {
      totalJobs: 0,
      topScores: [],
      averageScore: 0,
      bestMatch: null,
      worstMatch: null,
    }
  }

  const scores = rankedJobs.map((j) => j.score)
  const topScores = [...new Set(scores)].sort((a, b) => b - a).slice(0, 5)
  const averageScore = scores.reduce((a, b) => a + b, 0) / scores.length

  return {
    totalJobs: rankedJobs.length,
    topScores,
    averageScore: Math.round(averageScore * 10) / 10,
    bestMatch: rankedJobs[0] || null,
    worstMatch: rankedJobs[rankedJobs.length - 1] || null,
  }
}

/**
 * Format a ranked job for display
 */
export function formatRankedJob(ranked: RankedJob): string {
  return [
    `Rank #${ranked.rank}: ${ranked.job.title}`,
    `Company: ${ranked.job.company}`,
    `Score: ${ranked.score}/100`,
    `Gaps: ${ranked.skillGapResult.totalGaps} (${ranked.skillGapResult.criticalGaps} critical)`,
    `Reasoning: ${ranked.explanation}`,
  ].join("\n")
}
