import Link from "next/link";

import { loadDashboardData } from "@/lib/dashboard";

import styles from "./page.module.css";

export const dynamic = "force-dynamic";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export default async function Home() {
  const data = await loadDashboardData();

  const openFollowUps = data.followUps.filter(
    (followUp) => followUp.completedAt === undefined,
  );

  const recentAnsökningar = data.applications.slice(0, 5);
  const upcomingFollowUps = openFollowUps.slice(0, 5);

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
          <Link className={styles.active} href="/">
            Översikt
          </Link>
          <span title="Kommer snart">Jobb</span>
          <Link href="/candidates">Kandidater</Link>
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
            <p className={styles.eyebrow}>Översikt</p>
            <h1>Översikt</h1>
            <p className={styles.subtitle}>
              En lokal förhandsversion av din AI Career Agent-arbetsyta.
            </p>
          </div>

          <div className={styles.status}>
            <span className={styles.statusDot} />
            {data.configured && !data.error
              ? "Local data connected"
              : "Preview mode"}
          </div>
        </header>

        {data.error ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Översiktsdata kunde inte laddas</strong>
              <p>
                Check the configured local repositories and try again.
              </p>
            </div>
          </section>
        ) : null}

        <section className={styles.cards}>
          <article className={styles.card}>
            <span>Kandidater</span>
            <strong>{data.configured ? data.candidates.length : "—"}</strong>
            <small>
              {data.configured
                ? "Lokala kandidatposter"
                : "Jobbcoachens arkiv är inte konfigurerat"}
            </small>
          </article>

          <article className={styles.card}>
            <span>Ansökningar</span>
            <strong>{data.configured ? data.applications.length : "—"}</strong>
            <small>
              {data.configured
                ? "Lokala ansökningsposter"
                : "Ansökningsarkivet är inte konfigurerat"}
            </small>
          </article>

          <article className={styles.card}>
            <span>Uppföljningar</span>
            <strong>{data.configured ? openFollowUps.length : "—"}</strong>
            <small>
              {data.configured
                ? "Öppna uppföljningar"
                : "Jobbcoachens arkiv är inte konfigurerat"}
            </small>
          </article>

          <article className={styles.card}>
            <span>Rapporter</span>
            <strong>{data.configured ? data.candidates.length : "—"}</strong>
            <small>
              {data.configured
                ? "Kandidatrapporter tillgängliga"
                : "Rapportarkiven är inte konfigurerade"}
            </small>
          </article>
        </section>

        <section className={styles.grid}>
          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Ansökningar</p>
                <h2>Senaste ansökningarna</h2>
              </div>

              <Link href="/applications">Visa alla</Link>
            </div>

            {!data.configured ? (
              <div className={styles.emptyState}>
                <strong>Ansökningsarkivet är inte konfigurerat</strong>
                <p>
                  Configure APPLICATION_REPOSITORY to load application data.
                </p>
              </div>
            ) : recentAnsökningar.length === 0 ? (
              <div className={styles.emptyState}>
                <strong>Inga ansökningar ännu</strong>
                <p>Ansökningar visas här när de finns tillgängliga.</p>
              </div>
            ) : (
              <div>
                {recentAnsökningar.map((application) => (
                  <div key={application.id}>
                    <strong>{application.jobSnapshot.title}</strong>
                    <p>
                      {application.jobSnapshot.company ?? "Unknown company"}
                      {" · "}
                      {application.status}
                    </p>
                    <small>{formatDate(application.updatedAt)}</small>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Coach</p>
                <h2>Kommande uppföljningar</h2>
              </div>
            </div>

            {!data.configured ? (
              <div className={styles.emptyState}>
                <strong>Jobbcoachens arkiv är inte konfigurerat</strong>
                <p>Konfigurera COACH_DIR för att ladda uppföljningsdata.</p>
              </div>
            ) : upcomingFollowUps.length === 0 ? (
              <div className={styles.emptyState}>
                <strong>Inga öppna uppföljningar</strong>
                <p>Kommande uppföljningar för kandidater visas här.</p>
              </div>
            ) : (
              <div>
                {upcomingFollowUps.map((followUp) => (
                  <div key={followUp.id}>
                    <strong>{followUp.candidateId}</strong>
                    <p>
                      Due {formatDate(followUp.dueAt)}
                    </p>
                    {followUp.applicationId ? (
                      <small>Application: {followUp.applicationId}</small>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </article>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Plattform</p>
              <h2>Tillgängliga funktioner</h2>
            </div>
          </div>

          <div className={styles.capabilities}>
            <span>Jobbsökning</span>
            <span>Matchning</span>
            <span>Ansökningar</span>
            <span>CV &amp; personligt brev</span>
            <span>Intervjuförberedelse</span>
            <span>Jobbcoach</span>
            <span>Aktivitetsrapportering</span>
          </div>
        </section>
      </main>
    </div>
  );
}
