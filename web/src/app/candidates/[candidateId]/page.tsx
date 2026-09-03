import Link from "next/link";

import { loadCandidateOperationalOverview } from "@/lib/candidate-overview";
import styles from "../../page.module.css";

export const dynamic = "force-dynamic";

interface CandidatePageProps {
  params: Promise<{
    candidateId: string;
  }>;
}

function formatDate(value?: string | null) {
  if (!value) return "—";

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("sv-SE");
}

export default async function CandidatePage({
  params,
}: CandidatePageProps) {
  const { candidateId } = await params;
  const result = await loadCandidateOperationalOverview(candidateId);

  const candidate = result.candidate;
  const overview = result.overview;

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div>
          <p className={styles.eyebrow}>AI Career Agent</p>
          <h1 className={styles.brand}>Career Workspace</h1>
        </div>

        <nav className={styles.nav}>
          <Link href="/" className={styles.navItem}>
            Dashboard
          </Link>
          <span className={styles.navItem}>Jobs</span>
          <Link href="/candidates" className={`${styles.navItem} ${styles.active}`}>
            Candidates
          </Link>
          <span className={styles.navItem}>Applications</span>
          <span className={styles.navItem}>Coach</span>
          <span className={styles.navItem}>Reports</span>
        </nav>
      </aside>

      <main className={styles.main}>
        <div className={styles.topbar}>
          <div>
            <p className={styles.eyebrow}>Coach workspace</p>
            <h2>{candidate?.displayName ?? "Candidate overview"}</h2>
            <p className={styles.subtitle}>
              Operational data from the existing coach workflows.
            </p>
          </div>

          <Link href="/candidates" className={styles.secondaryButton}>
            Back to candidates
          </Link>
        </div>

        {!result.configured ? (
          <section className={styles.panel}>
            <h3>Coach workspace not configured</h3>
            <p>
              Set COACH_DIR before candidate data can be loaded.
            </p>
          </section>
        ) : result.error ? (
          <section className={styles.panel}>
            <h3>Candidate data could not be loaded</h3>
            <pre className={styles.errorBlock}>
              {JSON.stringify(result.error, null, 2)}
            </pre>
          </section>
        ) : !candidate ? (
          <section className={styles.panel}>
            <h3>Candidate not found</h3>
            <p>No candidate record was found for {candidateId}.</p>
          </section>
        ) : (
          <>
            <section className={styles.panel}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>Candidate</p>
                  <h3>{candidate.displayName}</h3>
                </div>
              </div>

              <div className={styles.candidateMeta}>
                <span>ID: {candidate.id}</span>
                <span>Created: {formatDate(candidate.createdAt)}</span>
                <span>Updated: {formatDate(candidate.updatedAt)}</span>
              </div>
            </section>

            {!result.applicationRepositoryConfigured ? (
              <section className={styles.panel}>
                <h3>Application repository not configured</h3>
                <p>
                  Candidate metadata is available, but operational application,
                  follow-up, goal, and activity data requires
                  APPLICATION_REPOSITORY.
                </p>
              </section>
            ) : overview ? (
              <>
                <section className={styles.statsGrid}>
                  <article className={styles.statCard}>
                    <p>Goals planned</p>
                    <strong>{overview.goalCounts.planned}</strong>
                  </article>

                  <article className={styles.statCard}>
                    <p>Goals in progress</p>
                    <strong>{overview.goalCounts.inProgress}</strong>
                  </article>

                  <article className={styles.statCard}>
                    <p>Overdue goals</p>
                    <strong>{overview.goalCounts.overdue}</strong>
                  </article>

                  <article className={styles.statCard}>
                    <p>Planned activities</p>
                    <strong>{overview.activityCounts.planned}</strong>
                  </article>
                </section>

                <div className={styles.dashboardGrid}>
                  <section className={styles.panel}>
                    <div className={styles.sectionHeading}>
                      <h3>Goals</h3>
                      <span>{overview.goals.length}</span>
                    </div>

                    {overview.goals.length === 0 ? (
                      <p>No goals found.</p>
                    ) : (
                      <div className={styles.candidateList}>
                        {overview.goals.map((goal) => (
                          <article key={goal.id} className={styles.candidateRow}>
                            <div>
                              <strong>{goal.title}</strong>
                              <div className={styles.candidateMeta}>
                                <span>Status: {goal.status}</span>
                                <span>Due: {formatDate(goal.dueAt)}</span>
                                {goal.overdue ? <span>Overdue</span> : null}
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className={styles.panel}>
                    <div className={styles.sectionHeading}>
                      <h3>Activities</h3>
                      <span>{overview.activities.length}</span>
                    </div>

                    {overview.activities.length === 0 ? (
                      <p>No activities found.</p>
                    ) : (
                      <div className={styles.candidateList}>
                        {overview.activities.map((activity) => (
                          <article
                            key={activity.id}
                            className={styles.candidateRow}
                          >
                            <div>
                              <strong>{activity.kind}</strong>
                              <div className={styles.candidateMeta}>
                                <span>Status: {activity.status}</span>
                                <span>
                                  Planned: {formatDate(activity.plannedAt)}
                                </span>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                </div>

                <section className={styles.panel}>
                  <div className={styles.sectionHeading}>
                    <h3>Next planned activity</h3>
                  </div>

                  {overview.nextPlannedActivity ? (
                    <div className={styles.candidateRow}>
                      <div>
                        <strong>{overview.nextPlannedActivity.kind}</strong>
                        <div className={styles.candidateMeta}>
                          <span>
                            Planned:{" "}
                            {formatDate(
                              overview.nextPlannedActivity.plannedAt,
                            )}
                          </span>
                          <span>
                            Status: {overview.nextPlannedActivity.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p>No planned activity found.</p>
                  )}
                </section>
              </>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
