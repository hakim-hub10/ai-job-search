import Link from "next/link";

import { loadCoachCandidates } from "@/lib/coach-candidates";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const result = await loadCoachCandidates();

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
          <Link className={styles.active} href="/reports">
            Reports
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
            <p className={styles.eyebrow}>Activity reporting</p>
            <h1>Reports</h1>
            <p className={styles.subtitle}>
              Candidate activity reports derived from existing applications,
              follow-ups and coaching activities.
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
              <strong>Coach workspace not configured</strong>
              <p>
                Set COACH_DIR when starting the web preview to load candidates.
              </p>
            </div>
          </section>
        ) : result.error ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Candidate workspace could not be loaded</strong>
              <p>
                {result.error.code}: {result.error.message}
              </p>
            </div>
          </section>
        ) : result.candidates.length === 0 ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>No candidates found</strong>
              <p>
                Create a coach candidate before generating an activity report.
              </p>
            </div>
          </section>
        ) : (
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Candidates</p>
                <h2>Select a candidate</h2>
              </div>
            </div>

            <div className={styles.candidateList}>
              {result.candidates.map((candidate) => (
                <Link
                  className={styles.candidateRow}
                  href={`/reports/${encodeURIComponent(candidate.id)}`}
                  key={candidate.id}
                >
                  <div>
                    <strong>{candidate.displayName}</strong>
                    <p>{candidate.id}</p>
                  </div>

                  <div className={styles.candidateMeta}>
                    <span>Open activity report</span>
                    <time dateTime={candidate.updatedAt}>
                      Updated: {candidate.updatedAt}
                    </time>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
