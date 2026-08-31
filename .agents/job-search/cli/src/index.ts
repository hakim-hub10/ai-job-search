export type { NormalizedJob, JobSourceAdapter, UnifiedSearchOptions, SourceSearchResult, SourceStatusEntry, UnifiedSearchResponse } from "./types"
export { searchJobs } from "./engine"
export { dedupeJobs } from "./dedupe"
export { normalizeJob } from "./utils"
export { registerBuiltInSourceAdapters } from "./adapters"
export {
  createDefaultCandidateProfile,
  normalizeCandidateProfile,
  type CandidateProfile,
  type WorkMode,
  type EmploymentType,
} from "./profile"
export {
  matchProfile,
  type MatchingResult,
  type MatchEvidence,
  type MatchDimension,
} from "./matching"
export {
  scoreMatch,
  getDimensionWeights,
  describeScoreBreakdown,
  type ScoringResult,
  type ScoreBreakdown,
  type ScoreDimensionBreakdown,
} from "./scoring"
export {
  analyzeSkillGaps,
  type SkillGapResult,
  type SkillGap,
  type SkillStrength,
  type SkillUnknown,
  type SkillGapRecommendation,
  type GapType,
  type GapSeverity,
} from "./skillgaps"
export {
  rankJobs,
  getRankingSummary,
  formatRankedJob,
  type RankedJob,
  type RankingInput,
  type RankingOptions,
} from "./ranking"
export {
  generateLearningPlan,
  formatLearningPlan,
  getLearningPlanSummary,
  type LearningPlanResult,
  type LearningPlanOptions,
  type PrioritizedSkillGap,
  type RequirementImportance,
} from "./learning-plans"
