import Link from "next/link";

import { analyzeJobsForCandidate } from "@/lib/candidate-job-matching";
import { loadCandidateProfileRepository } from "@/lib/candidate-profiles";
import { searchWebJobs } from "@/lib/jobs";
import styles from "../page.module.css";
import { startApplicationAction } from "./actions";
import { configuredAuthorizationDependencies, getAuthorizedCandidateContext } from "@/lib/authorization";

export const dynamic = "force-dynamic";

interface JobsPageProps {
  searchParams: Promise<{
    query?: string;
    location?: string;
    limit?: string;
    applicationError?: string;
  }>;
}

function firstValue(value: string | undefined) {
  return value?.trim() ?? "";
}

function parseLimit(value: string | undefined) {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 50) {
    return 10;
  }

  return parsed;
}

function formatSearchError(
  code: "ALL_SOURCES_FAILED" | "SEARCH_FAILED",
): string {
  return code === "ALL_SOURCES_FAILED"
    ? "Ingen av de valda jobbkällorna kunde nås just nu."
    : "Ett tekniskt fel uppstod under jobbsökningen.";
}

function formatApplicationError(code: string): string {
  const messages: Record<string, string> = {
    CONFIGURATION_MISSING: "Ansökningsarkivet eller jobbcoachens arbetsyta är inte konfigurerad.",
    INVALID_INPUT: "Kandidatens eller jobbets information är ogiltig.",
    CANDIDATE_NOT_FOUND: "Den valda kandidaten kunde inte hittas.",
    CANDIDATE_STORAGE_FAILURE: "Kandidatregistret kunde inte läsas.",
    PROFILE_NOT_FOUND: "Kandidatprofil saknas för den valda kandidaten.",
    PROFILE_STORAGE_FAILURE: "Kandidatprofilen kunde inte läsas.",
    SEARCH_FAILED: "Jobbet kunde inte hämtas igen för att skapa ansökan.",
    JOB_NOT_FOUND: "Det valda jobbet kunde inte hittas i den aktuella sökningen.",
    APPLICATION_STORAGE_FAILURE: "Ansökningsarkivet kunde inte uppdateras.",
    DUPLICATE_APPLICATION: "Det finns redan en ansökan för det här jobbet och kandidaten.",
    APPLICATION_CREATION_FAILED: "Ansökan kunde inte skapas.",
    APPLICATION_ASSOCIATION_FAILED: "Ansökan skapades, men kunde inte kopplas till kandidaten.",
  };

  return messages[code] ?? "Ansökan kunde inte startas.";
}

function formatSourceName(source: string): string {
  const labels: Record<string, string> = {
    linkedin: "LinkedIn",
    freehire: "FreeHire",
    jobtech: "Platsbanken",
    jobadlinks: "JobAd Links",
    jobindex: "Jobindex",
    jobnet: "Jobnet",
    jobbank: "Jobbank",
    jobdanmark: "Jobdanmark",
  };

  return labels[source] ?? source;
}

const dimensionLabels: Record<string, string> = {
  targetRole: "Målroll",
  technicalSkills: "Tekniska kompetenser",
  softSkills: "Mjuka kompetenser",
  location: "Plats",
  remotePreference: "Arbetsform",
  employmentType: "Anställningsform",
  yearsOfExperience: "Erfarenhet",
  certifications: "Certifieringar",
  languages: "Språk",
  preferredIndustries: "Bransch",
};

const severityLabels: Record<string, string> = {
  critical: "Kritisk",
  high: "Hög",
  medium: "Medel",
  low: "Låg",
};

function formatDimension(dimension: string): string {
  return dimensionLabels[dimension] ?? dimension;
}

function formatSeverity(severity: string): string {
  return severityLabels[severity] ?? severity;
}

function formatEvidence(evidence: {
  dimension: string;
  requirementCoverage?: {
    matchedRequirements: string[];
    missingRequirements: string[];
  };
}): string[] {
  const requirements = evidence.requirementCoverage?.matchedRequirements ?? [];

  return requirements.length > 0
    ? requirements.map((requirement) => `${formatDimension(evidence.dimension)}: ${requirement}`)
    : [formatDimension(evidence.dimension)];
}

function formatGapType(type: string): string {
  const labels: Record<string, string> = {
    missing_skill: "Saknad kompetens",
    insufficient_skill: "Otillräcklig kompetens",
    missing_certification: "Saknad certifiering",
    missing_language: "Saknat språk",
    experience_gap: "Erfarenhetsgap",
    education_gap: "Utbildningsgap",
    other: "Övrigt gap",
  };

  return labels[type] ?? type;
}

function formatRequirement(requirement: string): string {
  const separator = requirement.indexOf(":");
  return separator >= 0
    ? requirement.slice(separator + 1).trim()
    : requirement;
}

export default async function JobsPage({ searchParams }: JobsPageProps) {
  const params = await searchParams;

  const query = firstValue(params.query);
  const location = firstValue(params.location);
  const limit = parseLimit(params.limit);
  const applicationError = firstValue(params.applicationError);

  const authorization = configuredAuthorizationDependencies();
  if (!authorization.ok) return <main className={styles.main}><section className={styles.panel}><h1>Jobb kunde inte visas</h1><p>Resursen kunde inte hittas.</p></section></main>;
  const authorized = await getAuthorizedCandidateContext(authorization.value);
  if (!authorized.ok) return <main className={styles.main}><section className={styles.panel}><h1>Jobb kunde inte visas</h1><p>Logga in igen eller försök senare.</p></section></main>;
  const selectedCandidate = authorized.value.candidate;

  const hasSearch = query.length > 0 || location.length > 0;

  const result = hasSearch
    ? await searchWebJobs({
        ...(query ? { query } : {}),
        ...(location ? { location } : {}),
        limit,
        ...(selectedCandidate
          ? { targetRoles: undefined }
          : {}),
      })
    : null;

  let matchingResult:
    | Awaited<ReturnType<typeof analyzeJobsForCandidate>>
    | null = null;

  if (result?.ok && selectedCandidate) {
    const profileContext = loadCandidateProfileRepository();

    if (profileContext.configured && profileContext.repository) {
      matchingResult = await analyzeJobsForCandidate(
        {
          candidateId: selectedCandidate.id,
          jobs: result.jobs,
        },
        {
          profileRepository: profileContext.repository,
        },
      );
    }
  }

  const rankedJobs =
    matchingResult?.ok ? matchingResult.analysis.rankedJobs : null;

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.logoMark}>AC</div>
          <div>
            <strong>AI Career Agent</strong>
            <span>Sverige – Förhandsversion</span>
          </div>
        </div>

        <nav className={styles.nav}>
          <Link href="/">Översikt</Link>
          <Link className={styles.active} href="/jobs">
            Jobb
          </Link>
          <Link href="/candidates">Min profil</Link>
          <Link href="/applications">Mina ansökningar</Link>
        </nav>

        <div className={styles.sidebarFooter}>
          <span>Lokal förhandsversion</span>
          <small>Ingen molnsynkronisering</small>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Jobbsökning</p>
            <h1>Hitta jobb</h1>
            <p className={styles.subtitle}>
              Sök jobb och förstå hur de matchar din profil.
            </p>
          </div>

          <div className={styles.status}>
            <span className={styles.statusDot} />
            Flera jobbkällor
          </div>
        </header>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Sök</p>
              <h2>Sök efter jobb</h2>
            </div>
          </div>

          <form method="get">
            <div
              style={{
                display: "grid",
                gap: 16,
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              }}
            >
              <label>
                <span>Sökord eller roll</span>
                <input
                  defaultValue={query}
                  name="query"
                  placeholder="Till exempel IT Support"
                  type="search"
                />
              </label>

              <label>
                <span>Plats</span>
                <input
                  defaultValue={location}
                  name="location"
                  placeholder="Till exempel Jönköping"
                  type="search"
                />
              </label>

              <label>
                <span>Antal resultat</span>
                <select defaultValue={String(limit)} name="limit">
                  <option value="5">5</option>
                  <option value="10">10</option>
                  <option value="20">20</option>
                  <option value="50">50</option>
                </select>
              </label>
            </div>

            <div style={{ marginTop: 20 }}>
              <button type="submit">Sök jobb</button>
            </div>
          </form>
        </section>

        {applicationError ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Ansökan kunde inte startas</strong>
              <p>{formatApplicationError(applicationError)}</p>
            </div>
          </section>
        ) : null}

        {result?.ok &&
        selectedCandidate &&
        matchingResult &&
        !matchingResult.ok &&
        matchingResult.code === "PROFILE_NOT_FOUND" ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Kandidatprofil saknas</strong>
              <p>
                Lägg till profilinformation för att analysera jobbmatchning för{" "}
                {selectedCandidate.displayName}.
              </p>
            </div>
          </section>
        ) : null}

        {result?.ok &&
        selectedCandidate &&
        matchingResult &&
        !matchingResult.ok &&
        matchingResult.code !== "PROFILE_NOT_FOUND" ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Jobbmatchningen kunde inte analyseras</strong>
              <p>Ett tekniskt fel uppstod när kandidatprofilen analyserades.</p>
            </div>
          </section>
        ) : null}

        {!hasSearch ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Börja med en jobbsökning</strong>
              <p>
                Ange en roll, ett sökord eller en plats för att hitta jobb.
              </p>
            </div>
          </section>
        ) : result && !result.ok ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Jobbsökningen kunde inte genomföras</strong>
              <p>{formatSearchError(result.code)}</p>
            </div>
          </section>
        ) : result && result.jobs.length === 0 ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Inga relevanta jobb hittades</strong>
              <p>Prova ett annat sökord eller en annan plats.</p>
            </div>
          </section>
        ) : result ? (
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Resultat</p>
                <h2>
                  {rankedJobs
                    ? `${rankedJobs.length} analyserade jobb`
                    : `${result.jobs.length} relevanta jobb`}
                </h2>
              </div>
            </div>

            <div className={styles.candidateList}>
              {rankedJobs
                ? rankedJobs.map((ranked) => {
                    const job = ranked.job;

                    return (
                      <article
                        className={styles.jobResult}
                        key={`${job.source}:${job.id}`}
                      >
                        <div className={styles.jobResultHeader}>
                          <strong>{job.title}</strong>
                          <p>{job.company ?? "Företag saknas"}</p>
                          <p>
                            Matchningsgrad: <strong>{ranked.score}/100</strong>
                          </p>
                        </div>

                        <div className={styles.candidateMeta}>
                          <span>{job.location ?? "Plats saknas"}</span>
                          <span>Källa: {formatSourceName(job.source)}</span>

                          {job.url ? (
                            <a
                              href={job.url}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Visa jobb
                            </a>
                          ) : null}
                        </div>

                        <details className={styles.analysisDetails}>
                          <summary>Visa matchningsanalys</summary>

                          <div className={styles.analysisGrid}>
                            <section className={styles.analysisSection}>
                              <h4>Varför jobbet matchar</h4>
                              <ul>
                                {ranked.matchingResult.matched.flatMap(formatEvidence).map((item, index) => (
                                  <li key={`${item}:${index}`}>{item}</li>
                                ))}
                              </ul>
                            </section>

                            <section className={styles.analysisSection}>
                              <h4>Matchade krav</h4>
                              <ul>
                                {ranked.matchingResult.matched
                                  .flatMap((evidence) => evidence.requirementCoverage?.matchedRequirements ?? [])
                                  .map((requirement, index) => (
                                    <li key={`${requirement}:${index}`}>{requirement}</li>
                                  ))}
                                {ranked.skillGapResult.strengths.map((strength, index) => (
                                  <li key={`${strength.title}:${index}`}>{strength.title}</li>
                                ))}
                              </ul>
                            </section>

                            <section className={styles.analysisSection}>
                              <h4>Saknade krav / utvecklingsområden</h4>
                              <ul>
                                {ranked.matchingResult.missing.flatMap(formatEvidence).map((item, index) => (
                                  <li key={`${item}:${index}`}>{item}</li>
                                ))}
                              </ul>
                            </section>

                            <section className={styles.analysisSection}>
                              <h4>Information som saknas för bedömning</h4>
                              <ul>
                                {ranked.matchingResult.unknown.map((evidence, index) => (
                                  <li key={`${evidence.dimension}:match:${index}`}>
                                    {formatDimension(evidence.dimension)}
                                  </li>
                                ))}
                                {ranked.skillGapResult.unknowns.map((unknown, index) => (
                                  <li key={`${unknown.dimension}:gap:${index}`}>
                                    {formatDimension(unknown.dimension)}
                                  </li>
                                ))}
                              </ul>
                            </section>

                            <section className={styles.analysisSection}>
                              <h4>Motstridig information</h4>
                              <ul>
                                {ranked.matchingResult.conflicting.flatMap(formatEvidence).map((item, index) => (
                                  <li key={`${item}:${index}`}>{item}</li>
                                ))}
                              </ul>
                            </section>

                            <section className={styles.analysisSection}>
                              <h4>Kompetensgap</h4>
                              <ul>
                                {ranked.skillGapResult.gaps.map((gap) => (
                                  <li key={`${gap.type}:${gap.jobRequirement}`}>
                                    <strong>{formatRequirement(gap.jobRequirement)}</strong>
                                    <span>
                                      {formatGapType(gap.type)} · {formatSeverity(gap.severity)}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </section>

                            <section className={styles.analysisSection}>
                              <h4>Rekommenderad utveckling</h4>
                              <ol>
                                {ranked.skillGapResult.recommendations.map((recommendation) => (
                                  <li key={recommendation.title}>
                                    Fokusera på {recommendation.targetGaps
                                      .map((targetGap) => ranked.skillGapResult.gaps.find((gap) => gap.title === targetGap))
                                      .filter((gap): gap is NonNullable<typeof gap> => Boolean(gap))
                                      .map((gap) => formatRequirement(gap.jobRequirement))
                                      .join(", ") || "identifierade kompetensgap"}
                                  </li>
                                ))}
                              </ol>
                            </section>
                          </div>

                          <p className={styles.analysisConfidence}>
                            Underlagets täckning: {Math.round(ranked.scoringBreakdown.confidence * 100)}% · {formatSeverity(ranked.scoringBreakdown.confidenceLabel)}
                          </p>
                        </details>

                        <div className={styles.applicationStart}>
                          <form action={startApplicationAction}>
                            <input
                              type="hidden"
                              name="jobId"
                              value={job.id}
                            />
                            <input type="hidden" name="query" value={query} />
                            <input
                              type="hidden"
                              name="location"
                              value={location}
                            />
                            <input
                              type="hidden"
                              name="limit"
                              value={String(limit)}
                            />
                            <button type="submit">Skapa ansökan</button>
                          </form>
                          <p>
                            Ansökan skapas i AI Career Agent. Du skickar inget
                            till arbetsgivaren ännu.
                          </p>
                        </div>
                      </article>
                    );
                  })
                : result.jobs.map((job) => (
                    <article
                      className={styles.candidateRow}
                      key={`${job.source}:${job.id}`}
                    >
                      <div>
                        <strong>{job.title}</strong>
                        <p>{job.company ?? "Företag saknas"}</p>
                      </div>

                      <div className={styles.candidateMeta}>
                        <span>{job.location ?? "Plats saknas"}</span>
                        <span>Källa: {formatSourceName(job.source)}</span>

                        {job.url ? (
                          <a
                            href={job.url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Visa jobb
                          </a>
                        ) : null}
                      </div>
                    </article>
                  ))}
            </div>

            {matchingResult?.ok ? (
              <section className={styles.learningPlan}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.eyebrow}>Plan för utveckling</p>
                    <h3>Befintlig lärandeplan</h3>
                  </div>
                  <span>{matchingResult.analysis.learningPlan.totalGaps} prioriterade gap</span>
                </div>

                {matchingResult.analysis.learningPlan.prioritizedGaps.length === 0 ? (
                  <p>Inga bekräftade kompetensgap identifierades bland de analyserade jobben.</p>
                ) : (
                  <ol className={styles.learningPlanList}>
                    {matchingResult.analysis.learningPlan.prioritizedGaps.map((gap) => (
                      <li key={gap.canonicalKey}>
                        <div>
                          <strong>{gap.skill}</strong>
                          <span>
                            {formatSeverity(gap.severity)} · {gap.frequencyScore}% av jobben · påverkan {gap.impactScore}%
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
