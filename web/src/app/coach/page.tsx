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
            Översikt
          </Link>

          <Link href="/jobs" className={styles.navItem}>Jobb</Link>

          <Link href="/candidates" className={styles.navItem}>
            Kandidater
          </Link>

          <Link href="/applications" className={styles.navItem}>
            Ansökningar
          </Link>

          <Link
            href="/coach"
            className={`${styles.navItem} ${styles.active}`}
          >
            Jobbcoach
          </Link>

          <Link href="/reports" className={styles.navItem}>
            Rapporter
          </Link>

          <Link href="/analytics" className={styles.navItem}>
            Analys
          </Link>
        </nav>
      </aside>

      <main className={styles.main}>
        <div className={styles.topbar}>
          <div>
            <p className={styles.eyebrow}>Jobbcoachens arbetsyta</p>
            <h2>Kandidater</h2>

            <p className={styles.subtitle}>
              Öppna en kandidats arbetsyta för att hantera ansökningar,
              uppföljningar, mål och aktiviteter.
            </p>
          </div>

          {result.configured ? (
            <Link
              href="/candidates/new"
              className={styles.secondaryButton}
            >
              Ny kandidat
            </Link>
          ) : null}
        </div>

        {!result.configured ? (
          <section className={styles.panel}>
            <h3>Jobbcoachens arbetsyta är inte konfigurerad</h3>
            <p>Ange COACH_DIR innan jobbcoachdata kan laddas.</p>
          </section>
        ) : result.error ? (
          <section className={styles.panel}>
            <h3>Jobbcoachens arbetsyta kunde inte laddas</h3>
            <p>
              {result.error.code}: {result.error.message}
            </p>
          </section>
        ) : result.candidates.length === 0 ? (
          <section className={styles.panel}>
            <h3>Inga kandidater hittades</h3>
            <p>Skapa en kandidat för att börja använda jobbcoachens arbetsyta.</p>
          </section>
        ) : (
          <section className={styles.panel}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>Kandidaternas arbetsytor</p>
                <h3>{result.candidates.length} kandidater</h3>
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
                          Uppdaterad: {formatDate(candidate.updatedAt)}
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
