import Link from "next/link";

import { analyzeJobsForCandidate } from "@/lib/candidate-job-matching";
import { loadCandidateProfileRepository } from "@/lib/candidate-profiles";
import { loadCoachCandidates } from "@/lib/coach-candidates";
import { searchWebJobs } from "@/lib/jobs";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

interface JobsPageProps {
  searchParams: Promise<{
    candidateId?: string;
    query?: string;
    location?: string;
    limit?: string;
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

  const candidateId = firstValue(params.candidateId);
  const query = firstValue(params.query);
  const location = firstValue(params.location);
  const limit = parseLimit(params.limit);

  const candidatesResult = await loadCoachCandidates();
  const selectedCandidate = candidatesResult.candidates.find(
    (candidate) => candidate.id === candidateId,
  );

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
          <Link href="/candidates">Kandidater</Link>
          <Link href="/applications">Ansökningar</Link>
          <Link href="/coach">Jobbcoach</Link>
          <Link href="/reports">Rapporter</Link>
          <Link href="/analytics">Analys</Link>
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
              Sök efter relevanta jobb och analysera matchningen mot en vald
              kandidatprofil.
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
                <span>Kandidat</span>
                <select defaultValue={candidateId} name="candidateId">
                  <option value="">Ingen kandidat vald</option>
                  {candidatesResult.candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.displayName}
                    </option>
                  ))}
                </select>
              </label>

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

        {!candidatesResult.configured ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Jobbcoachens arbetsyta är inte konfigurerad</strong>
              <p>
                Jobbsökning fungerar fortfarande, men kandidatmatchning kräver
                att COACH_DIR är konfigurerad.
              </p>
            </div>
          </section>
        ) : candidatesResult.error ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Kandidaterna kunde inte laddas</strong>
              <p>Kandidatmatchning är inte tillgänglig just nu.</p>
            </div>
          </section>
        ) : candidateId && !selectedCandidate ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Den valda kandidaten finns inte</strong>
              <p>Välj en kandidat från listan och försök igen.</p>
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
