import type {
  JobSourceAdapter,
  NormalizedJob,
  SourceSearchResult,
  UnifiedSearchOptions,
} from "./types"
import { normalizeJob } from "./utils"

const JOBTECH_SEARCH_URL = "https://jobsearch.api.jobtechdev.se/search"
const JOBTECH_TAXONOMY_URL =
  "https://data.jobtechdev.se/taxonomy/version/latest/query/all-concepts/all-concepts.json"

type FetchLike = typeof fetch

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function normalizeLocation(value: string): string {
  return value.trim().toLocaleLowerCase("sv-SE")
}

async function resolveMunicipalityConceptId(
  location: string,
  fetchImpl: FetchLike,
): Promise<string | null> {
  const response = await fetchImpl(JOBTECH_TAXONOMY_URL)
  if (!response.ok) return null

  const payload = await response.json()
  const root = asRecord(payload)
  const data = asRecord(root?.data)
  const concepts = Array.isArray(data?.concepts) ? data.concepts : []

  const wanted = normalizeLocation(location)

  for (const value of concepts) {
    const concept = asRecord(value)
    if (!concept) continue

    if (asString(concept.type) !== "municipality") continue

    const label = asString(concept.preferred_label)
    const id = asString(concept.id)

    if (label && id && normalizeLocation(label) === wanted) {
      return id
    }
  }

  return null
}

export function jobTechHitToNormalizedJob(value: unknown): NormalizedJob | null {
  const hit = asRecord(value)
  if (!hit) return null

  const id = asString(hit.id)
  const headline = asString(hit.headline)
  if (!id || !headline) return null

  const employer = asRecord(hit.employer)
  const address = asRecord(hit.workplace_address)
  const application = asRecord(hit.application_details)
  const description = asRecord(hit.description)
  const employmentType = asRecord(hit.employment_type)
  const workplaceModel = asRecord(hit.workplace_model)
  const occupation = asRecord(hit.occupation)

  const city =
    asString(address?.municipality) ??
    asString(address?.city) ??
    asString(address?.region)

  return normalizeJob({
    id,
    title: headline,
    company: asString(employer?.name),
    location: city,
    country: asString(address?.country),
    url: asString(hit.webpage_url),
    applyUrl: asString(application?.url) ?? asString(hit.webpage_url),
    source: "jobtech",
    sourceId: id,
    date: asString(hit.publication_date),
    employmentType: asString(employmentType?.label),
    remote: asString(workplaceModel?.label),
    description: asString(description?.text),
    salary: asString(hit.salary_description),
    skills: [],
    seniority: null,
    category: asString(occupation?.label),
  })
}

export function createJobTechAdapter(
  fetchImpl: FetchLike = fetch,
): JobSourceAdapter {
  return {
    name: "jobtech",

    async search(options: UnifiedSearchOptions): Promise<SourceSearchResult> {
      try {
        const url = new URL(JOBTECH_SEARCH_URL)

        const query = options.query?.trim()
        const location = options.location?.trim()

        if (query) {
          url.searchParams.set("q", query)
        }

        if (location) {
          const municipalityId = await resolveMunicipalityConceptId(
            location,
            fetchImpl,
          )

          if (municipalityId) {
            url.searchParams.set("municipality", municipalityId)
          } else {
            const fallbackQuery = [query, location]
              .filter((value): value is string => Boolean(value))
              .join(" ")

            if (fallbackQuery) {
              url.searchParams.set("q", fallbackQuery)
            }
          }
        }

        if (options.limit !== undefined) {
          url.searchParams.set("limit", String(options.limit))
        }

        const response = await fetchImpl(url)

        if (!response.ok) {
          return {
            jobs: [],
            status: "error",
            source: "jobtech",
            error: `JobTech request failed with HTTP ${response.status}`,
          }
        }

        const payload = await response.json()
        const root = asRecord(payload)
        const hits = Array.isArray(root?.hits) ? root.hits : []

        const jobs = hits
          .map(jobTechHitToNormalizedJob)
          .filter((job): job is NormalizedJob => job !== null)

        return {
          jobs,
          status: "ok",
          source: "jobtech",
        }
      } catch (error) {
        return {
          jobs: [],
          status: "error",
          source: "jobtech",
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}
