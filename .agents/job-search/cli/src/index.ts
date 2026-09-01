export type { NormalizedJob, JobSourceAdapter, UnifiedSearchOptions, SourceSearchResult, SourceStatusEntry, UnifiedSearchResponse } from "./types"
export { searchJobs } from "./engine"
export { dedupeJobs } from "./dedupe"
export { normalizeJob } from "./utils"
export {
  registerBuiltInSourceAdapters,
  getBuiltInSourceDefinitions,
  resolveBuiltInSourceAdapters,
  SourceSelectionError,
  type BuiltInSourceDefinition,
} from "./adapters"
export {
  analyzeJobs,
  type CareerAnalysisOptions,
  type CareerAnalysisResult,
} from "./orchestrator"
export {
  createApplication,
  updateApplicationStatus,
  addApplicationNote,
  findDuplicateApplications,
  type ApplicationStatus,
  type ApplicationStatusEvent,
  type ApplicationNote,
  type ApplicationAnalysisSnapshot,
  type ApplicationRecord,
  type CreateApplicationInput,
  type UpdateApplicationStatusInput,
  type AddApplicationNoteInput,
  type ApplicationDomainErrorCode,
  type ApplicationDomainError,
  type ApplicationResult,
  type ApplicationDuplicateReason,
  type ApplicationDuplicateMatch,
} from "./applications"
export {
  createFileApplicationRepository,
} from "./application-file-repository"
export type {
  ApplicationRepository,
  ApplicationRepositoryErrorCode,
  ApplicationRepositoryError,
  ApplicationRepositoryResult,
} from "./application-repository"
export {
  createApplicationWorkflow,
  type ApplicationWorkflow,
  type StartApplicationInput,
  type UpdateApplicationStatusAndSaveInput,
  type AddApplicationNoteAndSaveInput,
  type ApplicationWorkflowError,
  type ApplicationWorkflowResult,
} from "./application-workflow"
export {
  buildCandidateEvidenceCatalog,
  buildApplicationDocumentFoundation,
  createStructuredDocumentDraft,
  validateStructuredDocumentDraft,
  type CandidateEvidenceKind,
  type CandidateEvidenceContext,
  type CandidateEvidenceRequirement,
  type CandidateDocumentEvidence,
  type CandidateDocumentIdentity,
  type CandidateDocumentInput,
  type CandidateEvidence,
  type CandidateEvidenceCatalog,
  type DocumentRequirementStatus,
  type RequirementEvidenceContext,
  type DocumentWarningCode,
  type DocumentWarning,
  type DocumentFoundationErrorCode,
  type DocumentFoundationError,
  type DocumentFoundationResult,
  type ApplicationDocumentContext,
  type ApplicationDocumentFoundation,
  type DocumentType,
  type DocumentLanguage,
  type DocumentClaim,
  type DocumentDraftSection,
  type StructuredDocumentDraft,
  type CreateStructuredDocumentDraftInput,
  type DocumentValidationResult,
} from "./application-documents"
export {
  createTailoringPlan,
  validateTailoringPlan,
  type TailoringReasonCode,
  type TailoringReason,
  type TailoringOptions,
  type TailoringSelection,
  type TailoringSection,
  type TailoringRequirementSupport,
  type TailoringWarningCode,
  type TailoringWarning,
  type TailoringPlan,
  type TailoringErrorCode,
  type TailoringError,
  type TailoringResult,
  type TailoringValidationResult,
} from "./document-tailoring"
export {
  renderApplicationDocument,
  renderGeneratedApplicationDocument,
  type RenderFormat,
  type RenderWarningCode,
  type RenderWarning,
  type RenderMapEntry,
  type RenderedDocument,
  type GeneratedApplicationDocument,
  type GeneratedRenderMapEntry,
  type GeneratedDocumentRenderResult,
  type RenderErrorCode,
  type RenderError,
  type RenderResult,
} from "./document-rendering"
export {
  buildDocumentGenerationRequest,
  validateGeneratedDocumentProposal,
  generateDocumentProposal,
  type ApplicationDocumentGenerator,
  type GenerationEvidence,
  type GenerationRequirementSupport,
  type GenerationConstraints,
  type DocumentGenerationRequest,
  type GeneratedClaimKind,
  type GeneratedClaimProvenance,
  type GeneratedDocumentClaim,
  type GeneratedDocumentSection,
  type GeneratedDocumentProposal,
  type ProviderGenerationErrorCode,
  type ProviderGenerationError,
  type ProviderGenerationResponse,
  type DocumentGenerationErrorCode,
  type DocumentGenerationError,
  type GeneratedProposalValidation,
  type DocumentGenerationResult,
  type DocumentGenerationOptions,
} from "./document-generation"
export { createOpenAIDocumentGenerator, type OpenAIDocumentGeneratorConfig } from "./providers/openai-document-generator"
export {
  generateApplicationDocument,
  type GenerateApplicationDocumentInput,
  type GeneratedApplicationDocumentResult,
  type GeneratedApplicationDocumentError,
  type GeneratedApplicationDocumentWorkflowResult,
} from "./document-workflow"
export {
  createFileApplicationDocumentRepository,
} from "./application-document-file-repository"
export type {
  ApplicationDocumentRecord,
  ApplicationDocumentRepository,
  ApplicationDocumentRepositoryErrorCode,
  ApplicationDocumentRepositoryError,
  ApplicationDocumentRepositoryResult,
} from "./application-document-repository"
export {
  createApplicationDocumentStorageWorkflow,
  type SaveGeneratedApplicationDocumentInput,
  type ApplicationDocumentStorageWorkflowError,
  type ApplicationDocumentStorageWorkflowResult,
  type ApplicationDocumentStorageWorkflow,
} from "./application-document-storage-workflow"
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
  CandidateProfileInputError,
  parseCandidateProfile,
  loadCandidateProfile,
} from "./profile-input"
export {
  CandidateDocumentEvidenceInputError,
  loadCandidateDocumentEvidence,
  type CandidateDocumentEvidenceInput,
  type CandidateDocumentEvidenceInputErrorCode,
} from "./document-evidence-input"
export {
  runMvpWorkflow,
  type MvpDocumentRequest,
  type MvpWorkflowInput,
  type MvpWorkflowDependencies,
  type MvpRenderedDocument,
  type MvpWorkflowSuccess,
  type MvpWorkflowError,
  type MvpWorkflowResult,
} from "./mvp-workflow"
export {
  createInterviewPreparationPlan,
  type InterviewType,
  type InterviewQuestionCategory,
  type InterviewPreparationOptions,
  type InterviewJobContext,
  type InterviewQuestion,
  type StarPreparationPrompt,
  type InterviewPreparationWarningCode,
  type InterviewPreparationWarning,
  type InterviewPreparationPlan,
  type InterviewPreparationErrorCode,
  type InterviewPreparationError,
  type InterviewPreparationResult,
} from "./interview-preparation"
export {
  prepareInterviewAnswer,
  type InterviewStarAnswer,
  type InterviewAnswerInput,
  type AnswerEvidenceReferenceStatus,
  type AnswerEvidenceReference,
  type AnswerStructuralChecks,
  type InterviewAnswerWarningCode,
  type InterviewAnswerWarning,
  type AnswerImprovementPromptCode,
  type AnswerImprovementPrompt,
  type InterviewAnswerPreparation,
  type InterviewAnswerPreparationErrorCode,
  type InterviewAnswerPreparationError,
  type InterviewAnswerPreparationResult,
} from "./interview-answer-preparation"
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
