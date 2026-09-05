const JOBTECH_TAXONOMY_URL =
  "https://data.jobtechdev.se/taxonomy/version/latest/query/all-concepts/all-concepts.json"

export type TaxonomyFetchLike = typeof fetch

type MunicipalityIndex = ReadonlyMap<string, string>

let cachedMunicipalities: MunicipalityIndex | null = null
let cachedMunicipalitiesPromise: Promise<MunicipalityIndex | null> | null = null

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

async function loadMunicipalities(
  fetchImpl: TaxonomyFetchLike,
): Promise<MunicipalityIndex | null> {
  const response = await fetchImpl(JOBTECH_TAXONOMY_URL)
  if (!response.ok) return null

  const payload = await response.json()
  const root = asRecord(payload)
  const data = asRecord(root?.data)
  const concepts = Array.isArray(data?.concepts) ? data.concepts : []

  const municipalities = new Map<string, string>()

  for (const value of concepts) {
    const concept = asRecord(value)
    if (!concept) continue
    if (asString(concept.type) !== "municipality") continue

    const label = asString(concept.preferred_label)
    const id = asString(concept.id)

    if (label && id) {
      municipalities.set(normalizeLocation(label), id)
    }
  }

  return municipalities
}

export async function resolveMunicipalityConceptId(
  location: string,
  fetchImpl: TaxonomyFetchLike = fetch,
): Promise<string | null> {
  if (!cachedMunicipalities) {
    if (!cachedMunicipalitiesPromise) {
      cachedMunicipalitiesPromise = loadMunicipalities(fetchImpl)
    }

    try {
      cachedMunicipalities = await cachedMunicipalitiesPromise
    } finally {
      cachedMunicipalitiesPromise = null
    }
  }

  return cachedMunicipalities?.get(normalizeLocation(location)) ?? null
}

export function clearMunicipalityCacheForTests(): void {
  cachedMunicipalities = null
  cachedMunicipalitiesPromise = null
}
