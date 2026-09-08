import Link from "next/link";
import { preparationPath } from "@/lib/interview-preparation-presentation";
import type { InterviewOverview, InterviewReadResult } from "@/lib/interview-data";
import { formatInterviewLanguage, formatInterviewStatus, formatInterviewType, interviewOverviewError, summarizeInterviewSessions } from "@/lib/interview-presentation";
import shared from "../../../page.module.css";
import styles from "./page.module.css";

export function InterviewOverviewView({ applicationId, result }: {
  applicationId: string;
  result: InterviewReadResult<InterviewOverview>;
}) {
  const backPath = `/applications/${encodeURIComponent(applicationId)}`;
  if (!result.ok) {
    return (
      <main className={styles.page} lang="sv">
        <div className={styles.content}>
          <Link className={styles.back} href={result.code === "APPLICATION_NOT_FOUND" ? "/applications" : backPath}>
            {result.code === "APPLICATION_NOT_FOUND" ? "← Tillbaka till ansökningar" : "← Tillbaka till ansökan"}
          </Link>
          <header className={styles.header}><p className={shared.eyebrow}>Intervju</p><h1>Intervjuöversikten kunde inte visas</h1></header>
          <section className={shared.panel} aria-label="Information om intervjuöversikten">
            <p className={styles.description}>{interviewOverviewError(result.code)}</p>
          </section>
        </div>
      </main>
    );
  }
  const overview = result.value;
  const totals = summarizeInterviewSessions(overview.sessions);
  return (
    <main className={styles.page} lang="sv">
      <div className={styles.content}>
        <Link className={styles.back} href={backPath}>← Tillbaka till ansökan</Link>
        <header className={styles.header}>
          <p className={shared.eyebrow}>Din ansökan</p>
          <h1>Intervju</h1>
          <p className={styles.jobTitle}>{overview.jobTitle}</p>
          {overview.company ? <p className={styles.description}>{overview.company}</p> : null}
          <p className={styles.description}>Här ser du din intervjuövning för den här ansökan. Följ vilka frågor du har besvarat och vilka som återstår.</p>
        </header>
        <dl className={styles.summary} aria-label="Sammanfattning av intervjuövning">
          {[{ label: "Övningsintervjuer", value: totals.sessions }, { label: "Besvarade frågor", value: totals.answered }, { label: "Återstående frågor", value: totals.remaining }].map((item) => (
            <div className={`${shared.card} ${styles.stat}`} key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>
          ))}
        </dl>
        <section className={shared.panel} aria-labelledby="sessions-heading">
          <div className={shared.panelHeader}><h2 id="sessions-heading">Övningsintervjuer</h2></div>
          {overview.sessions.length === 0 ? (
            <div className={shared.emptyState}>
              <strong>Ingen övningsintervju ännu</strong>
              <p>Du har inte startat någon övningsintervju för den här ansökan ännu.</p>
              <p>Du kan förbereda frågor och gå igenom exempel från din verifierade profil.</p>
            </div>
          ) : (
            <ul className={styles.sessions}>
              {overview.sessions.map((session, index) => (
                <li className={styles.session} key={session.sessionId}>
                  <div className={styles.sessionHeader}>
                    <div><p className={shared.eyebrow}>Övningsintervju {index + 1}</p><h3>{formatInterviewType(session.interviewType)}</h3></div>
                    <span className={styles.badge}>{formatInterviewStatus(session.status)}</span>
                  </div>
                  <p className={styles.language}>Språk: {formatInterviewLanguage(session.language)}</p>
                  <dl className={styles.counts}>
                    {[{ label: "Frågor totalt", value: session.totalQuestions }, { label: "Besvarade", value: session.answeredQuestions }, { label: "Överhoppade", value: session.skippedQuestions }, { label: "Återstår", value: session.remainingQuestions }].map((item) => (
                      <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={`${shared.panel} ${styles.next}`} aria-labelledby="preparation-heading">
          <p className={shared.eyebrow}>Nästa steg</p>
          <h2 id="preparation-heading">Förbered intervju</h2>
          <p className={styles.description}>Välj intervjutyp och språk. Spara frågor, relevanta krav och exempel från din verifierade profil inför intervjun.</p>
          <Link className={styles.back} href={preparationPath(applicationId)}>Förbered intervju →</Link>
        </section>
      </div>
    </main>
  );
}
