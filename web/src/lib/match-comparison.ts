import type { NormalizedJob } from "../../../.agents/job-search/cli/src/types";
import type { ApplicationAnalysisSnapshot } from "../../../.agents/job-search/cli/src/applications";
import type { MatchingResult } from "../../../.agents/job-search/cli/src/matching";
import {
  conflictingGapItems,
  formatDimension,
  missingGapItems,
  unknownEvidenceCase,
  unknownEvidenceLabel,
  type MatchGapItem,
} from "./match-confidence";

/**
 * Individual skill titles the candidate has proven evidence for right now.
 * A partially-covered technicalSkills dimension still reports status
 * "missing" overall, but requirementCoverage.matchedRequirements on that
 * same evidence entry already lists exactly which individual skills did
 * resolve - so a skill-level improvement must be read from there too, not
 * only from evidence whose whole dimension flipped to "matched".
 */
function matchedTitles(matchingResult: MatchingResult): string[] {
  const technicalEvidence = [...matchingResult.matched, ...matchingResult.missing].find((evidence) => evidence.dimension === "technicalSkills");
  const skillTitles = technicalEvidence?.requirementCoverage?.matchedRequirements ?? [];
  const wholeDimensionTitles = matchingResult.matched
    .filter((evidence) => evidence.dimension !== "technicalSkills")
    .map((evidence) => formatDimension(evidence.dimension));
  return [...skillTitles, ...wholeDimensionTitles];
}

function problemTitles(matchingResult: MatchingResult, job: NormalizedJob): string[] {
  return [
    ...matchingResult.missing.flatMap(missingGapItems).map((item) => item.title),
    ...matchingResult.conflicting.flatMap(conflictingGapItems).map((item) => item.title),
    ...matchingResult.unknown.filter((evidence) => unknownEvidenceCase(evidence, job) === "candidateUncertain").map((evidence) => formatDimension(evidence.dimension)),
  ];
}

export interface MatchComparison {
  previousScore: number;
  currentScore: number;
  change: number;
  newMatches: string[];
  remainingMissing: MatchGapItem[];
  remainingUncertain: MatchGapItem[];
  remainingConflicting: MatchGapItem[];
}

/**
 * Compares two real, already-stored analysis snapshots for the same
 * application - never recomputes or reinterprets a score. "newMatches" only
 * ever lists a requirement that was a real problem in the previous analysis
 * (verified-missing, conflicting, or candidate-uncertain) AND is positively
 * matched evidence in the new one; a requirement whose classification merely
 * changed for other reasons is never reported as an improvement. The job
 * snapshot is identical in both analyses (re-analysis never changes it), so
 * the job-unspecified/candidate-uncertain split for a given dimension is
 * stable across the comparison.
 */
export function buildMatchComparison(
  previous: ApplicationAnalysisSnapshot,
  current: ApplicationAnalysisSnapshot,
  job: NormalizedJob,
): MatchComparison {
  const previousProblems = new Set(problemTitles(previous.matchingResult, job));
  const currentProblems = new Set(problemTitles(current.matchingResult, job));
  const currentMatched = new Set(matchedTitles(current.matchingResult));

  const newMatches = [...previousProblems].filter((title) => currentMatched.has(title) && !currentProblems.has(title));

  const remainingUncertain = current.matchingResult.unknown
    .filter((evidence) => unknownEvidenceCase(evidence, job) === "candidateUncertain")
    .map((evidence) => ({ title: formatDimension(evidence.dimension), description: unknownEvidenceLabel(evidence, job) }));

  return {
    previousScore: previous.scoringResult.score,
    currentScore: current.scoringResult.score,
    change: current.scoringResult.score - previous.scoringResult.score,
    newMatches,
    remainingMissing: current.matchingResult.missing.flatMap(missingGapItems),
    remainingUncertain,
    remainingConflicting: current.matchingResult.conflicting.flatMap(conflictingGapItems),
  };
}
