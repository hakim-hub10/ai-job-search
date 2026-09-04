import Link from "next/link";

import { loadCoachPortfolioAnalytics } from "@/lib/analytics";
import { loadCoachCandidates } from "@/lib/coach-candidates";
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
  const query = await searchParams;

  const start = query.start ?? "2026-01-01";
  const end = query.end ?? "2027-01-01";
  const asOfDate = query.asOf ?? end;

  const [result, candidateResult] = await Promise.all([
    loadCoachPortfolioAnalytics(
      toStartTimestamp(start),
      toEndTimestamp(end),
      toStartTimestamp(asOfDate),
    ),
    loadCoachCandidates(),
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
          <Link href="/">Dashboard</Link>
          <span title="Coming soon">Jobs</span>
          <Link href="/candidates">Candidates</Link>
          <Link href="/applications">Applications</Link>
          <Link href="/coach">Coach</Link>
          <Link href="/reports">Reports</Link>
          <Link className={styles.active} href="/analytics">
            Analytics
          </Link>
        </nav>

        <div className={styles.sidebarFooter}>
          <span>Local Preview</span>
          <small>No cloud sync</small>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Derived factual analytics</p>
            <h1>Analytics</h1>

            <p className={styles.subtitle}>
              Portfolio-level analytics derived from existing applications,
              follow-ups and coach activities.
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
              <p className={styles.eyebrow}>Analytics window</p>
              <h2>
                {start} → {end}
              </h2>
            </div>
          </div>

          <form method="get" className={styles.reportFilters}>
            <label>
              <span>Start date</span>
              <input type="date" name="start" defaultValue={start} />
            </label>

            <label>
              <span>End date</span>
              <input type="date" name="end" defaultValue={end} />
            </label>

            <label>
              <span>As of</span>
              <input type="date" name="asOf" defaultValue={asOfDate} />
            </label>

            <button type="submit">Load analytics</button>
          </form>
        </section>

        {!result.configured ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Analytics repositories not configured</strong>
              <p>
                Both COACH_DIR and APPLICATION_REPOSITORY are required to load
                analytics.
              </p>
            </div>
          </section>
        ) : result.error ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Analytics could not be generated</strong>
              <pre>{JSON.stringify(result.error, null, 2)}</pre>
            </div>
          </section>
        ) : result.analytics ? (
          <>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Portfolio</p>
                  <h2>Candidate coverage</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                <article className={styles.candidateRow}>
                  <strong>Total candidates</strong>
                  <span>{result.analytics.candidates.total}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>With applications</strong>
                  <span>{result.analytics.candidates.withApplications}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>With follow-ups</strong>
                  <span>{result.analytics.candidates.withFollowUps}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>With coach activities</strong>
                  <span>{result.analytics.candidates.withCoachActivities}</span>
                </article>
              </div>
            </section>

            {candidateResult.configured &&
            !candidateResult.error &&
            candidateResult.candidates.length > 0 ? (
              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.eyebrow}>Candidates</p>
                    <h2>Candidate analytics</h2>
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

                      <span>View analytics</span>
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Applications</p>
                  <h2>Outcome funnel</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                <article className={styles.candidateRow}>
                  <strong>Total applications</strong>
                  <span>{result.analytics.applications.total}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Reached applied</strong>
                  <span>{result.analytics.applications.reachedApplied}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Reached interview</strong>
                  <span>{result.analytics.applications.reachedInterview}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Reached offer</strong>
                  <span>{result.analytics.applications.reachedOffer}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Application → applied</strong>
                  <span>
                    {formatRate(
                      result.analytics.applications.funnel
                        .applicationToApplied.rate,
                    )}
                  </span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Applied → interview</strong>
                  <span>
                    {formatRate(
                      result.analytics.applications.funnel.appliedToInterview
                        .rate,
                    )}
                  </span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Interview → offer</strong>
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
                  <p className={styles.eyebrow}>Follow-ups</p>
                  <h2>Current and historical state</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                <article className={styles.candidateRow}>
                  <strong>Total follow-ups</strong>
                  <span>{result.analytics.followUps.total}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Completed</strong>
                  <span>{result.analytics.followUps.completed}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Incomplete</strong>
                  <span>{result.analytics.followUps.incomplete}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Open as of date</strong>
                  <span>{result.analytics.followUps.stateAsOf.open}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Overdue as of date</strong>
                  <span>{result.analytics.followUps.stateAsOf.overdue}</span>
                </article>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Coach activities</p>
                  <h2>Activity state</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                <article className={styles.candidateRow}>
                  <strong>Total activities</strong>
                  <span>{result.analytics.coachActivities.total}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Completed</strong>
                  <span>{result.analytics.coachActivities.completed}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Cancelled</strong>
                  <span>{result.analytics.coachActivities.cancelled}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Planned as of date</strong>
                  <span>{result.analytics.coachActivities.stateAsOf.planned}</span>
                </article>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Timing</p>
                  <h2>Application milestones</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                <article className={styles.candidateRow}>
                  <strong>Average time to applied</strong>
                  <span>
                    {formatDuration(
                      result.analytics.applicationTiming.timeToApplied
                        .averageMilliseconds,
                    )}
                  </span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Average time to interview</strong>
                  <span>
                    {formatDuration(
                      result.analytics.applicationTiming.timeToInterview
                        .averageMilliseconds,
                    )}
                  </span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Average time to offer</strong>
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
