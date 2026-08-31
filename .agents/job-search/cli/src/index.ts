export type { NormalizedJob, JobSourceAdapter, UnifiedSearchOptions, SourceSearchResult, SourceStatusEntry, UnifiedSearchResponse } from "./types"
export { searchJobs } from "./engine"
export { dedupeJobs } from "./dedupe"
export { normalizeJob } from "./utils"
export { registerBuiltInSourceAdapters } from "./adapters"
export {
  analyzeJobs,
  type CareerAnalysisOptions,
  type CareerAnalysisResult,
} from "./orchestrator"
export {
  createRequirementDescriptor,
  createRequirementIdentity,
  normalizeRequirementText,
  parseLegacyRequirement,
  requirementCategoryForGapType,
  type RequirementCategory,
  type RequirementDescriptor,
  type RequirementIdentity,
  type RequirementImportance,
} from "./requirements"
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
  type RequirementCoverage,
} from "./matching"
export {
  scoreMatch,
  getDimensionWeights,
  describeScoreBreakdown,
  type ScoringResult,
  type ScoreBreakdown,
  type ScoreDimensionBreakdown,
  type ConfidenceLabel,
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
} from "./learning-plans"
