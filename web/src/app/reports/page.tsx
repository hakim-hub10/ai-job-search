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
          <Link href="/">Översikt</Link>
          <Link href="/jobs">Jobb</Link>
          <Link href="/candidates">Kandidater</Link>
          <Link href="/applications">Ansökningar</Link>
          <Link href="/coach">Jobbcoach</Link>
          <Link className={styles.active} href="/reports">
            Rapporter
          </Link>
          <Link href="/analytics">Analys</Link>
        </nav>

        <div className={styles.sidebarFooter}>
          <span>Lokal förhandsversion</span>
          <small>Ingen molnsynkronisering</small>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Aktivitetsrapportering</p>
            <h1>Rapporter</h1>
            <p className={styles.subtitle}>
              Kandidaternas aktivitetsrapporter baserade på befintliga ansökningar,
              uppföljningar och jobbcoachaktiviteter.
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
              <strong>Jobbcoachens arbetsyta är inte konfigurerad</strong>
              <p>
                Ange COACH_DIR när webbens förhandsversion startas för att ladda kandidater.
              </p>
            </div>
          </section>
        ) : result.error ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Kandidaternas arbetsyta kunde inte laddas</strong>
              <p>
                {result.error.code}: {result.error.message}
              </p>
            </div>
          </section>
        ) : result.candidates.length === 0 ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Inga kandidater hittades</strong>
              <p>
                Create a coach candidate before generating an activity report.
              </p>
            </div>
          </section>
        ) : (
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Kandidater</p>
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
                    <span>Öppna aktivitetsrapport</span>
                    <time dateTime={candidate.updatedAt}>
                      Uppdaterad: {candidate.updatedAt}
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
