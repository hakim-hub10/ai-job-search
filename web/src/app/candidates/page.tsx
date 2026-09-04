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
            <span>Sverige – Förhandsversion</span>
          </div>
        </div>

        <nav className={styles.nav}>
          <Link href="/">Översikt</Link>
          <span title="Kommer snart">Jobb</span>
          <Link className={styles.active} href="/candidates">
            Kandidater
          </Link>
          <Link href="/applications">Ansökningar</Link>
          <Link href="/coach">Jobbcoach</Link>
          <Link href="/reports">Rapporter</Link>
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
            <p className={styles.eyebrow}>Jobbcoachens arbetsyta</p>
            <h1>Kandidater</h1>
            <p className={styles.subtitle}>
              Kandidater som hämtats från det befintliga lokala jobbcoacharkivet.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {result.configured ? (
              <Link href="/candidates/new">Ny kandidat</Link>
            ) : null}

            <div className={styles.status}>
              <span className={styles.statusDot} />
              Local repository
            </div>
          </div>
        </header>

        {!result.configured ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Jobbcoachens arbetsyta är inte konfigurerad</strong>
              <p>
                Ange COACH_DIR när webbens förhandsversion startas för att ladda kandidater
                från jobbcoachens befintliga arbetsyta.
              </p>
            </div>
          </section>
        ) : result.error ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Kandidatarkivet kunde inte laddas</strong>
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
                Jobbcoachens konfigurerade arbetsyta innehåller för närvarande inga kandidatposter
                records.
              </p>
            </div>
          </section>
        ) : (
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Kandidater</p>
                <h2>{result.candidates.length} kandidatposter</h2>
              </div>
            </div>

            <div className={styles.candidateList}>
              {result.candidates.map((candidate) => (
                <Link
                  className={styles.candidateRow}
                  href={`/candidates/${encodeURIComponent(candidate.id)}`}
                  key={candidate.id}
                >
                  <div>
                    <strong>{candidate.displayName}</strong>
                    <p>{candidate.id}</p>
                  </div>

                  <div className={styles.candidateMeta}>
                    <span>Skapad</span>
                    <time dateTime={candidate.createdAt}>
                      {candidate.createdAt}
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
