import Link from "next/link";

import { loadCoachPortfolioAnalytics, loadJobSearchAnalytics, parseAnalyticsPeriod } from "@/lib/analytics";
import { loadCoachCandidates } from "@/lib/coach-candidates";
import { configuredAuthorizationDependencies, getAuthorizedCandidateContext } from "@/lib/authorization";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

interface AnalyticsPageProps {
  searchParams: Promise<{
    start?: string;
    end?: string;
    asOf?: string;
  }>;
}

function toStartTimestamp(value: string) {
  return `${value}T00:00:00.000Z`;
}

function toEndTimestamp(value: string) {
  return `${value}T00:00:00.000Z`;
}

function formatRate(value: number | null) {
  if (value === null) {
    return "—";
  }

  return `${(value * 100).toFixed(1)}%`;
}

function formatDuration(milliseconds: number | null) {
  if (milliseconds === null) {
    return "—";
  }

  const days = milliseconds / (1000 * 60 * 60 * 24);

  if (days >= 1) {
    return `${days.toFixed(1)} days`;
  }

  const hours = milliseconds / (1000 * 60 * 60);

  return `${hours.toFixed(1)} hours`;
}

export default async function AnalyticsPage({
  searchParams,
}: AnalyticsPageProps) {
  const authorization = configuredAuthorizationDependencies();
  if (!authorization.ok) return <main className={styles.main}><section className={styles.panel}><h1>Analysvyn kunde inte visas</h1><p>Resursen kunde inte hittas.</p></section></main>;
  if (authorization.ok && (await getAuthorizedCandidateContext(authorization.value)).ok) return <main className={styles.main}><section className={styles.panel}><h1>Analysvyn kunde inte visas</h1><p>Portföljanalys för flera kandidater är inte tillgänglig för jobbsökare.</p></section></main>;
  const query = await searchParams;

  const period = parseAnalyticsPeriod(query);
  const start = period.ok ? period.value.start : "2026-01-01";
  const end = period.ok ? period.value.end : "2027-01-01";
  const asOfDate = period.ok ? period.value.asOf : end;

  const [result, candidateResult, jobAnalytics] = await Promise.all([
    loadCoachPortfolioAnalytics(
      toStartTimestamp(start),
      toEndTimestamp(end),
      toStartTimestamp(asOfDate),
    ),
    loadCoachCandidates(),
    loadJobSearchAnalytics(),
  ]);

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.logoMark}>AC</div>

          <div>
            <strong>AI Career Agent</strong>
            <span>Sweden Preview</span>
          </div>
        </div>

        <nav className={styles.nav}>
          <Link href="/">Översikt</Link>
          <Link href="/jobs">Jobb</Link>
          <Link href="/candidates">Kandidater</Link>
          <Link href="/applications">Ansökningar</Link>
          <Link href="/coach">Jobbcoach</Link>
          <Link href="/reports">Rapporter</Link>
          <Link className={styles.active} href="/analytics">
            Analys
          </Link>
        </nav>

        <div className={styles.sidebarFooter}>
          <span>Lokal förhandsversion</span>
          <small>Ingen molnsynkronisering</small>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Härledd faktabaserad analys</p>
            <h1>Analys</h1>

            <p className={styles.subtitle}>
              Analys på portföljnivå baserad på befintliga ansökningar,
              uppföljningar och jobbcoachaktiviteter.
            </p>
          </div>

          <div className={styles.status}>
            <span className={styles.statusDot} />
            Local repository
          </div>
        </header>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Analysperiod</p>
              <h2>
                {start} → {end}
              </h2>
            </div>
          </div>

          <form method="get" className={styles.reportFilters}>
            <label>
              <span>Startdatum</span>
              <input type="date" name="start" defaultValue={start} />
            </label>

            <label>
              <span>Slutdatum</span>
              <input type="date" name="end" defaultValue={end} />
            </label>

            <label>
              <span>Per datum</span>
              <input type="date" name="asOf" defaultValue={asOfDate} />
            </label>

            <button type="submit">Ladda analys</button>
            <Link href="/analytics">Visa all tillgänglig data</Link>
          </form>
        </section>
        {!period.ok && <section className={styles.panel}><div className={styles.emptyState}><strong>Analysperioden kunde inte användas</strong><p>Ange giltiga datum där startdatumet infaller före slutdatumet.</p></div></section>}

        {!result.configured ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Analysarkiven är inte konfigurerade</strong>
              <p>
                Ange COACH_DIR och APPLICATION_REPOSITORY för att läsa analysen.
              </p>
            </div>
          </section>
        ) : result.error ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Analysen kunde inte genereras</strong>
              <p role="alert">Analysunderlaget kunde inte verifieras. Kontrollera den valda perioden och försök igen.</p>
            </div>
          </section>
        ) : result.analytics ? (
          <>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Portfolio</p>
                  <h2>Kandidatöversikt</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                <article className={styles.candidateRow}>
                  <strong>Totalt antal kandidater</strong>
                  <span>{result.analytics.candidates.total}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Med ansökningar</strong>
                  <span>{result.analytics.candidates.withApplications}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Med uppföljningar</strong>
                  <span>{result.analytics.candidates.withFollowUps}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Med jobbcoachaktiviteter</strong>
                  <span>{result.analytics.candidates.withCoachActivities}</span>
                </article>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}><div><p className={styles.eyebrow}>Jobbfakta</p><h2>Jobb som finns i ansökningar</h2></div></div>
              <p className={styles.subtitle}>Tidsfilter gäller inte denna sektion. Uppgifterna bygger på alla sparade ansökningar; sökhistorik spåras inte.</p>
              {!jobAnalytics.configured ? <div className={styles.emptyState}><strong>Jobbanalys är inte konfigurerad</strong><p>Ansökningsarkivet kunde inte läsas.</p></div> : jobAnalytics.error ? <div className={styles.emptyState}><strong>Jobbanalys kunde inte läsas</strong><p>Försök igen senare.</p></div> : jobAnalytics.analytics ? <>
                <p className={styles.subtitle}>Statistiken bygger på jobb som har blivit en del av dina sparade ansökningar. Sökningar som inte ledde till en ansökan sparas inte som historik.</p>
                <div className={styles.candidateList}><article className={styles.candidateRow}><strong>Jobb representerade</strong><span>{jobAnalytics.analytics.totalJobsRepresented}</span></article><article className={styles.candidateRow}><strong>Sök historik</strong><span>Inte spårad</span></article></div>
                {jobAnalytics.analytics.totalJobsRepresented > 0 && <div className={styles.candidateList}><article className={styles.candidateRow}><strong>Källor</strong><span>{jobAnalytics.analytics.sourceDistribution.map((item) => `${item.label}: ${item.count}`).join(" · ")}</span></article><article className={styles.candidateRow}><strong>Platser</strong><span>{jobAnalytics.analytics.locationDistribution.map((item) => `${item.label}: ${item.count}`).join(" · ")}</span></article><article className={styles.candidateRow}><strong>Roller</strong><span>{jobAnalytics.analytics.titleDistribution.map((item) => `${item.label}: ${item.count}`).join(" · ")}</span></article><article className={styles.candidateRow}><strong>Matchningsläge</strong><span>Matchade: {jobAnalytics.analytics.matching.matchedRequirements} · Saknade: {jobAnalytics.analytics.matching.missingRequirements} · Motstridiga: {jobAnalytics.analytics.matching.conflictingRequirements} · Okända: {jobAnalytics.analytics.matching.unknownRequirements}</span></article></div>}
              </> : null}
            </section>
            {candidateResult.configured &&
            !candidateResult.error &&
            candidateResult.candidates.length > 0 ? (
              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.eyebrow}>Kandidater</p>
                    <h2>Kandidatanalys</h2>
                  </div>
                </div>

                <div className={styles.candidateList}>
                  {candidateResult.candidates.map((candidate) => (
                    <Link
                      className={styles.candidateRow}
                      href={`/analytics/${encodeURIComponent(candidate.id)}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&asOf=${encodeURIComponent(asOfDate)}`}
                      key={candidate.id}
                    >
                      <div>
                        <strong>{candidate.displayName}</strong>
                        <p>{candidate.id}</p>
                      </div>

                      <span>Visa analys</span>
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Ansökningar</p>
                  <h2>Ansökningarnas historiska flöde</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                <article className={styles.candidateRow}>
                  <strong>Totalt antal ansökningar</strong>
                  <span>{result.analytics.applications.total}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Nådde ansökt</strong>
                  <span>{result.analytics.applications.reachedApplied}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Nådde intervju</strong>
                  <span>{result.analytics.applications.reachedInterview}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Nådde erbjudande</strong>
                  <span>{result.analytics.applications.reachedOffer}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Ansökan → ansökt</strong>
                  <span>
                    {formatRate(
                      result.analytics.applications.funnel
                        .applicationToApplied.rate,
                    )}
                  </span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Ansökt → intervju</strong>
                  <span>
                    {formatRate(
                      result.analytics.applications.funnel.appliedToInterview
                        .rate,
                    )}
                  </span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Intervju → erbjudande</strong>
                  <span>
                    {formatRate(
                      result.analytics.applications.funnel.interviewToOffer
                        .rate,
                    )}
                  </span>
                </article>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Uppföljningar</p>
                  <h2>Uppföljningsläge</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                <article className={styles.candidateRow}>
                  <strong>Totalt antal uppföljningar</strong>
                  <span>{result.analytics.followUps.total}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Slutförda</strong>
                  <span>{result.analytics.followUps.completed}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Ej slutförda</strong>
                  <span>{result.analytics.followUps.incomplete}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Öppna per datum</strong>
                  <span>{result.analytics.followUps.stateAsOf.open}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Försenade per datum</strong>
                  <span>{result.analytics.followUps.stateAsOf.overdue}</span>
                </article>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Jobbcoachaktiviteter</p>
                  <h2>Aktivitetsläge</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                <article className={styles.candidateRow}>
                  <strong>Totalt antal aktiviteter</strong>
                  <span>{result.analytics.coachActivities.total}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Slutförda</strong>
                  <span>{result.analytics.coachActivities.completed}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Avbrutna</strong>
                  <span>{result.analytics.coachActivities.cancelled}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Planerade per datum</strong>
                  <span>{result.analytics.coachActivities.stateAsOf.planned}</span>
                </article>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Tidsmått</p>
                  <h2>Tid till ansökningssteg</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                <article className={styles.candidateRow}>
                  <strong>Genomsnittlig tid till ansökt</strong>
                  <span>
                    {formatDuration(
                      result.analytics.applicationTiming.timeToApplied
                        .averageMilliseconds,
                    )}
                  </span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Genomsnittlig tid till intervju</strong>
                  <span>
                    {formatDuration(
                      result.analytics.applicationTiming.timeToInterview
                        .averageMilliseconds,
                    )}
                  </span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Genomsnittlig tid till erbjudande</strong>
                  <span>
                    {formatDuration(
                      result.analytics.applicationTiming.timeToOffer
                        .averageMilliseconds,
                    )}
                  </span>
                </article>
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
