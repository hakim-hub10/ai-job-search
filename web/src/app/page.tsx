import Link from "next/link";
import styles from "./page.module.css";

export default function Home() {
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
          <Link className={styles.active} href="/">Dashboard</Link>
          <a href="#">Jobs</a>
          <a href="#">Candidates</a>
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
            <p className={styles.eyebrow}>Overview</p>
            <h1>Dashboard</h1>
            <p className={styles.subtitle}>
              A local preview of your AI Career Agent workspace.
            </p>
          </div>

          <div className={styles.status}>
            <span className={styles.statusDot} />
            System ready
          </div>
        </header>

        <section className={styles.cards}>
          <article className={styles.card}>
            <span>Candidates</span>
            <strong>—</strong>
            <small>Real data not connected yet</small>
          </article>

          <article className={styles.card}>
            <span>Applications</span>
            <strong>—</strong>
            <small>Real data not connected yet</small>
          </article>

          <article className={styles.card}>
            <span>Follow-ups</span>
            <strong>—</strong>
            <small>Real data not connected yet</small>
          </article>

          <article className={styles.card}>
            <span>Reports</span>
            <strong>—</strong>
            <small>Phase 8 reporting available</small>
          </article>
        </section>

        <section className={styles.grid}>
          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Applications</p>
                <h2>Recent applications</h2>
              </div>
            </div>

            <div className={styles.emptyState}>
              <strong>No application data loaded</strong>
              <p>
                This panel will use the existing application repository in the
                next integration step.
              </p>
            </div>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Coach</p>
                <h2>Upcoming follow-ups</h2>
              </div>
            </div>

            <div className={styles.emptyState}>
              <strong>No follow-up data loaded</strong>
              <p>
                Coach workspace data will be connected server-side later.
              </p>
            </div>
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
            <span>CV & Cover Letter</span>
            <span>Interview Preparation</span>
            <span>Job Coach</span>
            <span>Activity Reporting</span>
          </div>
        </section>
      </main>
    </div>
  );
}
