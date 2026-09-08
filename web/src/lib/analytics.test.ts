import { describe, expect, it, mock } from "bun:test";
import type { ApplicationRecord } from "../../../.agents/job-search/cli/src/applications";
mock.module("server-only", () => ({}));
const { deriveJobSearchAnalytics } = await import("./analytics");

const application = (id: string, source: string, location: string | null, title: string): ApplicationRecord => ({
  id, jobSnapshot: { id: `job-${id}`, source, sourceId: `source-${id}`, title, company: null, location, country: null, url: null, applyUrl: null, date: null, employmentType: null, remote: null, description: null, salary: null, skills: [], seniority: null, category: null },
  analysisSnapshot: { rank: 1, matchingResult: { jobId: `job-${id}`, jobTitle: title, candidateHeadline: "test", matched: [], missing: [], conflicting: [], unknown: [], totalMatched: 2, totalMissing: 1, totalConflicting: 0, totalUnknown: 1, matchedDimensions: [], missingDimensions: [], conflictingDimensions: [], unknownDimensions: [] }, scoringResult: {} as ApplicationRecord["analysisSnapshot"]["scoringResult"], skillGapResult: {} as ApplicationRecord["analysisSnapshot"]["skillGapResult"], explanation: "test" }, status: "saved", statusHistory: [], notes: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
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
});