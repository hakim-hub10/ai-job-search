import type { DocumentLanguage } from "./application-documents"
import type { ApplicationRepository, ApplicationRepositoryError } from "./application-repository"
import type { ApplicationRecord } from "./applications"
import type { CandidateDocumentEvidenceInput } from "./document-evidence-input"
import { createInterviewPreparationPlan, type InterviewPreparationOptions, type InterviewPreparationPlan } from "./interview-preparation"
import { analyzeJobs, type CareerAnalysisResult } from "./orchestrator"
import { enrichJobDetails, type JobDetailEnrichmentResult } from "./job-detail-enrichment"
import type { SearchRelevanceSelection } from "./search-relevance"
import { retrieveSearchAwareJobs, type SearchRetrievalPlan, type SearchAwareRetrievalErrorCode } from "./search-retrieval"
import type { CandidateProfile } from "./profile"
import type { JobSourceAdapter, UnifiedSearchOptions, UnifiedSearchResponse } from "./types"

export interface AnalyzeDiscoveryInput {
  profile: CandidateProfile
  search: UnifiedSearchOptions & { adapters: JobSourceAdapter[]; includeSourceStatus?: boolean }
}

export interface AnalyzeDiscoveryDependencies {
  searchJobs: (options: AnalyzeDiscoveryInput["search"]) => Promise<UnifiedSearchResponse>
  analyzeJobs?: typeof analyzeJobs
  enrichJobDetails?: typeof enrichJobDetails
}

export interface AnalyzeDiscoverySuccess {
  ok: true
  search: UnifiedSearchResponse
  retrievalPlan: SearchRetrievalPlan
  relevance: SearchRelevanceSelection
  enrichment: JobDetailEnrichmentResult
  analysis: CareerAnalysisResult
}

export type AnalyzeDiscoveryResult = AnalyzeDiscoverySuccess
  | { ok: false; error: { code: SearchAwareRetrievalErrorCode; message: string }; search: UnifiedSearchResponse }

export async function discoverAnalysis(
  input: AnalyzeDiscoveryInput,
  dependencies: AnalyzeDiscoveryDependencies,
): Promise<AnalyzeDiscoveryResult> {
  const retrieval = await retrieveSearchAwareJobs({ search: input.search, targetRoles: input.profile.targetRoles }, { searchJobs: dependencies.searchJobs })
  if (!retrieval.ok) return retrieval
  const enrichment = await (dependencies.enrichJobDetails ?? enrichJobDetails)(retrieval.value.eligibleJobs, input.search.adapters)
  const analysis = (dependencies.analyzeJobs ?? analyzeJobs)(input.profile, enrichment.jobs)
  return { ok: true, search: retrieval.value.search, retrievalPlan: retrieval.value.plan, relevance: retrieval.value.relevance, enrichment, analysis }
}

function display(value: string | null): string {
  return value ?? "-"
}

export function formatAnalysisDiscovery(result: AnalyzeDiscoverySuccess): string {
  const lines = [
    `Retrieved candidates: ${result.search.jobs.length}`,
    `Eligible candidates: ${result.relevance.eligibleJobs.length}`,
    `Selected/analyzed candidates: ${result.analysis.inputJobCount}`,
    `Excluded or uncertain candidates: ${result.relevance.excludedJobs.length}`,
    `Detail enrichment: ${result.enrichment.records.filter((record) => record.status === "enriched").length} enriched, ${result.enrichment.records.filter((record) => record.status === "closed").length} closed, ${result.enrichment.records.filter((record) => ["failed", "timeout", "malformed"].includes(record.status)).length} failed`,
    `Ranked jobs (${result.analysis.rankedJobs.length})`,
  ]
  if (result.retrievalPlan.oversamplingApplied) lines.splice(1, 0, `Retrieval limit per source: ${result.retrievalPlan.retrievalLimit}`)
  if (result.analysis.rankedJobs.length === 0) lines.push("No ranked jobs found.")
  for (const [selectionIndex, ranked] of result.analysis.rankedJobs.entries()) {
    lines.push(
      "",
      `Rank ${ranked.rank} | Select ${selectionIndex} | ${ranked.job.title} | ${display(ranked.job.company)}`,
      `Location: ${display(ranked.job.location)} | Score: ${ranked.score} | Confidence: ${ranked.scoringBreakdown.confidenceLabel}`,
      `Source: ${ranked.job.source} | Gaps: ${ranked.skillGapResult.totalGaps}`,
      `Reason: ${ranked.explanation}`,
    )
  }

  const plan = result.analysis.learningPlan
  lines.push("", `Learning plan (${plan.prioritizedGaps.length})`)
  if (plan.prioritizedGaps.length === 0) lines.push("No confirmed learning-plan gaps.")
  for (const gap of plan.prioritizedGaps) {
    lines.push(
      "",
      `Priority ${gap.priority} | ${gap.skill} | Severity: ${gap.severity} | Importance: ${gap.importance}`,
      `Reason: ${gap.reason}`,
      `Evidence: ${gap.evidence[0] ?? "-"}`,
      `Jobs: ${gap.relatedJobs.map((job) => `#${job.rank} ${job.title}`).join("; ")}`,
    )
  }
  return lines.join("\n")
}

export type ApplicationDiscoveryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ApplicationRepositoryError }

export async function discoverApplicationList(repository: ApplicationRepository): Promise<ApplicationDiscoveryResult<ApplicationRecord[]>> {
  return repository.list()
}

export async function discoverApplication(repository: ApplicationRepository, applicationId: string): Promise<ApplicationDiscoveryResult<ApplicationRecord>> {
  return repository.getById(applicationId)
}

export function formatApplicationList(applications: ApplicationRecord[]): string {
  if (applications.length === 0) return "No applications found."
  return applications.map((application) => [
    application.id,
    application.jobSnapshot.title,
    display(application.jobSnapshot.company),
    application.status,
    application.updatedAt,
  ].join(" | ")).join("\n")
}

export function formatApplication(application: ApplicationRecord): string {
  return [
    `Application ID: ${application.id}`,
    `Title: ${application.jobSnapshot.title}`,
    `Company: ${display(application.jobSnapshot.company)}`,
    `Location: ${display(application.jobSnapshot.location)}`,
    `Status: ${application.status}`,
    `Created: ${application.createdAt}`,
    `Updated: ${application.updatedAt}`,
    `Source: ${application.jobSnapshot.source}`,
    `URL: ${display(application.jobSnapshot.url)}`,
    `Saved rank: ${application.analysisSnapshot.rank}`,
    `Score: ${application.analysisSnapshot.scoringResult.score}`,
    `Confidence: ${application.analysisSnapshot.scoringResult.confidenceLabel}`,
    `Confirmed gaps: ${application.analysisSnapshot.skillGapResult.totalGaps}`,
    `Reason: ${application.analysisSnapshot.explanation}`,
  ].join("\n")
}

export interface InterviewQuestionDiscoveryInput {
  application: ApplicationRecord
  documentEvidence: CandidateDocumentEvidenceInput
  language?: DocumentLanguage
  interviewType?: InterviewPreparationOptions["interviewType"]
}

export function discoverInterviewQuestions(input: InterviewQuestionDiscoveryInput) {
  return createInterviewPreparationPlan(input.application, input.documentEvidence, {
    ...(input.language ? { language: input.language } : {}),
    ...(input.interviewType ? { interviewType: input.interviewType } : {}),
  })
}

export function formatInterviewQuestions(plan: InterviewPreparationPlan): string {
  const lines = [
    `Interview questions for ${plan.job.jobTitle}${plan.job.company ? ` at ${plan.job.company}` : ""}`,
    `Application: ${plan.applicationId}`,
    `Language: ${plan.language}`,
    `Interview type: ${plan.interviewType}`,
  ]
  for (const question of plan.questions) {
    lines.push("", `Question ID: ${question.id}`, `Category: ${question.category}`, `Question: ${question.prompt}`)
    if (question.requirementKeys.length > 0) lines.push(`Requirement keys: ${question.requirementKeys.join(", ")}`)
    if (question.gapKeys.length > 0) lines.push(`Gap keys: ${question.gapKeys.join(", ")}`)
  }
  return lines.join("\n")
}
