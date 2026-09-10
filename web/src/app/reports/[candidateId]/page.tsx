import Link from "next/link";

import { loadCoachCandidates } from "@/lib/coach-candidates";
import { loadCandidateActivityReport } from "@/lib/reports";
import { configuredAuthorizationDependencies, requireOwnedCandidate } from "@/lib/authorization";
import styles from "../../page.module.css";

export const dynamic = "force-dynamic";

interface ReportPageProps {
  params: Promise<{
    candidateId: string;
  }>;
  searchParams: Promise<{
    start?: string;
    end?: string;
  }>;
}

function formatStatusLabel(status: string) {
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
    case "planned":
      return "Planerad";
    case "completed":
      return "Slutförd";
    case "cancelled":
      return "Avbruten";
    default:
      return status;
  }
}

function toStartTimestamp(value: string) {
  return `${value}T00:00:00Z`;
}


function formatTimestamp(value: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("sv-SE");
}

function formatEventKind(kind: string) {
  const labels: Record<string, string> = {
    applicationCreated: "Ansökan skapad",
    applicationStatusChanged: "Ansökningsstatus ändrad",
    followUpCreated: "Uppföljning skapad",
    followUpCompleted: "Uppföljning slutförd",
    coachActivityPlanned: "Jobbcoachaktivitet planerad",
    coachActivityCompleted: "Jobbcoachaktivitet slutförd",
    coachActivityCancelled: "Jobbcoachaktivitet avbruten",
  };

  return labels[kind] ?? kind;
}

function formatActivityKind(kind: string) {
  const labels: Record<string, string> = {
    applyForJob: "Apply for job",
    updateCv: "Update CV",
    contactEmployer: "Contact employer",
    attendInterview: "Attend interview",
    completeCourseStep: "Complete course step",
    coachingMeeting: "Coachmöte",
  };

  return labels[kind] ?? kind;
}

function eventDetails(
  event:
    | {
        kind: "applicationCreated" | "applicationStatusChanged";
        applicationId: string;
        status: string;
      }
    | {
        kind: "followUpCreated" | "followUpCompleted";
        followUpId: string;
        applicationId?: string;
      }
    | {
        kind:
          | "coachActivityPlanned"
          | "coachActivityCompleted"
          | "coachActivityCancelled";
        activityId: string;
        activityKind: string;
        applicationId?: string;
      },
) {
  if (
    event.kind === "applicationCreated" ||
    event.kind === "applicationStatusChanged"
  ) {
    return [
      `Application: ${event.applicationId}`,
      `Status: ${formatStatusLabel(event.status)}`,
    ];
  }

  if (
    event.kind === "followUpCreated" ||
    event.kind === "followUpCompleted"
  ) {
    return [
      `Uppföljning: ${event.followUpId}`,
      ...(event.applicationId
        ? [`Application: ${event.applicationId}`]
        : []),
    ];
  }

  if ("activityKind" in event && "activityId" in event) {
    return [
      `Activity: ${formatActivityKind(event.activityKind)}`,
      `Activity ID: ${event.activityId}`,
      ...(event.applicationId
        ? [`Application: ${event.applicationId}`]
        : []),
    ];
  }

  return [];
}

export default async function CandidateReportPage({
  params,
  searchParams,
}: ReportPageProps) {
  const { candidateId } = await params;
    const authorization = configuredAuthorizationDependencies();
    const owned = authorization.ok ? await requireOwnedCandidate(candidateId, authorization.value) : authorization;
    if (!owned.ok) return <main><h1>Rapporten kunde inte visas</h1></main>;
  const query = await searchParams;

  const start = query.start ?? "2026-01-01";
  const end = query.end ?? "2027-01-01";

  const [result, candidateResult] = await Promise.all([
    loadCandidateActivityReport(
      candidateId,
      toStartTimestamp(start),
      toStartTimestamp(end),
    ),
    loadCoachCandidates(),
  ]);

  const candidate =
    candidateResult.configured && !candidateResult.error
      ? candidateResult.candidates.find((item) => item.id === candidateId)
      : undefined;

  const candidateTitle = candidate?.displayName ?? candidateId;

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
        </nav>

        <div className={styles.sidebarFooter}>
          <span>Lokal förhandsversion</span>
          <small>Ingen molnsynkronisering</small>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Kandidatens aktivitetsrapport</p>
            <h1>{candidateTitle}</h1>
            <p className={styles.subtitle}>
              Factual activity derived from the existing coach and application
              repositories.
            </p>
            {candidate ? (
              <p className={styles.subtitle}>Kandidat-ID: {candidate.id}</p>
            ) : null}
          </div>

          <Link href="/reports">Tillbaka till rapporter</Link>
        </header>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Reporting period</p>
              <h2>
                {start} → {end}
              </h2>
            </div>
          </div>

          <form method="get" className={styles.reportFilters}>
            <label>
              <span>Startdatum</span>
              <input type="date" name="start" defaultValue={start} />
            </label>

            <label>
              <span>Slutdatum</span>
              <input type="date" name="end" defaultValue={end} />
            </label>

            <button type="submit">Ladda rapport</button>
          </form>
        </section>

        {!result.configured ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Rapportarkiven är inte konfigurerade</strong>
              <p>
                Both COACH_DIR and APPLICATION_REPOSITORY are required to load
                kandidatens aktivitetsrapporter.
              </p>
            </div>
          </section>
        ) : result.error ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Rapporten kunde inte genereras</strong>
              <pre>{JSON.stringify(result.error, null, 2)}</pre>
            </div>
          </section>
        ) : result.report ? (
          <>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Sammanfattning</p>
                  <h2>{result.report.events.length} recorded events</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                {Object.entries(result.report.summary)
                  .filter(([, count]) => count > 0)
                  .map(([kind, count]) => (
                    <article className={styles.candidateRow} key={kind}>
                      <strong>{formatEventKind(kind)}</strong>
                      <span>{count}</span>
                    </article>
                  ))}
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Tidslinje</p>
                  <h2>Activity events</h2>
                </div>
              </div>

              {result.report.events.length === 0 ? (
                <div className={styles.emptyState}>
                  <strong>No activity in this period</strong>
                  <p>
                    No reportable events were found between the selected
                    boundaries.
                  </p>
                </div>
              ) : (
                <div className={styles.candidateList}>
                  {result.report.events.map((event, index) => (
                    <article
                      className={styles.candidateRow}
                      key={`${event.timestamp}-${event.kind}-${index}`}
                    >
                      <div>
                        <strong>{formatEventKind(event.kind)}</strong>

                        <div className={styles.candidateMeta}>
                          {eventDetails(event).map((detail) => (
                            <span key={detail}>{detail}</span>
                          ))}
                        </div>
                      </div>

                      <time dateTime={event.timestamp}>
                        {formatTimestamp(event.timestamp)}
                      </time>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
