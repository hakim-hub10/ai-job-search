import Link from "next/link";

import { loadCoachCandidates } from "@/lib/coach-candidates";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

export default async function CandidatesPage() {
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
          <a href="#">Jobs</a>
          <Link className={styles.active} href="/candidates">
            Candidates
          </Link>
          <a href="#">Applications</a>
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
            <p className={styles.eyebrow}>Coach workspace</p>
            <h1>Candidates</h1>
            <p className={styles.subtitle}>
              Candidates loaded from the existing local coach repository.
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
                Set COACH_DIR when starting the web preview to load candidates
                from the existing coach workspace.
              </p>
            </div>
          </section>
        ) : result.error ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Candidate repository could not be loaded</strong>
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
                The configured coach workspace currently contains no candidate
                records.
              </p>
            </div>
          </section>
        ) : (
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Candidates</p>
                <h2>{result.candidates.length} candidate records</h2>
              </div>
            </div>

            <div className={styles.candidateList}>
              {result.candidates.map((candidate) => (
                <article className={styles.candidateRow} key={candidate.id}>
                  <div>
                    <strong>{candidate.displayName}</strong>
                    <p>{candidate.id}</p>
                  </div>

                  <div className={styles.candidateMeta}>
                    <span>Created</span>
                    <time dateTime={candidate.createdAt}>
                      {candidate.createdAt}
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
