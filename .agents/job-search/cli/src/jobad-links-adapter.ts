import type {
  JobSourceAdapter,
  NormalizedJob,
  SourceSearchResult,
  UnifiedSearchOptions,
} from "./types"
import { normalizeJob } from "./utils"
import { resolveMunicipalityConceptId } from "./jobtech-taxonomy"

const JOBAD_LINKS_SEARCH_URL = "https://links.api.jobtechdev.se/joblinks"

type FetchLike = typeof fetch

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function uniqueStrings(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}
export function jobAdLinksHitToNormalizedJob(
  value: unknown,
): NormalizedJob | null {
  const hit = asRecord(value)
  if (!hit) return null

  const id = asString(hit.id)
  const headline = asString(hit.headline)
  if (!id || !headline) return null

  const employer = asRecord(hit.employer)
  const occupationGroup = asRecord(hit.occupation_group)

  const addresses = Array.isArray(hit.workplace_addresses)
    ? hit.workplace_addresses.map(asRecord).filter(
        (address): address is Record<string, unknown> => address !== null,
      )
    : []

  const municipalities = uniqueStrings(
    addresses.map((address) => asString(address.municipality)),
  )

  const regions = uniqueStrings(
    addresses.map((address) => asString(address.region)),
  )

  const countries = uniqueStrings(
    addresses.map((address) => asString(address.country)),
  )

  const location =
    municipalities.length > 0
      ? municipalities.join(", ")
      : regions.length > 0
        ? regions.join(", ")
        : null

  const sourceLinks = Array.isArray(hit.source_links)
    ? hit.source_links.map(asRecord).filter(
        (link): link is Record<string, unknown> => link !== null,
      )
    : []

  const urls = uniqueStrings(
    sourceLinks.map((link) => asString(link.url)),
  )

  const primaryUrl = urls[0] ?? null

  return normalizeJob({
    id,
    title: headline,
    company: asString(employer?.name),
    location,
    country: countries.length > 0 ? countries.join(", ") : null,
    url: primaryUrl,
    applyUrl: primaryUrl,
    source: "jobadlinks",
    sourceId: id,
    date: asString(hit.publication_date),
    employmentType: null,
    remote: null,
    description: asString(hit.brief),
    salary: null,
    skills: [],
    seniority: null,
    category: asString(occupationGroup?.label),
  })
}

export function createJobAdLinksAdapter(
  fetchImpl: FetchLike = fetch,
): JobSourceAdapter {
  return {
    name: "jobadlinks",

    async search(options: UnifiedSearchOptions): Promise<SourceSearchResult> {
      try {
        const url = new URL(JOBAD_LINKS_SEARCH_URL)

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
            source: "jobadlinks",
            error: `JobAd Links request failed with HTTP ${response.status}`,
          }
        }

        const payload = await response.json()
        const root = asRecord(payload)
        const hits = Array.isArray(root?.hits) ? root.hits : []

        const jobs = hits
          .map(jobAdLinksHitToNormalizedJob)
          .filter((job): job is NormalizedJob => job !== null)

        return {
          jobs,
          status: "ok",
          source: "jobadlinks",
        }
      } catch (error) {
        return {
          jobs: [],
          status: "error",
          source: "jobadlinks",
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}
