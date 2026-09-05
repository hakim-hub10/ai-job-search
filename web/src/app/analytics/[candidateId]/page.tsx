import Link from "next/link";

import { loadCandidateAnalytics } from "@/lib/analytics";
import { loadCoachCandidates } from "@/lib/coach-candidates";
import styles from "../../page.module.css";

export const dynamic = "force-dynamic";

interface CandidateAnalyticsPageProps {
  params: Promise<{
    candidateId: string;
  }>;
  searchParams: Promise<{
    start?: string;
    end?: string;
    asOf?: string;
  }>;
}

function toTimestamp(value: string) {
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

export default async function CandidateAnalyticsPage({
  params,
  searchParams,
}: CandidateAnalyticsPageProps) {
  const { candidateId } = await params;
  const query = await searchParams;

  const start = query.start ?? "2026-01-01";
  const end = query.end ?? "2027-01-01";
  const asOfDate = query.asOf ?? end;

  const [result, candidateResult] = await Promise.all([
    loadCandidateAnalytics(
      candidateId,
      toTimestamp(start),
      toTimestamp(end),
      toTimestamp(asOfDate),
    ),
    loadCoachCandidates(),
  ]);

  const candidate =
    candidateResult.configured && !candidateResult.error
      ? candidateResult.candidates.find((item) => item.id === candidateId)
      : undefined;

  const candidateTitle = candidate?.displayName ?? candidateId;

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
            <p className={styles.eyebrow}>Kandidatanalys</p>
            <h1>{candidateTitle}</h1>

            <p className={styles.subtitle}>
              Härledd faktabaserad analys från kandidatens befintliga
              ansökningar, uppföljningar och jobbcoachaktiviteter.
            </p>

            {candidate ? (
              <p className={styles.subtitle}>Candidate ID: {candidate.id}</p>
            ) : null}
          </div>

          <Link href="/analytics">Tillbaka till analys</Link>
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
          </form>
        </section>

        {!result.configured ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Analysarkiven är inte konfigurerade</strong>

              <p>
                Both COACH_DIR and APPLICATION_REPOSITORY are required to load
                kandidatanalys.
              </p>
            </div>
          </section>
        ) : result.error ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Kandidatanalysen kunde inte genereras</strong>
              <pre>{JSON.stringify(result.error, null, 2)}</pre>
            </div>
          </section>
        ) : result.outcome && result.activity && result.time ? (
          <>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Ansökningar</p>
                  <h2>Resultatanalys</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                <article className={styles.candidateRow}>
                  <strong>Totalt antal ansökningar</strong>
                  <span>{result.outcome.applications.total}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Nådde ansökt</strong>
                  <span>{result.outcome.applications.reachedApplied}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Nådde intervju</strong>
                  <span>{result.outcome.applications.reachedInterview}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Nådde erbjudande</strong>
                  <span>{result.outcome.applications.reachedOffer}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Avslagna</strong>
                  <span>{result.outcome.applications.rejected}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Tillbakadragna</strong>
                  <span>{result.outcome.applications.withdrawn}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Avslutade</strong>
                  <span>{result.outcome.applications.closed}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Application → applied</strong>
                  <span>
                    {formatRate(
                      result.outcome.funnel.applicationToApplied
                        .rate,
                    )}
                  </span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Ansökt → intervju</strong>
                  <span>
                    {formatRate(
                      result.outcome.funnel.appliedToInterview.rate,
                    )}
                  </span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Intervju → erbjudande</strong>
                  <span>
                    {formatRate(
                      result.outcome.funnel.interviewToOffer.rate,
                    )}
                  </span>
                </article>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Uppföljningar</p>
                  <h2>Aktivitetsanalys</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                <article className={styles.candidateRow}>
                  <strong>Totalt antal uppföljningar</strong>
                  <span>{result.activity.followUps.total}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Slutförda</strong>
                  <span>{result.activity.followUps.completed}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Ej slutförda</strong>
                  <span>{result.activity.followUps.incomplete}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Completion conversion</strong>
                  <span>
                    {formatRate(
                      result.activity.followUps.completion.rate,
                    )}
                  </span>
                </article>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Jobbcoachaktiviteter</p>
                  <h2>Analys av jobbcoachaktiviteter</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                <article className={styles.candidateRow}>
                  <strong>Totalt antal aktiviteter</strong>
                  <span>{result.activity.coachActivities.total}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Planerade</strong>
                  <span>{result.activity.coachActivities.planned}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Slutförda</strong>
                  <span>{result.activity.coachActivities.completed}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Avbrutna</strong>
                  <span>{result.activity.coachActivities.cancelled}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Completion conversion</strong>
                  <span>
                    {formatRate(
                      result.activity.coachActivities.completion.rate,
                    )}
                  </span>
                </article>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Historical state</p>
                  <h2>Per {asOfDate}</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                <article className={styles.candidateRow}>
                  <strong>Öppna uppföljningar</strong>
                  <span>{result.time.followUps.stateAsOf.open}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Försenade uppföljningar</strong>
                  <span>{result.time.followUps.stateAsOf.overdue}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Slutförda uppföljningar</strong>
                  <span>{result.time.followUps.stateAsOf.completed}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Planerade jobbcoachaktiviteter</strong>
                  <span>{result.time.coachActivities.stateAsOf.planned}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Slutförda jobbcoachaktiviteter</strong>
                  <span>{result.time.coachActivities.stateAsOf.completed}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Avbrutna jobbcoachaktiviteter</strong>
                  <span>{result.time.coachActivities.stateAsOf.cancelled}</span>
                </article>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Tidsmått</p>
                  <h2>Application milestones</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                <article className={styles.candidateRow}>
                  <strong>Genomsnittlig tid till ansökt</strong>
                  <span>
                    {formatDuration(
                      result.time.applications.timeToApplied
                        .averageMilliseconds,
                    )}
                  </span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Genomsnittlig tid till intervju</strong>
                  <span>
                    {formatDuration(
                      result.time.applications.timeToInterview
                        .averageMilliseconds,
                    )}
                  </span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Genomsnittlig tid till erbjudande</strong>
                  <span>
                    {formatDuration(
                      result.time.applications.timeToOffer.averageMilliseconds,
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
