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
            <p className={styles.eyebrow}>Candidate analytics</p>
            <h1>{candidateTitle}</h1>

            <p className={styles.subtitle}>
              Derived factual analytics from the candidate&apos;s existing
              applications, follow-ups and coach activities.
            </p>

            {candidate ? (
              <p className={styles.subtitle}>Candidate ID: {candidate.id}</p>
            ) : null}
          </div>

          <Link href="/analytics">Back to analytics</Link>
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
                candidate analytics.
              </p>
            </div>
          </section>
        ) : result.error ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Candidate analytics could not be generated</strong>
              <pre>{JSON.stringify(result.error, null, 2)}</pre>
            </div>
          </section>
        ) : result.outcome && result.activity && result.time ? (
          <>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Applications</p>
                  <h2>Outcome analytics</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                <article className={styles.candidateRow}>
                  <strong>Total applications</strong>
                  <span>{result.outcome.applications.total}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Reached applied</strong>
                  <span>{result.outcome.applications.reachedApplied}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Reached interview</strong>
                  <span>{result.outcome.applications.reachedInterview}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Reached offer</strong>
                  <span>{result.outcome.applications.reachedOffer}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Rejected</strong>
                  <span>{result.outcome.applications.rejected}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Withdrawn</strong>
                  <span>{result.outcome.applications.withdrawn}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Closed</strong>
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
                  <strong>Applied → interview</strong>
                  <span>
                    {formatRate(
                      result.outcome.funnel.appliedToInterview.rate,
                    )}
                  </span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Interview → offer</strong>
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
                  <p className={styles.eyebrow}>Follow-ups</p>
                  <h2>Activity analytics</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                <article className={styles.candidateRow}>
                  <strong>Total follow-ups</strong>
                  <span>{result.activity.followUps.total}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Completed</strong>
                  <span>{result.activity.followUps.completed}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Incomplete</strong>
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
                  <p className={styles.eyebrow}>Coach activities</p>
                  <h2>Coaching activity analytics</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                <article className={styles.candidateRow}>
                  <strong>Total activities</strong>
                  <span>{result.activity.coachActivities.total}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Planned</strong>
                  <span>{result.activity.coachActivities.planned}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Completed</strong>
                  <span>{result.activity.coachActivities.completed}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Cancelled</strong>
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
                  <h2>As of {asOfDate}</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                <article className={styles.candidateRow}>
                  <strong>Open follow-ups</strong>
                  <span>{result.time.followUps.stateAsOf.open}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Overdue follow-ups</strong>
                  <span>{result.time.followUps.stateAsOf.overdue}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Completed follow-ups</strong>
                  <span>{result.time.followUps.stateAsOf.completed}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Planned coach activities</strong>
                  <span>{result.time.coachActivities.stateAsOf.planned}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Completed coach activities</strong>
                  <span>{result.time.coachActivities.stateAsOf.completed}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Cancelled coach activities</strong>
                  <span>{result.time.coachActivities.stateAsOf.cancelled}</span>
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
                      result.time.applications.timeToApplied
                        .averageMilliseconds,
                    )}
                  </span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Average time to interview</strong>
                  <span>
                    {formatDuration(
                      result.time.applications.timeToInterview
                        .averageMilliseconds,
                    )}
                  </span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Average time to offer</strong>
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
