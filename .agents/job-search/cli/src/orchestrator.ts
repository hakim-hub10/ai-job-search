import { generateLearningPlan, type LearningPlanOptions, type LearningPlanResult } from "./learning-plans"
import { matchProfile } from "./matching"
import type { CandidateProfile } from "./profile"
import { rankJobs, type RankedJob, type RankingInput, type RankingOptions } from "./ranking"
import { scoreMatch } from "./scoring"
import { analyzeSkillGaps } from "./skillgaps"
import type { NormalizedJob } from "./types"
import { selectSearchRelevantJobs, type SearchRelevanceSelection } from "./search-relevance"

export interface CareerAnalysisOptions {
  ranking?: RankingOptions
  learningPlan?: LearningPlanOptions
}

export interface CareerAnalysisResult {
  inputJobCount: number
  rankedJobs: RankedJob[]
  learningPlan: LearningPlanResult
}

export interface SearchAwareCareerAnalysisResult {
  relevance: SearchRelevanceSelection
  analysis: CareerAnalysisResult
}

/**
 * Composes the existing deterministic career-analysis engines for already
 * normalized jobs. Search, source adapters, and business rules remain outside
 * this orchestration boundary.
 */
export function analyzeJobs(
  candidate: CandidateProfile,
  jobs: NormalizedJob[],
  options: CareerAnalysisOptions = {},
): CareerAnalysisResult {
  const inputs: RankingInput[] = jobs.map((job) => {
    const matchingResult = matchProfile(candidate, job)
    return {
      job,
      matchingResult,
      scoringResult: scoreMatch(matchingResult),
      skillGapResult: analyzeSkillGaps(candidate, job, matchingResult),
    }
  })
  const rankedJobs = rankJobs(inputs, candidate, options.ranking)
  const learningPlan = generateLearningPlan(rankedJobs, candidate, options.learningPlan)

  return { inputJobCount: jobs.length, rankedJobs, learningPlan }
}

/** Applies role relevance before delegating eligible jobs to the unchanged analysis pipeline. */
export function analyzeSearchResults(
  candidate: CandidateProfile,
  jobs: readonly NormalizedJob[],
  query: string,
  options: CareerAnalysisOptions = {},
): SearchAwareCareerAnalysisResult {
  const relevance = selectSearchRelevantJobs(jobs, { query, targetRoles: candidate.targetRoles })
  return { relevance, analysis: analyzeJobs(candidate, relevance.eligibleJobs, options) }
}
