import Link from "next/link";

import { loadApplications } from "@/lib/applications";
import { configuredAuthorizationDependencies, getAuthorizedCandidateContext } from "@/lib/authorization";
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
  const authorization = configuredAuthorizationDependencies();
  const context = authorization.ok ? await getAuthorizedCandidateContext(authorization.value) : authorization;
  if (!context.ok) return <main className={styles.main}><section className={styles.panel}><h1>Ansökningar kunde inte visas</h1><p>Resursen kunde inte hittas.</p></section></main>;
  const result = await loadApplications(context.value.candidate.id);

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.logoMark}>AC</div>
          <div>
            <strong>AI Career Agent</strong>
            <span>Din arbetsyta</span>
          </div>
        </div>

        <nav className={styles.nav}>
          <Link href="/">Översikt</Link>
          <Link href="/jobs">Jobb</Link>
          <Link href="/candidates">Min profil</Link>
          <Link className={styles.active} href="/applications">Mina ansökningar</Link>
        </nav>

        <div className={styles.sidebarFooter}>
          <span>Personlig arbetsyta</span>
          <small>Din jobbsökning</small>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Ansökningsyta</p>
            <h1>Ansökningar</h1>
            <p className={styles.subtitle}>
              Här ser du dina sparade ansökningar.
            </p>
          </div>

          <div className={styles.status}>
            <span className={styles.statusDot} />
            Dina ansökningar
          </div>
        </header>

        {!result.configured ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Ansökningar kan inte visas just nu</strong>
              <p>
                Det finns ett tekniskt problem med att hämta dina ansökningar.
              </p>
            </div>
          </section>
        ) : result.error ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Dina ansökningar kunde inte laddas</strong>
              <p>
                Det gick inte att läsa dina ansökningar just nu.
              </p>
            </div>
          </section>
        ) : result.applications.length === 0 ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Inga ansökningar hittades</strong>
              <p>
                Du har inga sparade ansökningar ännu.
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
                        {application.jobSnapshot.company ?? "Företag saknas"}
                      </p>
                    </div>

                    <div className={styles.candidateMeta}>
                      <span>Status: {formatApplicationStatus(application.status)}</span>
                      <span>
                        Plats:{" "}
                        {application.jobSnapshot.location ??
                          "Plats saknas"}
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
