import Link from "next/link";

import { loadCandidateOperationalOverview } from "@/lib/candidate-overview";
import { loadCandidateFollowUps } from "@/lib/candidate-follow-ups";
import {
  completeFollowUpAction,
  createActivityAction,
  createFollowUpAction,
  createGoalAction,
  createNoteAction,
  transitionActivityAction,
  transitionGoalAction,
  updateNoteAction,
} from "./actions";
import { loadCandidateNotes } from "@/lib/candidate-notes";
import styles from "../../page.module.css";

export const dynamic = "force-dynamic";

interface CandidatePageProps {
  params: Promise<{
    candidateId: string;
  }>;
}

function formatStatusLabel(status: string) {
  switch (status) {
    case "planned":
      return "Planerad";
    case "inProgress":
      return "Pågående";
    case "completed":
      return "Slutförd";
    case "cancelled":
      return "Avbruten";
    default:
      return status;
  }
}

function formatActivityKindLabel(kind: string) {
  switch (kind) {
    case "applyForJob":
      return "Sök jobb";
    case "updateCv":
      return "Uppdatera CV";
    case "coachingMeeting":
      return "Coachmöte";
    default:
      return kind;
  }
}

function formatDate(value?: string | null) {
  if (!value) return "—";

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("sv-SE");
}

export default async function CandidatePage({
  params,
}: CandidatePageProps) {
  const { candidateId } = await params;
  const result = await loadCandidateOperationalOverview(candidateId);
  const followUpResult = await loadCandidateFollowUps(candidateId);
  const noteResult = await loadCandidateNotes(candidateId);

  const candidate = result.candidate;
  const overview = result.overview;

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
          <span className={styles.navItem}>Jobs</span>
          <Link href="/candidates" className={`${styles.navItem} ${styles.active}`}>
            Kandidater
          </Link>
          <Link href="/applications" className={styles.navItem}>
            Ansökningar
          </Link>
          <Link href="/coach" className={styles.navItem}>
            Jobbcoach
          </Link>
          <Link href="/reports" className={styles.navItem}>
            Rapporter
          </Link>
        </nav>
      </aside>

      <main className={styles.main}>
        <div className={styles.topbar}>
          <div>
            <p className={styles.eyebrow}>Jobbcoachens arbetsyta</p>
            <h2>{candidate?.displayName ?? "Kandidatöversikt"}</h2>
            <p className={styles.subtitle}>
              Operativ data från jobbcoachens befintliga arbetsflöden.
            </p>
          </div>

          <Link href="/candidates" className={styles.secondaryButton}>
            Tillbaka till kandidater
          </Link>
        </div>

        {!result.configured ? (
          <section className={styles.panel}>
            <h3>Jobbcoachens arbetsyta är inte konfigurerad</h3>
            <p>
              Ange COACH_DIR innan kandidatdata kan laddas.
            </p>
          </section>
        ) : result.error ? (
          <section className={styles.panel}>
            <h3>Kandidatdata kunde inte laddas</h3>
            <pre className={styles.errorBlock}>
              {JSON.stringify(result.error, null, 2)}
            </pre>
          </section>
        ) : !candidate ? (
          <section className={styles.panel}>
            <h3>Kandidaten hittades inte</h3>
            <p>Ingen kandidatpost hittades för {candidateId}.</p>
          </section>
        ) : (
          <>
            <section className={styles.panel}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>Kandidat</p>
                  <h3>{candidate.displayName}</h3>
                </div>
              </div>

              <div className={styles.candidateMeta}>
                <span>ID: {candidate.id}</span>
                <span>Skapad: {formatDate(candidate.createdAt)}</span>
                <span>Uppdaterad: {formatDate(candidate.updatedAt)}</span>
              </div>
            </section>

            {!result.applicationRepositoryConfigured ? (
              <section className={styles.panel}>
                <h3>Ansökningsarkivet är inte konfigurerat</h3>
                <p>
                  Kandidatens metadata är tillgänglig, men operativ ansökningsdata,
                  data för uppföljningar, mål och aktiviteter kräver
                  APPLICATION_REPOSITORY.
                </p>
              </section>
            ) : overview ? (
              <>
                <section className={styles.statsGrid}>
                  <article className={styles.statCard}>
                    <p>Planerade mål</p>
                    <strong>{overview.goalCounts.planned}</strong>
                  </article>

                  <article className={styles.statCard}>
                    <p>Pågående mål</p>
                    <strong>{overview.goalCounts.inProgress}</strong>
                  </article>

                  <article className={styles.statCard}>
                    <p>Försenade mål</p>
                    <strong>{overview.goalCounts.overdue}</strong>
                  </article>

                  <article className={styles.statCard}>
                    <p>Planerade aktiviteter</p>
                    <strong>{overview.activityCounts.planned}</strong>
                  </article>
                </section>

                <section className={styles.panel}>
                  <div className={styles.sectionHeading}>
                    <div>
                      <p className={styles.eyebrow}>Uppföljningar</p>
                      <h3>Kandidatens uppföljningar</h3>
                    </div>

                    <span>{followUpResult.followUps.length}</span>
                  </div>

                  {!followUpResult.configured ? (
                    <p>Arbetsflödet för uppföljningar är inte konfigurerat.</p>
                  ) : followUpResult.error ? (
                    <pre className={styles.errorBlock}>
                      {JSON.stringify(followUpResult.error, null, 2)}
                    </pre>
                  ) : (
                    <>
                      <form action={createFollowUpAction}>
                        <input
                          type="hidden"
                          name="candidateId"
                          value={candidate.id}
                        />

                        <div className={styles.candidateMeta}>
                          <label>
                            Förfallodatum
                            <input
                              type="datetime-local"
                              name="dueAt"
                              required
                            />
                          </label>
                        </div>

                        <button
                          type="submit"
                          className={styles.secondaryButton}
                        >
                          Skapa uppföljning
                        </button>
                      </form>

                      {followUpResult.followUps.length === 0 ? (
                        <p>Inga uppföljningar hittades.</p>
                      ) : (
                        <div className={styles.candidateList}>
                          {followUpResult.followUps.map((followUp) => (
                            <article
                              key={followUp.id}
                              className={styles.candidateRow}
                            >
                              <div>
                                <strong>
                                  {followUp.completedAt
                                    ? "Slutförd uppföljning"
                                    : "Öppen uppföljning"}
                                </strong>

                                <div className={styles.candidateMeta}>
                                  <span>
                                    Förfaller: {formatDate(followUp.dueAt)}
                                  </span>

                                  {followUp.applicationId ? (
                                    <span>
                                      Ansökan: {followUp.applicationId}
                                    </span>
                                  ) : null}

                                  {followUp.completedAt ? (
                                    <span>
                                      Slutförd:{" "}
                                      {formatDate(followUp.completedAt)}
                                    </span>
                                  ) : null}
                                </div>
                              </div>

                              {!followUp.completedAt ? (
                                <form action={completeFollowUpAction}>
                                  <input
                                    type="hidden"
                                    name="candidateId"
                                    value={candidate.id}
                                  />

                                  <input
                                    type="hidden"
                                    name="followUpId"
                                    value={followUp.id}
                                  />

                                  <button
                                    type="submit"
                                    className={styles.secondaryButton}
                                  >
                                    Complete
                                  </button>
                                </form>
                              ) : null}
                            </article>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </section>

                <section className={styles.panel}>
                  <div className={styles.sectionHeading}>
                    <div>
                      <p className={styles.eyebrow}>Jobbcoachens anteckningar</p>
                      <h3>Kandidatens anteckningar</h3>
                    </div>

                    <span>{noteResult.notes.length}</span>
                  </div>

                  {!noteResult.configured ? (
                    <p>Arbetsflödet för jobbcoachens anteckningar är inte konfigurerat.</p>
                  ) : noteResult.error ? (
                    <pre className={styles.errorBlock}>
                      {JSON.stringify(noteResult.error, null, 2)}
                    </pre>
                  ) : (
                    <>
                      <form action={createNoteAction}>
                        <input
                          type="hidden"
                          name="candidateId"
                          value={candidate.id}
                        />

                        <label>
                          New note
                          <textarea
                            name="text"
                            rows={4}
                            required
                            placeholder="Lägg till en privat anteckning..."
                          />
                        </label>

                        <button
                          type="submit"
                          className={styles.secondaryButton}
                        >
                          Skapa anteckning
                        </button>
                      </form>

                      {noteResult.notes.length === 0 ? (
                        <p>Inga anteckningar hittades.</p>
                      ) : (
                        <div className={styles.candidateList}>
                          {noteResult.notes.map((note) => (
                            <article
                              key={note.id}
                              className={styles.candidateRow}
                            >
                              <form action={updateNoteAction}>
                                <input
                                  type="hidden"
                                  name="candidateId"
                                  value={candidate.id}
                                />

                                <input
                                  type="hidden"
                                  name="noteId"
                                  value={note.id}
                                />

                                <textarea
                                  name="text"
                                  rows={4}
                                  required
                                  defaultValue={note.text}
                                />

                                <div className={styles.candidateMeta}>
                                  <span>
                                    Skapad: {formatDate(note.createdAt)}
                                  </span>
                                  <span>
                                    Uppdaterad: {formatDate(note.updatedAt)}
                                  </span>
                                </div>

                                <button
                                  type="submit"
                                  className={styles.secondaryButton}
                                >
                                  Uppdatera anteckning
                                </button>
                              </form>
                            </article>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </section>

                <div className={styles.dashboardGrid}>
                  <section className={styles.panel}>
                    <div className={styles.sectionHeading}>
                      <h3>Mål</h3>
                      <span>{overview.goals.length}</span>
                    </div>

                    <form action={createGoalAction}>
                      <input
                        type="hidden"
                        name="candidateId"
                        value={candidate.id}
                      />

                      <div className={styles.candidateMeta}>
                        <label>
                          Målets titel
                          <input
                            type="text"
                            name="title"
                            required
                          />
                        </label>

                        <label>
                          Förfallodatum
                          <input
                            type="datetime-local"
                            name="dueAt"
                          />
                        </label>
                      </div>

                      <label>
                        Beskrivning
                        <textarea
                          name="description"
                          rows={3}
                        />
                      </label>

                      <button
                        type="submit"
                        className={styles.secondaryButton}
                      >
                        Skapa mål
                      </button>
                    </form>

                    {overview.goals.length === 0 ? (
                      <p>Inga mål hittades.</p>
                    ) : (
                      <div className={styles.candidateList}>
                        {overview.goals.map((goal) => (
                          <article key={goal.id} className={styles.candidateRow}>
                            <div>
                              <strong>{goal.title}</strong>

                              <div className={styles.candidateMeta}>
                                <span>Status: {formatStatusLabel(goal.status)}</span>
                                <span>Förfaller: {formatDate(goal.dueAt)}</span>
                                {goal.overdue ? <span>Försenad</span> : null}
                              </div>
                            </div>

                            {goal.status !== "completed" &&
                            goal.status !== "cancelled" ? (
                              <form action={transitionGoalAction}>
                                <input
                                  type="hidden"
                                  name="candidateId"
                                  value={candidate.id}
                                />

                                <input
                                  type="hidden"
                                  name="goalId"
                                  value={goal.id}
                                />

                                <select name="status" required>
                                  <option value="">Ändra status</option>

                                  {goal.status !== "planned" ? (
                                    <option value="planned">Planerad</option>
                                  ) : null}

                                  {goal.status !== "inProgress" ? (
                                    <option value="inProgress">
                                      In progress
                                    </option>
                                  ) : null}

                                  <option value="completed">
                                    Slutförd
                                  </option>

                                  <option value="cancelled">
                                    Avbruten
                                  </option>
                                </select>

                                <button
                                  type="submit"
                                  className={styles.secondaryButton}
                                >
                                  Update
                                </button>
                              </form>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className={styles.panel}>
                    <div className={styles.sectionHeading}>
                      <h3>Aktiviteter</h3>
                      <span>{overview.activities.length}</span>
                    </div>

                    <form action={createActivityAction}>
                      <input
                        type="hidden"
                        name="candidateId"
                        value={candidate.id}
                      />

                      <div className={styles.candidateMeta}>
                        <label>
                          Activity
                          <select name="kind" required defaultValue="">
                            <option value="" disabled>
                              Select activity
                            </option>
                            <option value="applyForJob">Sök jobb</option>
                            <option value="updateCv">Uppdatera CV</option>
                            <option value="contactEmployer">
                              Contact employer
                            </option>
                            <option value="attendInterview">
                              Attend interview
                            </option>
                            <option value="completeCourseStep">
                              Complete course step
                            </option>
                            <option value="coachingMeeting">
                              Coachmöte
                            </option>
                          </select>
                        </label>

                        <label>
                          Planerat datum
                          <input
                            type="datetime-local"
                            name="plannedAt"
                          />
                        </label>
                      </div>

                      <button
                        type="submit"
                        className={styles.secondaryButton}
                      >
                        Skapa aktivitet
                      </button>
                    </form>

                    {overview.activities.length === 0 ? (
                      <p>Inga aktiviteter hittades.</p>
                    ) : (
                      <div className={styles.candidateList}>
                        {overview.activities.map((activity) => (
                          <article
                            key={activity.id}
                            className={styles.candidateRow}
                          >
                            <div>
                              <strong>
                                {activity.kind === "applyForJob"
                                  ? "Sök jobb"
                                  : activity.kind === "updateCv"
                                    ? "Uppdatera CV"
                                    : activity.kind === "contactEmployer"
                                      ? "Contact employer"
                                      : activity.kind === "attendInterview"
                                        ? "Attend interview"
                                        : activity.kind === "completeCourseStep"
                                          ? "Complete course step"
                                          : "Coachmöte"}
                              </strong>

                              <div className={styles.candidateMeta}>
                                <span>Status: {formatStatusLabel(activity.status)}</span>
                                <span>
                                  Planerad: {formatDate(activity.plannedAt)}
                                </span>
                              </div>
                            </div>

                            {activity.status === "planned" ? (
                              <form action={transitionActivityAction}>
                                <input
                                  type="hidden"
                                  name="candidateId"
                                  value={candidate.id}
                                />

                                <input
                                  type="hidden"
                                  name="activityId"
                                  value={activity.id}
                                />

                                <select name="status" required defaultValue="">
                                  <option value="" disabled>
                                    Ändra status
                                  </option>
                                  <option value="completed">Slutförd</option>
                                  <option value="cancelled">Avbruten</option>
                                </select>

                                <button
                                  type="submit"
                                  className={styles.secondaryButton}
                                >
                                  Update
                                </button>
                              </form>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                </div>

                <section className={styles.panel}>
                  <div className={styles.sectionHeading}>
                    <h3>Nästa planerade aktivitet</h3>
                  </div>

                  {overview.nextPlannedActivity ? (
                    <div className={styles.candidateRow}>
                      <div>
                        <strong>{formatActivityKindLabel(overview.nextPlannedActivity.kind)}</strong>
                        <div className={styles.candidateMeta}>
                          <span>
                            Planerad:{" "}
                            {formatDate(
                              overview.nextPlannedActivity.plannedAt,
                            )}
                          </span>
                          <span>
                            Status: {formatStatusLabel(overview.nextPlannedActivity.status)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p>Ingen planerad aktivitet hittades.</p>
                  )}
                </section>
              </>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
