import { describe, expect, it, mock } from "bun:test";
import type { ApplicationRecord } from "../../../.agents/job-search/cli/src/applications";
mock.module("server-only", () => ({}));
const { deriveCandidateRequirementInsights, deriveInterviewPracticeAnalytics, deriveJobSearchAnalytics, deriveCandidateCareerActions } = await import("./analytics");

const application = (id: string, source: string, location: string | null, title: string): ApplicationRecord => ({
  id, jobSnapshot: { id: `job-${id}`, source, sourceId: `source-${id}`, title, company: null, location, country: null, url: null, applyUrl: null, date: null, employmentType: null, remote: null, description: null, salary: null, skills: [], seniority: null, category: null },
  analysisSnapshot: { rank: 1, matchingResult: { jobId: `job-${id}`, jobTitle: title, candidateHeadline: "test", matched: [], missing: [], conflicting: [], unknown: [], totalMatched: 2, totalMissing: 1, totalConflicting: 0, totalUnknown: 1, matchedDimensions: [], missingDimensions: [], conflictingDimensions: [], unknownDimensions: [] }, scoringResult: {} as ApplicationRecord["analysisSnapshot"]["scoringResult"], skillGapResult: { jobId: `job-${id}`, jobTitle: title, candidateHeadline: "test", gaps: [], strengths: [], unknowns: [], recommendations: [], totalGaps: 0, criticalGaps: 0, highGaps: 0, summary: "" }, explanation: "test" }, status: "saved", statusHistory: [], notes: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("job search analytics read model", () => {
  it("distinguishes durable application facts from unavailable search history", () => {
    const result = deriveJobSearchAnalytics([application("b", "jobtech", null, "Supporttekniker"), application("a", "linkedin", "Malmö", "Supporttekniker")]);
    expect(result).toMatchObject({ availability: "available", basis: "APPLICATION_RECORDS", totalJobsRepresented: 2, searchHistory: { availability: "notTracked" }, matching: { availability: "available", matchedRequirements: 4, missingRequirements: 2, unknownRequirements: 2 } });
    expect(result.sourceDistribution).toEqual([{ label: "jobtech", count: 1 }, { label: "linkedin", count: 1 }]);
    expect(result.locationDistribution).toEqual([{ label: "Malmö", count: 1 }, { label: "Okänd plats", count: 1 }]);
    expect(result.titleDistribution).toEqual([{ label: "Supporttekniker", count: 2 }]);
  });
  it("represents a real empty application set without inventing search facts", () => {
    expect(deriveJobSearchAnalytics([])).toEqual({ availability: "available", basis: "APPLICATION_RECORDS", totalJobsRepresented: 0, sourceDistribution: [], locationDistribution: [], titleDistribution: [], searchHistory: { availability: "notTracked" }, matching: { availability: "unavailable", matchedRequirements: 0, missingRequirements: 0, conflictingRequirements: 0, unknownRequirements: 0 } });
  });
  it("derives distinct stable advisory actions for missing, unknown, conflict, gap, and coverage facts", () => {
    const insights = { availability: "available" as const, applicationsTotal: 3, applicationsWithAnalysis: 2, applicationsWithoutAnalysis: 1, requirements: [
      { requirementId: "skill:docker", label: "Docker", applicationsRepresented: 2, matched: 0, missing: 1, conflicting: 0, unknown: 1 },
      { requirementId: "skill:m365", label: "Microsoft 365", applicationsRepresented: 2, matched: 0, missing: 0, conflicting: 1, unknown: 0 },
    ], skillGaps: [{ gapId: "skill:docker", label: "Docker", applicationsRepresented: 2, occurrences: 2, severityDistribution: [{ label: "high", count: 2 }] }],
    };
    const actions = deriveCandidateCareerActions(insights);
    expect(actions.map((action) => action.kind)).toEqual(["reviewMissingRequirement", "verifyUnknownRequirement", "reviewConflictingRequirement", "reviewSkillGap", "improveAnalysisCoverage"]);
    expect(actions[0]?.id).toBe("review-missing:skill:docker"); expect(actions[1]?.description).toContain("verifiera"); expect(actions[0]?.description).not.toBe(actions[1]?.description);
    expect(JSON.stringify(actions)).not.toMatch(/sannolikhet|anställningsbar|måste|hiring|score|recommendation/i);
  });
});
describe("interview practice analytics read model", () => {
  it("aggregates factual sessions without temporal or quality claims", async () => {
    const session = (id: string, status: "inProgress" | "completed", turns: Array<{ status: "skipped"; questionId: string }>) => ({ id, applicationId: "A", language: "sv" as const, interviewType: "behavioral" as const, status, planQuestionIds: ["q1", "q2"], currentQuestionIndex: turns.length, turns });
    const result = deriveInterviewPracticeAnalytics([session("active", "inProgress", [{ status: "skipped", questionId: "q1" }]), session("done", "completed", [{ status: "skipped", questionId: "q1" }, { status: "skipped", questionId: "q2" }])], ["linked", "unlinked"]);
    expect(result).toMatchObject({ totalSessions: 2, activeSessions: 1, completedSessions: 1, linkedSessions: 1, unlinkedSessions: 1, answeredQuestions: 0, skippedQuestions: 3, temporalAnalytics: { availability: "notTracked" } });
    expect(result.typeDistribution).toEqual([{ label: "behavioral", count: 2 }]);
  });
});
describe("candidate requirement insights", () => {
  it("keeps matched, missing, conflicting and unknown separate across canonical requirements", () => {
    const first = application("a", "jobtech", "Malmö", "Support");
    const second = application("b", "jobtech", "Malmö", "Support");
    const evidence = (status: "matched" | "missing" | "conflicting" | "unknown", label: string) => ({ dimension: "technicalSkills" as const, status, detail: "stored", requirementCoverage: { matchedRequirements: [label], missingRequirements: [], coverageRatio: status === "matched" ? 1 : 0 } });
    first.analysisSnapshot.matchingResult.matched = [evidence("matched", "Microsoft 365")]; first.analysisSnapshot.matchingResult.totalMatched = 1;
    first.analysisSnapshot.matchingResult.missing = [evidence("missing", "Active Directory")]; first.analysisSnapshot.matchingResult.totalMissing = 1;
    second.analysisSnapshot.matchingResult.conflicting = [evidence("conflicting", "Microsoft 365")]; second.analysisSnapshot.matchingResult.totalConflicting = 1;
    second.analysisSnapshot.matchingResult.unknown = [evidence("unknown", "Microsoft 365")]; second.analysisSnapshot.matchingResult.totalUnknown = 1;
    const result = deriveCandidateRequirementInsights([first, second]);
    expect(result.requirements.find((item) => item.requirementId === "skill:microsoft 365")).toMatchObject({ applicationsRepresented: 2, matched: 1, missing: 0, conflicting: 1, unknown: 1 });
    expect(result.requirements.find((item) => item.requirementId === "skill:active directory")).toMatchObject({ applicationsRepresented: 1, matched: 0, missing: 1, conflicting: 0, unknown: 0 });
  });
  it("aggregates persisted skill gaps without scores or recommendation synthesis", () => {
    const first = application("a", "jobtech", "Malmö", "Support");
    first.analysisSnapshot.skillGapResult.gaps = [{ type: "missing_skill", title: "Missing: Docker", description: "stored", jobRequirement: "Required: Docker", severity: "high", evidence: "stored", requirement: { identity: { key: "skill:docker", original: "Docker", normalized: "docker", category: "skill" }, importance: "required" } }]; first.analysisSnapshot.skillGapResult.totalGaps = 1; first.analysisSnapshot.skillGapResult.highGaps = 1;
    const result = deriveCandidateRequirementInsights([first]);
    expect(result.skillGaps).toEqual([{ gapId: "skill:docker", label: "Docker", applicationsRepresented: 1, occurrences: 1, severityDistribution: [{ label: "high", count: 1 }] }]);
    expect(JSON.stringify(result)).not.toMatch(/score|recommendation|employability|probability/i);
  });
});