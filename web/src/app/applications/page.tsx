import Link from "next/link";

import { loadApplications } from "@/lib/applications";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

export default async function ApplicationsPage() {
  const result = await loadApplications();

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
          <a href="#">Jobs</a>
          <Link href="/candidates">Candidates</Link>
          <Link className={styles.active} href="/applications">
            Applications
          </Link>
          <a href="#">Coach</a>
          <a href="#">Reports</a>
        </nav>

        <div className={styles.sidebarFooter}>
          <span>Local Preview</span>
          <small>No cloud sync</small>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Application workspace</p>
            <h1>Applications</h1>
            <p className={styles.subtitle}>
              Applications loaded from the existing local application
              repository.
            </p>
          </div>

          <div className={styles.status}>
            <span className={styles.statusDot} />
            Local repository
          </div>
        </header>

        {!result.configured ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Application repository not configured</strong>
              <p>
                Set APPLICATION_REPOSITORY when starting the web preview to
                load application records.
              </p>
            </div>
          </section>
        ) : result.error ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Application repository could not be loaded</strong>
              <p>
                {result.error.code}: {result.error.message}
              </p>
            </div>
          </section>
        ) : result.applications.length === 0 ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>No applications found</strong>
              <p>
                The configured application repository currently contains no
                application records.
              </p>
            </div>
          </section>
        ) : (
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Applications</p>
                <h2>{result.applications.length} application records</h2>
              </div>
            </div>

            <div className={styles.candidateList}>
              {result.applications.map((application) => (
                <article
                  className={styles.candidateRow}
                  key={application.id}
                >
                  <div>
                    <strong>{application.jobSnapshot.title}</strong>
                    <p>
                      {application.jobSnapshot.company ?? "Company unavailable"}
                    </p>
                  </div>

                  <div className={styles.candidateMeta}>
                    <span>Status: {application.status}</span>
                    <span>
                      Location:{" "}
                      {application.jobSnapshot.location ??
                        "Location unavailable"}
                    </span>
                    <time dateTime={application.updatedAt}>
                      Updated: {application.updatedAt}
                    </time>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
