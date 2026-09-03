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
            Dashboard
          </Link>
          <span className={styles.navItem}>Jobs</span>
          <Link href="/candidates" className={`${styles.navItem} ${styles.active}`}>
            Candidates
          </Link>
          <Link href="/applications" className={styles.navItem}>
            Applications
          </Link>
          <Link href="/coach" className={styles.navItem}>
            Coach
          </Link>
          <Link href="/reports" className={styles.navItem}>
            Reports
          </Link>
        </nav>
      </aside>

      <main className={styles.main}>
        <div className={styles.topbar}>
          <div>
            <p className={styles.eyebrow}>Coach workspace</p>
            <h2>{candidate?.displayName ?? "Candidate overview"}</h2>
            <p className={styles.subtitle}>
              Operational data from the existing coach workflows.
            </p>
          </div>

          <Link href="/candidates" className={styles.secondaryButton}>
            Back to candidates
          </Link>
        </div>

        {!result.configured ? (
          <section className={styles.panel}>
            <h3>Coach workspace not configured</h3>
            <p>
              Set COACH_DIR before candidate data can be loaded.
            </p>
          </section>
        ) : result.error ? (
          <section className={styles.panel}>
            <h3>Candidate data could not be loaded</h3>
            <pre className={styles.errorBlock}>
              {JSON.stringify(result.error, null, 2)}
            </pre>
          </section>
        ) : !candidate ? (
          <section className={styles.panel}>
            <h3>Candidate not found</h3>
            <p>No candidate record was found for {candidateId}.</p>
          </section>
        ) : (
          <>
            <section className={styles.panel}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>Candidate</p>
                  <h3>{candidate.displayName}</h3>
                </div>
              </div>

              <div className={styles.candidateMeta}>
                <span>ID: {candidate.id}</span>
                <span>Created: {formatDate(candidate.createdAt)}</span>
                <span>Updated: {formatDate(candidate.updatedAt)}</span>
              </div>
            </section>

            {!result.applicationRepositoryConfigured ? (
              <section className={styles.panel}>
                <h3>Application repository not configured</h3>
                <p>
                  Candidate metadata is available, but operational application,
                  follow-up, goal, and activity data requires
                  APPLICATION_REPOSITORY.
                </p>
              </section>
            ) : overview ? (
              <>
                <section className={styles.statsGrid}>
                  <article className={styles.statCard}>
                    <p>Goals planned</p>
                    <strong>{overview.goalCounts.planned}</strong>
                  </article>

                  <article className={styles.statCard}>
                    <p>Goals in progress</p>
                    <strong>{overview.goalCounts.inProgress}</strong>
                  </article>

                  <article className={styles.statCard}>
                    <p>Overdue goals</p>
                    <strong>{overview.goalCounts.overdue}</strong>
                  </article>

                  <article className={styles.statCard}>
                    <p>Planned activities</p>
                    <strong>{overview.activityCounts.planned}</strong>
                  </article>
                </section>

                <section className={styles.panel}>
                  <div className={styles.sectionHeading}>
                    <div>
                      <p className={styles.eyebrow}>Follow-ups</p>
                      <h3>Candidate follow-ups</h3>
                    </div>

                    <span>{followUpResult.followUps.length}</span>
                  </div>

                  {!followUpResult.configured ? (
                    <p>Follow-up workflow is not configured.</p>
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
                            Due date
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
                          Create follow-up
                        </button>
                      </form>

                      {followUpResult.followUps.length === 0 ? (
                        <p>No follow-ups found.</p>
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
                                    ? "Completed follow-up"
                                    : "Open follow-up"}
                                </strong>

                                <div className={styles.candidateMeta}>
                                  <span>
                                    Due: {formatDate(followUp.dueAt)}
                                  </span>

                                  {followUp.applicationId ? (
                                    <span>
                                      Application: {followUp.applicationId}
                                    </span>
                                  ) : null}

                                  {followUp.completedAt ? (
                                    <span>
                                      Completed:{" "}
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
                      <p className={styles.eyebrow}>Coach notes</p>
                      <h3>Candidate notes</h3>
                    </div>

                    <span>{noteResult.notes.length}</span>
                  </div>

                  {!noteResult.configured ? (
                    <p>Coach notes workflow is not configured.</p>
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
                            placeholder="Add a private coach note..."
                          />
                        </label>

                        <button
                          type="submit"
                          className={styles.secondaryButton}
                        >
                          Create note
                        </button>
                      </form>

                      {noteResult.notes.length === 0 ? (
                        <p>No coach notes found.</p>
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
                                    Created: {formatDate(note.createdAt)}
                                  </span>
                                  <span>
                                    Updated: {formatDate(note.updatedAt)}
                                  </span>
                                </div>

                                <button
                                  type="submit"
                                  className={styles.secondaryButton}
                                >
                                  Update note
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
                      <h3>Goals</h3>
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
                          Goal title
                          <input
                            type="text"
                            name="title"
                            required
                          />
                        </label>

                        <label>
                          Due date
                          <input
                            type="datetime-local"
                            name="dueAt"
                          />
                        </label>
                      </div>

                      <label>
                        Description
                        <textarea
                          name="description"
                          rows={3}
                        />
                      </label>

                      <button
                        type="submit"
                        className={styles.secondaryButton}
                      >
                        Create goal
                      </button>
                    </form>

                    {overview.goals.length === 0 ? (
                      <p>No goals found.</p>
                    ) : (
                      <div className={styles.candidateList}>
                        {overview.goals.map((goal) => (
                          <article key={goal.id} className={styles.candidateRow}>
                            <div>
                              <strong>{goal.title}</strong>

                              <div className={styles.candidateMeta}>
                                <span>Status: {goal.status}</span>
                                <span>Due: {formatDate(goal.dueAt)}</span>
                                {goal.overdue ? <span>Overdue</span> : null}
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
                                  <option value="">Change status</option>

                                  {goal.status !== "planned" ? (
                                    <option value="planned">Planned</option>
                                  ) : null}

                                  {goal.status !== "inProgress" ? (
                                    <option value="inProgress">
                                      In progress
                                    </option>
                                  ) : null}

                                  <option value="completed">
                                    Completed
                                  </option>

                                  <option value="cancelled">
                                    Cancelled
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
                      <h3>Activities</h3>
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
                            <option value="applyForJob">Apply for job</option>
                            <option value="updateCv">Update CV</option>
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
                              Coaching meeting
                            </option>
                          </select>
                        </label>

                        <label>
                          Planned date
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
                        Create activity
                      </button>
                    </form>

                    {overview.activities.length === 0 ? (
                      <p>No activities found.</p>
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
                                  ? "Apply for job"
                                  : activity.kind === "updateCv"
                                    ? "Update CV"
                                    : activity.kind === "contactEmployer"
                                      ? "Contact employer"
                                      : activity.kind === "attendInterview"
                                        ? "Attend interview"
                                        : activity.kind === "completeCourseStep"
                                          ? "Complete course step"
                                          : "Coaching meeting"}
                              </strong>

                              <div className={styles.candidateMeta}>
                                <span>Status: {activity.status}</span>
                                <span>
                                  Planned: {formatDate(activity.plannedAt)}
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
                                    Change status
                                  </option>
                                  <option value="completed">Completed</option>
                                  <option value="cancelled">Cancelled</option>
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
                    <h3>Next planned activity</h3>
                  </div>

                  {overview.nextPlannedActivity ? (
                    <div className={styles.candidateRow}>
                      <div>
                        <strong>{overview.nextPlannedActivity.kind}</strong>
                        <div className={styles.candidateMeta}>
                          <span>
                            Planned:{" "}
                            {formatDate(
                              overview.nextPlannedActivity.plannedAt,
                            )}
                          </span>
                          <span>
                            Status: {overview.nextPlannedActivity.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p>No planned activity found.</p>
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
