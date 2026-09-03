import Link from "next/link";

import { loadDashboardData } from "@/lib/dashboard";

import styles from "./page.module.css";

export const dynamic = "force-dynamic";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export default async function Home() {
  const data = await loadDashboardData();

  const openFollowUps = data.followUps.filter(
    (followUp) => followUp.completedAt === undefined,
  );

  const recentApplications = data.applications.slice(0, 5);
  const upcomingFollowUps = openFollowUps.slice(0, 5);

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
          <Link className={styles.active} href="/">
            Dashboard
          </Link>
          <a href="#">Jobs</a>
          <Link href="/candidates">Candidates</Link>
          <Link href="/applications">Applications</Link>
          <a href="#">Coach</a>
          <Link href="/reports">Reports</Link>
        </nav>

        <div className={styles.sidebarFooter}>
          <span>Local Preview</span>
          <small>No cloud sync</small>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Overview</p>
            <h1>Dashboard</h1>
            <p className={styles.subtitle}>
              A local preview of your AI Career Agent workspace.
            </p>
          </div>

          <div className={styles.status}>
            <span className={styles.statusDot} />
            {data.configured && !data.error
              ? "Local data connected"
              : "Preview mode"}
          </div>
        </header>

        {data.error ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Dashboard data could not be loaded</strong>
              <p>
                Check the configured local repositories and try again.
              </p>
            </div>
          </section>
        ) : null}

        <section className={styles.cards}>
          <article className={styles.card}>
            <span>Candidates</span>
            <strong>{data.configured ? data.candidates.length : "—"}</strong>
            <small>
              {data.configured
                ? "Local candidate records"
                : "Coach repository not configured"}
            </small>
          </article>

          <article className={styles.card}>
            <span>Applications</span>
            <strong>{data.configured ? data.applications.length : "—"}</strong>
            <small>
              {data.configured
                ? "Local application records"
                : "Application repository not configured"}
            </small>
          </article>

          <article className={styles.card}>
            <span>Follow-ups</span>
            <strong>{data.configured ? openFollowUps.length : "—"}</strong>
            <small>
              {data.configured
                ? "Open follow-ups"
                : "Coach repository not configured"}
            </small>
          </article>

          <article className={styles.card}>
            <span>Reports</span>
            <strong>{data.configured ? data.candidates.length : "—"}</strong>
            <small>
              {data.configured
                ? "Candidate reports available"
                : "Reporting repositories not configured"}
            </small>
          </article>
        </section>

        <section className={styles.grid}>
          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Applications</p>
                <h2>Recent applications</h2>
              </div>

              <Link href="/applications">View all</Link>
            </div>

            {!data.configured ? (
              <div className={styles.emptyState}>
                <strong>Application repository not configured</strong>
                <p>
                  Configure APPLICATION_REPOSITORY to load application data.
                </p>
              </div>
            ) : recentApplications.length === 0 ? (
              <div className={styles.emptyState}>
                <strong>No applications yet</strong>
                <p>Application records will appear here when available.</p>
              </div>
            ) : (
              <div>
                {recentApplications.map((application) => (
                  <div key={application.id}>
                    <strong>{application.jobSnapshot.title}</strong>
                    <p>
                      {application.jobSnapshot.company ?? "Unknown company"}
                      {" · "}
                      {application.status}
                    </p>
                    <small>{formatDate(application.updatedAt)}</small>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Coach</p>
                <h2>Upcoming follow-ups</h2>
              </div>
            </div>

            {!data.configured ? (
              <div className={styles.emptyState}>
                <strong>Coach repository not configured</strong>
                <p>Configure COACH_DIR to load follow-up data.</p>
              </div>
            ) : upcomingFollowUps.length === 0 ? (
              <div className={styles.emptyState}>
                <strong>No open follow-ups</strong>
                <p>Upcoming candidate follow-ups will appear here.</p>
              </div>
            ) : (
              <div>
                {upcomingFollowUps.map((followUp) => (
                  <div key={followUp.id}>
                    <strong>{followUp.candidateId}</strong>
                    <p>
                      Due {formatDate(followUp.dueAt)}
                    </p>
                    {followUp.applicationId ? (
                      <small>Application: {followUp.applicationId}</small>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </article>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Platform</p>
              <h2>Available capabilities</h2>
            </div>
          </div>

          <div className={styles.capabilities}>
            <span>Job Search</span>
            <span>Matching</span>
            <span>Applications</span>
            <span>CV &amp; Cover Letter</span>
            <span>Interview Preparation</span>
            <span>Job Coach</span>
            <span>Activity Reporting</span>
          </div>
        </section>
      </main>
    </div>
  );
}
