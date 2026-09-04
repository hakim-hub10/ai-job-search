import {
  resolveBuiltInSourceAdapters,
  retrieveSearchAwareJobs,
  type JobSourceAdapter,
  type NormalizedJob,
  type SourceStatusEntry,
} from "../../../.agents/job-search/cli/src/index";

export interface JobsSearchInput {
  query?: string;
  location?: string;
  limit?: number;
  sources?: string[];
  targetRoles?: string[];
}

export interface JobsSearchSuccess {
  ok: true;
  jobs: NormalizedJob[];
  totalRetrieved: number;
  sourceStatus: SourceStatusEntry[];
}

export interface JobsSearchFailure {
  ok: false;
  code: "ALL_SOURCES_FAILED" | "SEARCH_FAILED";
  message: string;
  sourceStatus: SourceStatusEntry[];
}

export type JobsSearchResult = JobsSearchSuccess | JobsSearchFailure;

export interface JobsSearchDependencies {
  resolveAdapters?: (sources?: readonly string[]) => JobSourceAdapter[];
  retrieveJobs?: typeof retrieveSearchAwareJobs;
}

export async function searchWebJobs(
  input: JobsSearchInput,
  dependencies: JobsSearchDependencies = {},
): Promise<JobsSearchResult> {
  try {
    const resolveAdapters =
      dependencies.resolveAdapters ?? resolveBuiltInSourceAdapters;
    const retrieveJobs =
      dependencies.retrieveJobs ?? retrieveSearchAwareJobs;

    const adapters = resolveAdapters(input.sources);

    const result = await retrieveJobs({
      search: {
        query: input.query,
        location: input.location,
        limit: input.limit,
        adapters,
      },
      ...(input.targetRoles === undefined
        ? {}
        : { targetRoles: input.targetRoles }),
    });

    if (!result.ok) {
      return {
        ok: false,
        code: result.error.code,
        message: result.error.message,
        sourceStatus: result.search.sourceStatus,
      };
    }

    return {
      ok: true,
      jobs: result.value.eligibleJobs,
      totalRetrieved: result.value.search.total,
      sourceStatus: result.value.search.sourceStatus,
    };
  } catch (error) {
    return {
      ok: false,
      code: "SEARCH_FAILED",
      message:
        error instanceof Error
          ? error.message
          : "Job search failed.",
      sourceStatus: [],
    };
  }
}
