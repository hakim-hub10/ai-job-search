import Link from "next/link";

import { loadApplications } from "@/lib/applications";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

function formatApplicationStatus(status: string) {
  switch (status) {
    case "saved":
      return "Sparad";
    case "preparing":
      return "Förbereds";
    case "applied":
      return "Ansökt";
    case "interview":
      return "Intervju";
    case "offer":
      return "Erbjudande";
    case "rejected":
      return "Avslagen";
    case "withdrawn":
      return "Tillbakadragen";
    case "closed":
      return "Avslutad";
    default:
      return status;
  }
}

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
          <Link href="/">Översikt</Link>
          <Link href="/jobs">Jobb</Link>
          <Link href="/candidates">Kandidater</Link>
          <Link className={styles.active} href="/applications">
            Ansökningar
          </Link>
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
            <p className={styles.eyebrow}>Ansökningsyta</p>
            <h1>Ansökningar</h1>
            <p className={styles.subtitle}>
              Ansökningar som hämtats från det befintliga lokala ansökningsarkivet
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
              <strong>Ansökningsarkivet är inte konfigurerat</strong>
              <p>
                Set APPLICATION_REPOSITORY when starting the web preview to
                ladda ansökningsposter.
              </p>
            </div>
          </section>
        ) : result.error ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Ansökningsarkivet kunde inte laddas</strong>
              <p>
                {result.error.code}: {result.error.message}
              </p>
            </div>
          </section>
        ) : result.applications.length === 0 ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Inga ansökningar hittades</strong>
              <p>
                Det konfigurerade ansökningsarkivet innehåller för närvarande inga
                ansökningsposter.
              </p>
            </div>
          </section>
        ) : (
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Ansökningar</p>
                <h2>{result.applications.length} ansökningar</h2>
              </div>
            </div>

            <div className={styles.candidateList}>
              {result.applications.map((application) => (
                <Link
                  href={`/applications/${encodeURIComponent(application.id)}`}
                  key={application.id}
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  <article className={styles.candidateRow}>
                    <div>
                      <strong>{application.jobSnapshot.title}</strong>
                      <p>
                        {application.jobSnapshot.company ??
                          "Company unavailable"}
                      </p>
                    </div>

                    <div className={styles.candidateMeta}>
                      <span>Status: {formatApplicationStatus(application.status)}</span>
                      <span>
                        Location:{" "}
                        {application.jobSnapshot.location ??
                          "Location unavailable"}
                      </span>
                      <time dateTime={application.updatedAt}>
                        Uppdaterad: {application.updatedAt}
                      </time>
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
