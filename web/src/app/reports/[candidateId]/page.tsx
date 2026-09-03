import Link from "next/link";

import { loadCoachCandidates } from "@/lib/coach-candidates";
import { loadCandidateActivityReport } from "@/lib/reports";
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
    applicationCreated: "Application created",
    applicationStatusChanged: "Application status changed",
    followUpCreated: "Follow-up created",
    followUpCompleted: "Follow-up completed",
    coachActivityPlanned: "Coach activity planned",
    coachActivityCompleted: "Coach activity completed",
    coachActivityCancelled: "Coach activity cancelled",
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
    coachingMeeting: "Coaching meeting",
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
      `Status: ${event.status}`,
    ];
  }

  if (
    event.kind === "followUpCreated" ||
    event.kind === "followUpCompleted"
  ) {
    return [
      `Follow-up: ${event.followUpId}`,
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
          <Link href="/">Dashboard</Link>
          <a href="#">Jobs</a>
          <Link href="/candidates">Candidates</Link>
          <Link href="/applications">Applications</Link>
          <a href="#">Coach</a>
          <Link className={styles.active} href="/reports">
            Reports
          </Link>
        </nav>

        <div className={styles.sidebarFooter}>
          <span>Local Preview</span>
          <small>No cloud sync</small>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Candidate activity report</p>
            <h1>{candidateTitle}</h1>
            <p className={styles.subtitle}>
              Factual activity derived from the existing coach and application
              repositories.
            </p>
            {candidate ? (
              <p className={styles.subtitle}>Candidate ID: {candidate.id}</p>
            ) : null}
          </div>

          <Link href="/reports">Back to reports</Link>
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
              <span>Start date</span>
              <input type="date" name="start" defaultValue={start} />
            </label>

            <label>
              <span>End date</span>
              <input type="date" name="end" defaultValue={end} />
            </label>

            <button type="submit">Load report</button>
          </form>
        </section>

        {!result.configured ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Reporting repositories not configured</strong>
              <p>
                Both COACH_DIR and APPLICATION_REPOSITORY are required to load
                candidate activity reports.
              </p>
            </div>
          </section>
        ) : result.error ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Report could not be generated</strong>
              <pre>{JSON.stringify(result.error, null, 2)}</pre>
            </div>
          </section>
        ) : result.report ? (
          <>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Summary</p>
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
                  <p className={styles.eyebrow}>Timeline</p>
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
