import Link from "next/link";

import { deriveCandidateCareerActions, loadCandidateAnalytics, loadCandidateInterviewPracticeAnalytics, loadCandidateRequirementInsights, parseAnalyticsPeriod } from "@/lib/analytics";
import { loadCoachCandidates } from "@/lib/coach-candidates";
import styles from "../../page.module.css";
import { CareerActionList } from "./career-actions";

export const dynamic = "force-dynamic";

interface CandidateAnalyticsPageProps {
  params: Promise<{
    candidateId: string;
  }>;
  searchParams: Promise<{
    start?: string;
    end?: string;
    asOf?: string;
  }>;
}

function toTimestamp(value: string) {
  return `${value}T00:00:00.000Z`;
}

function formatRate(value: number | null) {
  if (value === null) {
    return "—";
  }

  return `${(value * 100).toFixed(1)}%`;
}

function formatDuration(milliseconds: number | null) {
  if (milliseconds === null) {
    return "—";
  }

  const days = milliseconds / (1000 * 60 * 60 * 24);

  if (days >= 1) {
    return `${days.toFixed(1)} days`;
  }

  const hours = milliseconds / (1000 * 60 * 60);

  return `${hours.toFixed(1)} hours`;
}

export default async function CandidateAnalyticsPage({
  params,
  searchParams,
}: CandidateAnalyticsPageProps) {
  const { candidateId } = await params;
  const query = await searchParams;

  const period = parseAnalyticsPeriod(query);
  const start = period.ok ? period.value.start : "2026-01-01";
  const end = period.ok ? period.value.end : "2027-01-01";
  const asOfDate = period.ok ? period.value.asOf : end;

  const [result, candidateResult, interviewPractice, requirementInsights] = await Promise.all([
    loadCandidateAnalytics(
      candidateId,
      toTimestamp(start),
      toTimestamp(end),
      toTimestamp(asOfDate),
    ),
    loadCoachCandidates(),
    loadCandidateInterviewPracticeAnalytics(candidateId),
    loadCandidateRequirementInsights(candidateId),
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
          <Link href="/reports">Rapporter</Link>
          <Link className={styles.active} href="/analytics">
            Analys
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
            <p className={styles.eyebrow}>Kandidatanalys</p>
            <h1>{candidateTitle}</h1>

            <p className={styles.subtitle}>
              Härledd faktabaserad analys från kandidatens befintliga
              ansökningar, uppföljningar och jobbcoachaktiviteter.
            </p>

            {candidate ? (
              <p className={styles.subtitle}>Candidate ID: {candidate.id}</p>
            ) : null}
          </div>

          <Link href="/analytics">Tillbaka till analys</Link>
        </header>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Analysperiod</p>
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

            <label>
              <span>Per datum</span>
              <input type="date" name="asOf" defaultValue={asOfDate} />
            </label>

            <button type="submit">Ladda analys</button>
            <Link href={`/analytics/${encodeURIComponent(candidateId)}`}>Visa all tillgänglig data</Link>
          </form>
        </section>
        {!period.ok && <section className={styles.panel}><div className={styles.emptyState}><strong>Analysperioden kunde inte användas</strong><p>Ange giltiga datum där startdatumet infaller före slutdatumet.</p></div></section>}

        {!result.configured ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Analysarkiven är inte konfigurerade</strong>

              <p>
                Ange COACH_DIR och APPLICATION_REPOSITORY för att läsa kandidatanalys.
              </p>
            </div>
          </section>
        ) : result.error ? (
          <section className={styles.panel}>
            <div className={styles.emptyState}>
              <strong>Kandidatanalysen kunde inte genereras</strong>
              <p role="alert">Kandidatanalysen kunde inte verifieras. Kontrollera vald period och analysarkiv.</p>
            </div>
          </section>
        ) : result.outcome && result.activity && result.time ? (
          <>
            <section className={styles.panel}>
              <div className={styles.panelHeader}><div><p className={styles.eyebrow}>Intervjuträning</p><h2>Faktiska träningsmått</h2></div></div><p className={styles.subtitle}>Tidsfilter gäller inte intervjuträning eftersom sessionerna saknar tidsstämplar.</p>
              {!interviewPractice.configured ? <div className={styles.emptyState}><strong>Intervjuarkivet är inte konfigurerat</strong><p>Intervjuträning kan inte visas ännu.</p></div> : interviewPractice.error ? <div className={styles.emptyState}><strong>Intervjuträningen kunde inte läsas</strong><p>Kontrollera intervjuarkivet och försök igen.</p></div> : interviewPractice.analytics ? <><p className={styles.subtitle}>Måtten beskriver sparad övningsaktivitet. Svarskvalitet, tidsserier och AI-coaching ingår inte.</p><div className={styles.candidateList}><article className={styles.candidateRow}><strong>Träningssessioner</strong><span>{interviewPractice.analytics.totalSessions}</span></article><article className={styles.candidateRow}><strong>Pågående</strong><span>{interviewPractice.analytics.activeSessions}</span></article><article className={styles.candidateRow}><strong>Slutförda</strong><span>{interviewPractice.analytics.completedSessions}</span></article><article className={styles.candidateRow}><strong>Besvarade frågor</strong><span>{interviewPractice.analytics.answeredQuestions}</span></article><article className={styles.candidateRow}><strong>Överhoppade frågor</strong><span>{interviewPractice.analytics.skippedQuestions}</span></article><article className={styles.candidateRow}><strong>Tidsanalys</strong><span>Inte spårad</span></article><article className={styles.candidateRow}><strong>Intervjutyp</strong><span>{interviewPractice.analytics.typeDistribution.map((item) => `${item.label}: ${item.count}`).join(" · ") || "Inga sessioner"}</span></article></div></> : null}
            </section>
            <section className={styles.panel} aria-labelledby="requirements-heading">
              <div className={styles.panelHeader}><div><p className={styles.eyebrow}>Krav och kompetens</p><h2 id="requirements-heading">Historiska matchningsfakta</h2></div></div>
              <p className={styles.subtitle}>Tidsfilter gäller inte denna sektion. Kraven och kompetensgapen bygger på alla sparade analyser eftersom analyserna saknar egen tidsstämpel.</p>
              {!requirementInsights.configured ? <div className={styles.emptyState}><strong>Analysarkiven är inte konfigurerade</strong><p>Krav och kompetens kan inte visas ännu.</p></div> : requirementInsights.error ? <div className={styles.emptyState}><strong>Kravanalysen kunde inte läsas</strong><p>Kontrollera analysarkiven och försök igen.</p></div> : requirementInsights.insights && requirementInsights.insights.applicationsTotal === 0 ? <div className={styles.emptyState}><strong>Inga ansökningar finns ännu</strong><p>Sparade matchningsanalyser visas när ansökningar finns.</p></div> : requirementInsights.insights && requirementInsights.insights.applicationsWithAnalysis === 0 ? <div className={styles.emptyState}><strong>Inga sparade matchningsanalyser</strong><p>Ansökningarna saknar beständiga analyser.</p></div> : requirementInsights.insights ? <><p className={styles.subtitle}>Visar {requirementInsights.insights.applicationsWithAnalysis} av {requirementInsights.insights.applicationsTotal} ansökningar med sparad analys. Detta är historiska fakta, inte en bedömning av kandidaten.</p>{requirementInsights.insights.requirements.length > 0 ? <div className={styles.candidateList}><article className={styles.candidateRow}><strong>Krav</strong><span>Matchad · Saknas · Konflikt · Okänd</span></article>{requirementInsights.insights.requirements.map((item) => <article className={styles.candidateRow} key={item.requirementId}><strong>{item.label}</strong><span>{item.matched} · {item.missing} · {item.conflicting} · {item.unknown}</span></article>)}</div> : <p>Inga krav med sparad matchningsinformation hittades.</p>}{requirementInsights.insights.skillGaps.length > 0 && <><h3>Kompetensgap i sparade analyser</h3><div className={styles.candidateList}>{requirementInsights.insights.skillGaps.map((gap) => <article className={styles.candidateRow} key={gap.gapId}><strong>{gap.label}</strong><span>Förekom i {gap.applicationsRepresented} ansökningar · {gap.occurrences} förekomster</span></article>)}</div></>}<h3>Förslag på nästa steg</h3><CareerActionList actions={deriveCandidateCareerActions(requirementInsights.insights)} /></> : null}
            </section>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Ansökningar</p>
                  <h2>Ansökningarnas historiska utfall</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                <article className={styles.candidateRow}>
                  <strong>Totalt antal ansökningar</strong>
                  <span>{result.outcome.applications.total}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Nådde ansökt</strong>
                  <span>{result.outcome.applications.reachedApplied}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Nådde intervju</strong>
                  <span>{result.outcome.applications.reachedInterview}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Nådde erbjudande</strong>
                  <span>{result.outcome.applications.reachedOffer}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Avslagna</strong>
                  <span>{result.outcome.applications.rejected}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Tillbakadragna</strong>
                  <span>{result.outcome.applications.withdrawn}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Avslutade</strong>
                  <span>{result.outcome.applications.closed}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Ansökan → ansökt</strong>
                  <span>
                    {formatRate(
                      result.outcome.funnel.applicationToApplied
                        .rate,
                    )}
                  </span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Ansökt → intervju</strong>
                  <span>
                    {formatRate(
                      result.outcome.funnel.appliedToInterview.rate,
                    )}
                  </span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Intervju → erbjudande</strong>
                  <span>
                    {formatRate(
                      result.outcome.funnel.interviewToOffer.rate,
                    )}
                  </span>
                </article>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Uppföljningar</p>
                  <h2>Aktivitetsanalys</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                <article className={styles.candidateRow}>
                  <strong>Totalt antal uppföljningar</strong>
                  <span>{result.activity.followUps.total}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Slutförda</strong>
                  <span>{result.activity.followUps.completed}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Ej slutförda</strong>
                  <span>{result.activity.followUps.incomplete}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Slutförandegrad</strong>
                  <span>
                    {formatRate(
                      result.activity.followUps.completion.rate,
                    )}
                  </span>
                </article>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Jobbcoachaktiviteter</p>
                  <h2>Analys av jobbcoachaktiviteter</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                <article className={styles.candidateRow}>
                  <strong>Totalt antal aktiviteter</strong>
                  <span>{result.activity.coachActivities.total}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Planerade</strong>
                  <span>{result.activity.coachActivities.planned}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Slutförda</strong>
                  <span>{result.activity.coachActivities.completed}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Avbrutna</strong>
                  <span>{result.activity.coachActivities.cancelled}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Slutförandegrad</strong>
                  <span>
                    {formatRate(
                      result.activity.coachActivities.completion.rate,
                    )}
                  </span>
                </article>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Historiskt läge</p>
                  <h2>Per {asOfDate}</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                <article className={styles.candidateRow}>
                  <strong>Öppna uppföljningar</strong>
                  <span>{result.time.followUps.stateAsOf.open}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Försenade uppföljningar</strong>
                  <span>{result.time.followUps.stateAsOf.overdue}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Slutförda uppföljningar</strong>
                  <span>{result.time.followUps.stateAsOf.completed}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Planerade jobbcoachaktiviteter</strong>
                  <span>{result.time.coachActivities.stateAsOf.planned}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Slutförda jobbcoachaktiviteter</strong>
                  <span>{result.time.coachActivities.stateAsOf.completed}</span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Avbrutna jobbcoachaktiviteter</strong>
                  <span>{result.time.coachActivities.stateAsOf.cancelled}</span>
                </article>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Tidsmått</p>
                  <h2>Tid till ansökningssteg</h2>
                </div>
              </div>

              <div className={styles.candidateList}>
                <article className={styles.candidateRow}>
                  <strong>Genomsnittlig tid till ansökt</strong>
                  <span>
                    {formatDuration(
                      result.time.applications.timeToApplied
                        .averageMilliseconds,
                    )}
                  </span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Genomsnittlig tid till intervju</strong>
                  <span>
                    {formatDuration(
                      result.time.applications.timeToInterview
                        .averageMilliseconds,
                    )}
                  </span>
                </article>

                <article className={styles.candidateRow}>
                  <strong>Genomsnittlig tid till erbjudande</strong>
                  <span>
                    {formatDuration(
                      result.time.applications.timeToOffer.averageMilliseconds,
                    )}
                  </span>
                </article>
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
