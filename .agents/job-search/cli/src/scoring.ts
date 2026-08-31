import type { MatchingResult, MatchDimension, RequirementCoverage } from "./matching"

/**
 * Weighting system for match dimensions.
 * Weights represent the importance/impact of each dimension on the overall score.
 * Higher weights mean the dimension has a bigger impact on the final score.
 *
 * Design rationale:
 * - targetRole (2.0): Fundamental — is this the role the candidate wants?
 * - technicalSkills (2.0): Core capability — can candidate do the job?
 * - yearsOfExperience (1.5): Capability level — is candidate at the right level?
 * - location (1.5): Practical constraint — can candidate get to/work from the location?
 * - remotePreference (1.5): Practical constraint — work mode alignment
 * - employmentType (1.0): Negotiable — type of engagement (full-time vs contract, etc.)
 * - softSkills (1.0): Cultural/team fit
 * - languages (1.0): Communication capability
 * - certifications (0.5): Nice-to-have credential
 * - preferredIndustries (0.5): Career path alignment (lower priority)
 *
 * Total weight: 12.5
 */
const DIMENSION_WEIGHTS: Record<MatchDimension, number> = {
  targetRole: 2.0,
  technicalSkills: 2.0,
  yearsOfExperience: 1.5,
  location: 1.5,
  remotePreference: 1.5,
  employmentType: 1.0,
  softSkills: 1.0,
  languages: 1.0,
  certifications: 0.5,
  preferredIndustries: 0.5,
}

export type ConfidenceLabel = "high" | "medium" | "low"

export interface ScoreDimensionBreakdown {
  dimension: MatchDimension
  weight: number
  status: "matched" | "missing" | "conflicting" | "unknown"
  pointsAchieved: number
  pointsPossible: number
  evidence: string
  requirementCoverage?: RequirementCoverage
}

export interface ScoreBreakdown {
  totalDimensions: number
  knownDimensions: number
  unknownDimensions: number
  totalPoints: number
  pointsAchieved: number
  dimensions: ScoreDimensionBreakdown[]
}

export interface ScoringResult {
  jobId: string
  jobTitle: string
  score: number // 0-100
  /** Weighted coverage of dimensions with available job evidence (0-1). */
  confidence: number
  confidenceLabel: ConfidenceLabel
  summary: string
  breakdown: ScoreBreakdown
  matched: Array<{ dimension: MatchDimension; detail: string }>
  missing: Array<{ dimension: MatchDimension; detail: string }>
  conflicting: Array<{ dimension: MatchDimension; detail: string }>
  unknown: Array<{ dimension: MatchDimension; detail: string }>
}

function getConfidenceLabel(confidence: number): ConfidenceLabel {
  if (confidence >= 0.8) return "high"
  if (confidence >= 0.5) return "medium"
  return "low"
}

/**
 * Score a matching result into a 0-100 scale.
 *
 * Algorithm:
 * 1. For each dimension, assign a weight based on importance
 * 2. Calculate points for each dimension:
 *    - matched: +full weight
 *    - missing: -0.5 * weight (partial impact)
 *    - conflicting: -1.0 * weight (full negative impact)
 *    - unknown: 0 (excluded from scoring)
 * 3. Only dimensions with known status contribute to total possible points
 * 4. Score = (points achieved / total possible points) * 100
 * 5. Clamp score to 0-100 range
 *
 * This ensures:
 * - Unknown information doesn't penalize the score
 * - Matched dimensions increase the score
 * - Missing dimensions reduce the score (but less than conflicts)
 * - Conflicting dimensions significantly reduce the score
 */
export function scoreMatch(matchingResult: MatchingResult): ScoringResult {
  const breakdown: ScoreBreakdown = {
    totalDimensions: 10, // Total number of possible dimensions
    knownDimensions: 0,
    unknownDimensions: 0,
    totalPoints: 0,
    pointsAchieved: 0,
    dimensions: [],
  }

  // Process each dimension's evidence
  const allEvidence = [...matchingResult.matched, ...matchingResult.missing, ...matchingResult.conflicting, ...matchingResult.unknown]

  // Track which dimensions we've already processed
  const processedDimensions = new Set<MatchDimension>()

  for (const evidence of allEvidence) {
    if (processedDimensions.has(evidence.dimension)) continue
    processedDimensions.add(evidence.dimension)

    const weight = DIMENSION_WEIGHTS[evidence.dimension]
    let pointsAchieved = 0
    let pointsPossible = weight

    // Calculate points based on status
    if (evidence.status === "matched") {
      pointsAchieved = weight
    } else if (evidence.status === "missing") {
      const coverage = evidence.requirementCoverage?.coverageRatio
      if (evidence.dimension === "technicalSkills" && coverage !== undefined && coverage > 0 && coverage < 1) {
        // Preserve the existing missing/full-match endpoints while scaling known partial coverage.
        pointsAchieved = weight * (1.5 * coverage - 0.5)
      } else {
        pointsAchieved = -0.5 * weight // No known requirement match
      }
    } else if (evidence.status === "conflicting") {
      pointsAchieved = -1.0 * weight // Full penalty
    } else if (evidence.status === "unknown") {
      // Unknown dimensions don't contribute to total possible points
      pointsPossible = 0
      pointsAchieved = 0
    }

    breakdown.dimensions.push({
      dimension: evidence.dimension,
      weight,
      status: evidence.status,
      pointsAchieved,
      pointsPossible,
      evidence: evidence.detail,
      requirementCoverage: evidence.requirementCoverage,
    })

    // Only count towards totals if known
    if (evidence.status !== "unknown") {
      breakdown.knownDimensions++
      breakdown.totalPoints += pointsPossible
      breakdown.pointsAchieved += pointsAchieved
    } else {
      breakdown.unknownDimensions++
    }
  }

  // Calculate final score
  let score = 0
  if (breakdown.totalPoints > 0) {
    score = Math.max(0, (breakdown.pointsAchieved / breakdown.totalPoints) * 100)
  }

  // Clamp to 0-100
  score = Math.min(100, Math.max(0, score))

  const totalWeight = Object.values(DIMENSION_WEIGHTS).reduce((total, weight) => total + weight, 0)
  const confidence = totalWeight === 0 ? 0 : breakdown.totalPoints / totalWeight
  const confidenceLabel = getConfidenceLabel(confidence)

  // Generate summary
  const summaryParts: string[] = []
  if (matchingResult.totalMatched > 0) {
    summaryParts.push(`${matchingResult.totalMatched} matched`)
  }
  if (matchingResult.totalMissing > 0) {
    summaryParts.push(`${matchingResult.totalMissing} missing`)
  }
  if (matchingResult.totalConflicting > 0) {
    summaryParts.push(`${matchingResult.totalConflicting} conflicting`)
  }
  if (matchingResult.totalUnknown > 0) {
    summaryParts.push(`${matchingResult.totalUnknown} unknown`)
  }

  const summary = `Match Score: ${Math.round(score)}% (${summaryParts.join(", ")}) • Evidence coverage: ${Math.round(confidence * 100)}% (${confidenceLabel})`

  return {
    jobId: matchingResult.jobId,
    jobTitle: matchingResult.jobTitle,
    score: Math.round(score),
    confidence,
    confidenceLabel,
    summary,
    breakdown,
    matched: matchingResult.matched.map((e) => ({ dimension: e.dimension, detail: e.detail })),
    missing: matchingResult.missing.map((e) => ({ dimension: e.dimension, detail: e.detail })),
    conflicting: matchingResult.conflicting.map((e) => ({ dimension: e.dimension, detail: e.detail })),
    unknown: matchingResult.unknown.map((e) => ({ dimension: e.dimension, detail: e.detail })),
  }
}

/**
 * Get the weighting system (exported for testing and transparency)
 */
export function getDimensionWeights(): Record<MatchDimension, number> {
  return { ...DIMENSION_WEIGHTS }
}

/**
 * Generate a detailed breakdown string for display/logging
 */
export function describeScoreBreakdown(result: ScoringResult): string {
  const lines: string[] = []

  lines.push(`\n=== SCORING BREAKDOWN: ${result.jobTitle} ===`)
  lines.push(`Final Score: ${result.score}/100\n`)
  lines.push(`Evidence Coverage: ${Math.round(result.confidence * 100)}% (${result.confidenceLabel})`)
  lines.push()

  lines.push(`KNOWN DIMENSIONS (${result.breakdown.knownDimensions}/${result.breakdown.totalDimensions}):`)
  lines.push(`Total possible points: ${result.breakdown.totalPoints.toFixed(1)}`)
  lines.push(`Points achieved: ${result.breakdown.pointsAchieved.toFixed(2)}`)
  lines.push()

  lines.push("DIMENSION BREAKDOWN:")
  for (const dim of result.breakdown.dimensions) {
    const status = dim.status.toUpperCase()
    const icon =
      dim.status === "matched" ? "✓" : dim.status === "missing" ? "✗" : dim.status === "conflicting" ? "⚠" : "?"
    const points = dim.pointsAchieved >= 0 ? `+${dim.pointsAchieved.toFixed(2)}` : `${dim.pointsAchieved.toFixed(2)}`
    const pointDisplay = dim.status === "unknown" ? "(excluded)" : `${points}/${dim.pointsPossible.toFixed(1)}`

    lines.push(`  ${icon} ${dim.dimension.padEnd(20)} [${status.padEnd(11)}] ${pointDisplay}`)
    lines.push(`      ${dim.evidence}`)
    if (dim.requirementCoverage) {
      const { matchedRequirements, missingRequirements } = dim.requirementCoverage
      lines.push(`      Requirements: ${matchedRequirements.length}/${matchedRequirements.length + missingRequirements.length} satisfied; ${missingRequirements.length} missing`)
    }
  }

  lines.push()
  return lines.join("\n")
}
