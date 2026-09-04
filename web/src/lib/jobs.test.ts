import { describe, expect, it } from "bun:test";
import type {
  JobSourceAdapter,
  NormalizedJob,
} from "../../../.agents/job-search/cli/src/index";
import { searchWebJobs } from "./jobs";

const adapter: JobSourceAdapter = {
  name: "fixture",
  search: async () => ({
    status: "ok",
    source: "fixture",
    jobs: [],
  }),
};

const job: NormalizedJob = {
  id: "job-1",
  title: "IT Support Technician",
  company: "Example",
  location: "Jönköping",
  country: "Sweden",
  url: "https://example.test/job-1",
  applyUrl: null,
  source: "fixture",
  sourceId: "job-1",
  date: null,
  employmentType: null,
  remote: null,
  description: null,
  salary: null,
  skills: [],
  seniority: null,
  category: null,
};

describe("jobs web data layer", () => {
  it("passes search input and target roles to the existing retrieval boundary", async () => {
    let receivedInput: unknown;

    const result = await searchWebJobs(
      {
        query: "IT Support",
        location: "Jönköping",
        limit: 10,
        sources: ["fixture"],
        targetRoles: ["IT Support"],
      },
      {
        resolveAdapters: (sources) => {
          expect(sources).toEqual(["fixture"]);
          return [adapter];
        },
        retrieveJobs: async (input) => {
          receivedInput = input;

          return {
            ok: true,
            value: {
              plan: {
                visibleLimit: 10,
                retrievalLimit: 30,
                oversamplingApplied: true,
              },
              search: {
                query: "IT Support",
                location: "Jönköping",
                jobs: [job],
                total: 1,
                sourceStatus: [
                  {
                    source: "fixture",
                    status: "ok",
                    count: 1,
                  },
                ],
              },
              relevance: {
                results: [],
                eligibleJobs: [job],
                excludedJobs: [],
              },
              eligibleJobs: [job],
            },
          };
        },
      },
    );

    expect(receivedInput).toMatchObject({
      search: {
        query: "IT Support",
        location: "Jönköping",
        limit: 10,
        adapters: [adapter],
      },
      targetRoles: ["IT Support"],
    });

    expect(result).toEqual({
      ok: true,
      jobs: [job],
      totalRetrieved: 1,
      sourceStatus: [
        {
          source: "fixture",
          status: "ok",
          count: 1,
        },
      ],
    });
  });

  it("preserves the existing all-sources-failed result", async () => {
    const result = await searchWebJobs(
      { query: "Nurse" },
      {
        resolveAdapters: () => [adapter],
        retrieveJobs: async () => ({
          ok: false,
          error: {
            code: "ALL_SOURCES_FAILED",
            message: "All selected job sources failed.",
          },
          search: {
            query: "Nurse",
            jobs: [],
            total: 0,
            sourceStatus: [
              {
                source: "fixture",
                status: "error",
                error: "offline",
              },
            ],
          },
        }),
      },
    );

    expect(result).toEqual({
      ok: false,
      code: "ALL_SOURCES_FAILED",
      message: "All selected job sources failed.",
      sourceStatus: [
        {
          source: "fixture",
          status: "error",
          error: "offline",
        },
      ],
    });
  });

  it("maps unexpected integration failures without throwing", async () => {
    const result = await searchWebJobs(
      { query: "Accountant" },
      {
        resolveAdapters: () => {
          throw new Error("adapter failure");
        },
      },
    );

    expect(result).toEqual({
      ok: false,
      code: "SEARCH_FAILED",
      message: "adapter failure",
      sourceStatus: [],
    });
  });
});
