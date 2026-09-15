import Link from "next/link";
import { MatchConfidenceSummary } from "@/components/match-confidence-summary";
import { buildMatchExplanationSummary, conflictingGapItems, deriveActionableRecommendations, formatDimension, missingGapItems, unknownEvidenceCase, unknownEvidenceLabel } from "@/lib/match-confidence";
import PersonalNavigation from "@/components/personal-navigation";

import { analyzeJobsForCandidate } from "@/lib/candidate-job-matching";
import { loadCandidateProfileRepository } from "@/lib/candidate-profiles";
import { searchWebJobs } from "@/lib/jobs";
import { applicationErrorHeading, formatApplicationError, shouldShowApplicationError } from "@/lib/application-error-messages";
import styles from "../page.module.css";
import { startApplicationAction } from "./actions";
import { configuredAuthorizationDependencies, getAuthorizedCandidateContext, requireOwnedApplication } from "@/lib/authorization";

export const dynamic = "force-dynamic";

interface JobsPageProps {
  searchParams: Promise<{
    query?: string;
    location?: string;
    limit?: string;
    applicationError?: string;
    duplicateApplicationId?: string;
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

const severityLabels: Record<string, string> = {
  critical: "Kritisk",
  high: "Hög",
  medium: "Medel",
  low: "Låg",
};

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

export default async function JobsPage({ searchParams }: JobsPageProps) {
  const params = await searchParams;

  const query = firstValue(params.query);
  const location = firstValue(params.location);
  const limit = parseLimit(params.limit);
  const applicationError = firstValue(params.applicationError);
  const duplicateApplicationId = firstValue(params.duplicateApplicationId);

  const authorization = configuredAuthorizationDependencies();
  if (!authorization.ok) return <main className={styles.main}><section className={styles.panel}><h1>Jobb kunde inte visas</h1><p>Resursen kunde inte hittas.</p></section></main>;
  const authorized = await getAuthorizedCandidateContext(authorization.value);
  if (!authorized.ok) return <main className={styles.main}><section className={styles.panel}><h1>Jobb kunde inte visas</h1><p>Logga in igen eller försök senare.</p></section></main>;
  const selectedCandidate = authorized.value.candidate;

  // A DUPLICATE_APPLICATION banner is carried entirely in the URL (redirect
  // query params), so a stale link - browser back/forward, a bookmark, a
  // lingering tab - can still point at it after the referenced application
  // was deleted. Re-check live ownership before showing it; if the
  // application is gone, the warning is obsolete and must not render.
  const duplicateApplicationStillExists = applicationError === "DUPLICATE_APPLICATION" && duplicateApplicationId
    ? (await requireOwnedApplication(duplicateApplicationId, authorization.value)).ok
    : true;
  const showApplicationError = shouldShowApplicationError(applicationError, duplicateApplicationStillExists);

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
            <span>Sverige</span>
          </div>
        </div>

        <PersonalNavigation candidateId={authorized.value.candidate.id} active="jobs" />

        <div className={styles.sidebarFooter}>
          <span>Personlig arbetsyta</span>
          <small>Din jobbsökning</small>
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

        {showApplicationError ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>{applicationErrorHeading(applicationError)}</strong>
              <p>{formatApplicationError(applicationError)}</p>
              {applicationError === "DUPLICATE_APPLICATION" ? (
                duplicateApplicationId ? (
                  <Link href={`/applications/${encodeURIComponent(duplicateApplicationId)}`}>
                    Visa min ansökan
                  </Link>
                ) : (
                  <Link href="/applications">Visa mina ansökningar</Link>
                )
              ) : null}
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
                          <MatchConfidenceSummary ranked={ranked} />
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

                          {(() => {
                            const matchExplanation = buildMatchExplanationSummary(ranked, job);
                            return (
                              <section className={styles.analysisSection} aria-label="Matchningsförklaring">
                                <h4>Matchningsförklaring</h4>
                                <p>Matchningsgrad: {matchExplanation.scoreLabel}</p>
                                {matchExplanation.matched.length > 0 ? <p>Matchar: {matchExplanation.matched.join(", ")}</p> : null}
                                {matchExplanation.missingVerified.length > 0 ? <p>Saknade verifierade krav: {matchExplanation.missingVerified.join(", ")}</p> : null}
                                {matchExplanation.candidateUncertain.length > 0 ? <p>Osäkert kandidatunderlag: {matchExplanation.candidateUncertain.join(", ")}</p> : null}
                                {matchExplanation.jobUnspecified.length > 0 ? <p>Ej angivet i annonsen: {matchExplanation.jobUnspecified.join(", ")}</p> : null}
                                {matchExplanation.conflicting.length > 0 ? <p>Motstridigt: {matchExplanation.conflicting.join(", ")}</p> : null}
                              </section>
                            );
                          })()}

                          <div className={styles.analysisGrid}>
                            <section className={styles.analysisSection}>
                              <h4>Varför jobbet matchar</h4>
                              <ul>
                                {ranked.matchingResult.matched.flatMap(formatEvidence).map((item, index) => (
                                  <li key={`${item}:${index}`}>{item}</li>
                                ))}
                              </ul>
                            </section>

                            {(() => {
                              // One unified, candidate-facing area for everything the
                              // candidate could act on - built only from the existing
                              // MatchingResult-derived helpers (missingGapItems,
                              // conflictingGapItems, unknownEvidenceCase), never a
                              // parallel analysis pipeline. SkillGapResult's own gap
                              // list is not repeated here: for the dimensions it
                              // covers, MatchingResult's missing/unknown evidence
                              // already carries the same (and, for targetRole/location/
                              // remotePreference/employmentType/preferredIndustries,
                              // strictly more complete) information - showing both
                              // would duplicate the same issue in two cards.
                              const missingItems = ranked.matchingResult.missing.flatMap(missingGapItems);
                              const conflictingItems = ranked.matchingResult.conflicting.flatMap(conflictingGapItems);
                              const uncertainEvidence = ranked.matchingResult.unknown.filter((evidence) => unknownEvidenceCase(evidence, job) === "candidateUncertain");
                              const unspecifiedEvidence = ranked.matchingResult.unknown.filter((evidence) => unknownEvidenceCase(evidence, job) === "jobUnspecified");
                              const hasActionableGaps = missingItems.length > 0 || conflictingItems.length > 0 || uncertainEvidence.length > 0;
                              return (
                                <>
                                  <section className={styles.analysisSection} aria-label="Vad behöver du komplettera eller verifiera?">
                                    <h4>Vad behöver du komplettera eller verifiera?</h4>
                                    {!hasActionableGaps ? (
                                      <p className={styles.analysisSectionHint}>Inga kandidatsidiga gap eller osäkerheter identifierades för den här annonsen, utifrån din verifierade profil.</p>
                                    ) : (
                                      <>
                                        {missingItems.length > 0 ? (
                                          <div>
                                            <p className={styles.analysisSectionHint}><strong>Saknade verifierade krav</strong> - annonsen ställer detta krav uttryckligen, och det saknas i din verifierade profil.</p>
                                            <ul>
                                              {missingItems.map((item, index) => (
                                                <li key={`missing:${item.title}:${index}`}>
                                                  <strong>{item.title}</strong>
                                                  <span>{item.description}</span>
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        ) : null}
                                        {conflictingItems.length > 0 ? (
                                          <div>
                                            <p className={styles.analysisSectionHint}><strong>Motstridig information</strong> - din verifierade profil motsäger direkt vad annonsen anger.</p>
                                            <ul>
                                              {conflictingItems.map((item, index) => (
                                                <li key={`conflicting:${item.title}:${index}`}>
                                                  <strong>{item.title}</strong>
                                                  <span>{item.description}</span>
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        ) : null}
                                        {uncertainEvidence.length > 0 ? (
                                          <div>
                                            <p className={styles.analysisSectionHint}><strong>Osäkert kandidatunderlag</strong> - annonsen nämner kravet, men din profil ger inte tillräckligt underlag för en säker bedömning.</p>
                                            <ul>
                                              {uncertainEvidence.map((evidence, index) => (
                                                <li key={`uncertain:${evidence.dimension}:${index}`}>
                                                  <strong>{formatDimension(evidence.dimension)}</strong>
                                                  <span>{unknownEvidenceLabel(evidence, job)}</span>
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        ) : null}
                                      </>
                                    )}
                                  </section>

                                  <section className={styles.analysisSection}>
                                    <h4>Ej angivet i annonsen</h4>
                                    <p className={styles.analysisSectionHint}>Annonsen ställer inget krav här - detta är aldrig en brist hos dig.</p>
                                    {unspecifiedEvidence.length === 0 ? (
                                      <p className={styles.analysisSectionHint}>Annonsen tog upp allt underlag som kunde bedömas.</p>
                                    ) : (
                                      <ul>
                                        {unspecifiedEvidence.map((evidence, index) => (
                                          <li key={`unspecified:${evidence.dimension}:${index}`}>
                                            <strong>{formatDimension(evidence.dimension)}</strong>
                                            <span>{unknownEvidenceLabel(evidence, job)}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </section>
                                </>
                              );
                            })()}

                            <section className={styles.analysisSection}>
                              <h4>Rekommenderad utveckling</h4>
                              {(() => {
                                const recommendations = deriveActionableRecommendations(ranked.matchingResult, ranked.skillGapResult);
                                if (recommendations.length === 0) {
                                  return <p className={styles.analysisSectionHint}>Inga rekommendationer just nu - inga verifierade kompetensgap identifierades.</p>;
                                }
                                return (
                                  <ol>
                                    {recommendations.map((recommendation) => (
                                      <li key={recommendation.title}>
                                        <strong>{recommendation.title}</strong>
                                        <span>{recommendation.description}</span>
                                      </li>
                                    ))}
                                  </ol>
                                );
                              })()}
                            </section>
                          </div>

                          <p className={styles.analysisConfidence}>
                            Underlagets täckning: {Math.round(ranked.scoringBreakdown.confidence * 100)}% · {formatSeverity(ranked.scoringBreakdown.confidenceLabel)}
                          </p>

                          <p className={styles.updateProfileAction}>
                            <Link href={`/candidates/${encodeURIComponent(selectedCandidate.id)}?fromJob=${encodeURIComponent(job.id)}&fromJobTitle=${encodeURIComponent(job.title)}`}>
                              Uppdatera min profil
                            </Link>
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
