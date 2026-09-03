import Link from "next/link";

import { loadCoachCandidates } from "@/lib/coach-candidates";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

function formatDate(value: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("sv-SE");
}

export default async function CoachPage() {
  const result = await loadCoachCandidates();

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

          <Link href="/candidates" className={styles.navItem}>
            Candidates
          </Link>

          <Link href="/applications" className={styles.navItem}>
            Applications
          </Link>

          <Link
            href="/coach"
            className={`${styles.navItem} ${styles.active}`}
          >
            Coach
          </Link>

          <Link href="/reports" className={styles.navItem}>
            Reports
          </Link>
        </nav>
      </aside>

      <main className={styles.main}>
        <div className={styles.topbar}>
          <div>
            <p className={styles.eyebrow}>Coach workspace</p>
            <h2>Candidates</h2>

            <p className={styles.subtitle}>
              Open a candidate workspace to manage applications,
              follow-ups, goals and activities.
            </p>
          </div>

          {result.configured ? (
            <Link
              href="/candidates/new"
              className={styles.secondaryButton}
            >
              New candidate
            </Link>
          ) : null}
        </div>

        {!result.configured ? (
          <section className={styles.panel}>
            <h3>Coach workspace not configured</h3>
            <p>Set COACH_DIR before coach data can be loaded.</p>
          </section>
        ) : result.error ? (
          <section className={styles.panel}>
            <h3>Coach workspace could not be loaded</h3>
            <p>
              {result.error.code}: {result.error.message}
            </p>
          </section>
        ) : result.candidates.length === 0 ? (
          <section className={styles.panel}>
            <h3>No candidates found</h3>
            <p>Create a candidate to start using the coach workspace.</p>
          </section>
        ) : (
          <section className={styles.panel}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>Candidate workspaces</p>
                <h3>{result.candidates.length} candidates</h3>
              </div>
            </div>

            <div className={styles.candidateList}>
              {result.candidates.map((candidate) => (
                <Link
                  href={`/candidates/${encodeURIComponent(candidate.id)}`}
                  key={candidate.id}
                  style={{
                    color: "inherit",
                    textDecoration: "none",
                  }}
                >
                  <article className={styles.candidateRow}>
                    <div>
                      <strong>{candidate.displayName}</strong>

                      <div className={styles.candidateMeta}>
                        <span>ID: {candidate.id}</span>
                        <span>
                          Updated: {formatDate(candidate.updatedAt)}
                        </span>
                      </div>
                    </div>
                  </article>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
