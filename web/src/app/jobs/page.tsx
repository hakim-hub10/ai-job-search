import Link from "next/link";

import { searchWebJobs } from "@/lib/jobs";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

interface JobsPageProps {
  searchParams: Promise<{
    query?: string;
    location?: string;
    limit?: string;
  }>;
}

function firstValue(value: string | undefined) {
  return value?.trim() ?? "";
}

function parseLimit(value: string | undefined) {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 50) {
    return 10;
  }

  return parsed;
}

function formatSearchError(
  code: "ALL_SOURCES_FAILED" | "SEARCH_FAILED",
): string {
  return code === "ALL_SOURCES_FAILED"
    ? "Ingen av de valda jobbkällorna kunde nås just nu."
    : "Ett tekniskt fel uppstod under jobbsökningen.";
}

function formatSourceName(source: string): string {
  const labels: Record<string, string> = {
    linkedin: "LinkedIn",
    freehire: "FreeHire",
    jobtech: "Platsbanken",
    jobadlinks: "JobAd Links",
    jobindex: "Jobindex",
    jobnet: "Jobnet",
    jobbank: "Jobbank",
    jobdanmark: "Jobdanmark",
  };

  return labels[source] ?? source;
}

export default async function JobsPage({ searchParams }: JobsPageProps) {
  const params = await searchParams;

  const query = firstValue(params.query);
  const location = firstValue(params.location);
  const limit = parseLimit(params.limit);

  const hasSearch = query.length > 0 || location.length > 0;

  const result = hasSearch
    ? await searchWebJobs({
        ...(query ? { query } : {}),
        ...(location ? { location } : {}),
        limit,
      })
    : null;

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
          <Link className={styles.active} href="/jobs">
            Jobb
          </Link>
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
            <p className={styles.eyebrow}>Jobbsökning</p>
            <h1>Hitta jobb</h1>
            <p className={styles.subtitle}>
              Sök efter relevanta jobb från de anslutna jobbkällorna.
            </p>
          </div>

          <div className={styles.status}>
            <span className={styles.statusDot} />
            Flera jobbkällor
          </div>
        </header>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Sök</p>
              <h2>Sök efter jobb</h2>
            </div>
          </div>

          <form method="get">
            <div
              style={{
                display: "grid",
                gap: 16,
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              }}
            >
              <label>
                <span>Sökord eller roll</span>
                <input
                  defaultValue={query}
                  name="query"
                  placeholder="Till exempel IT Support"
                  type="search"
                />
              </label>

              <label>
                <span>Plats</span>
                <input
                  defaultValue={location}
                  name="location"
                  placeholder="Till exempel Jönköping"
                  type="search"
                />
              </label>

              <label>
                <span>Antal resultat</span>
                <select defaultValue={String(limit)} name="limit">
                  <option value="5">5</option>
                  <option value="10">10</option>
                  <option value="20">20</option>
                  <option value="50">50</option>
                </select>
              </label>
            </div>

            <div style={{ marginTop: 20 }}>
              <button type="submit">Sök jobb</button>
            </div>
          </form>
        </section>

        {!hasSearch ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Börja med en jobbsökning</strong>
              <p>
                Ange en roll, ett sökord eller en plats för att hitta jobb.
              </p>
            </div>
          </section>
        ) : result && !result.ok ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Jobbsökningen kunde inte genomföras</strong>
              <p>{formatSearchError(result.code)}</p>
            </div>
          </section>
        ) : result && result.jobs.length === 0 ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Inga relevanta jobb hittades</strong>
              <p>Prova ett annat sökord eller en annan plats.</p>
            </div>
          </section>
        ) : result ? (
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Resultat</p>
                <h2>{result.jobs.length} relevanta jobb</h2>
              </div>
            </div>

            <div className={styles.candidateList}>
              {result.jobs.map((job) => (
                <article
                  className={styles.candidateRow}
                  key={`${job.source}:${job.id}`}
                >
                  <div>
                    <strong>{job.title}</strong>
                    <p>{job.company ?? "Företag saknas"}</p>
                  </div>

                  <div className={styles.candidateMeta}>
                    <span>{job.location ?? "Plats saknas"}</span>
                    <span>Källa: {formatSourceName(job.source)}</span>

                    {job.url ? (
                      <a
                        href={job.url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Visa jobb
                      </a>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
