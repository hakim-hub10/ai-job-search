import { reviewProfileQuality } from "@/lib/profile-quality";
import PersonalNavigation from "@/components/personal-navigation";
import Link from "next/link";
import StructuredProfileFields from "@/components/structured-profile-fields";
import { profileCompletionIssues } from "@/lib/profile-evidence";

import { loadCandidateOperationalOverview } from "@/lib/candidate-overview";
import { loadCandidateFollowUps } from "@/lib/candidate-follow-ups";
import { loadCandidateProfile } from "@/lib/candidate-profiles";
import { loadCandidateBaseCvState } from "@/lib/candidate-base-cv-state";
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
import { saveCandidateProfileAction } from "./profile-actions";
import {
  createBaseCvAction,
  updateBaseCvAction,
} from "./base-cv-actions";
import { loadCandidateNotes } from "@/lib/candidate-notes";
import { configuredAuthorizationDependencies, requireOwnedCandidate } from "@/lib/authorization";
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
      return "Möte";
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
  const authorization = configuredAuthorizationDependencies();
  const owned = authorization.ok
    ? await requireOwnedCandidate(candidateId, authorization.value)
    : authorization;
  if (!owned.ok) {
    return <main className={styles.main}><section className={styles.panel}><h1>Kandidatöversikten kunde inte visas</h1><p>Resursen kunde inte hittas.</p></section></main>;
  }
  const result = await loadCandidateOperationalOverview(candidateId);
  const followUpResult = await loadCandidateFollowUps(candidateId);
  const noteResult = await loadCandidateNotes(candidateId);
  const profileResult = await loadCandidateProfile(candidateId);
  const baseCvResult = await loadCandidateBaseCvState(candidateId);

  const candidate = result.candidate;
  const overview = result.overview;

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div>
          <p className={styles.eyebrow}>AI-jobbcoach</p>
          <h1 className={styles.brand}>Min arbetsyta</h1>
        </div>

        <PersonalNavigation candidateId={candidateId} active="profile" />
      </aside>

      <main className={styles.main}>
        <div className={styles.topbar}>
          <div>
            <p className={styles.eyebrow}>Min profil</p>
            <h2>{candidate?.displayName ?? "Kandidatöversikt"}</h2>
            <p className={styles.subtitle}>
              Hantera din profil och ditt grund-CV för jobbsökningen.
            </p>
          </div>

          <Link href="/" className={styles.secondaryButton}>
            Till översikten
          </Link>
          <Link href={`/candidates/${encodeURIComponent(candidateId)}/onboarding`} className={styles.secondaryButton}>
            Uppdatera profil från CV
          </Link>
        </div>

        {!result.configured ? (
          <section className={styles.panel}>
            <h3>Profilen kunde inte laddas just nu</h3>
            <p>Försök igen senare.</p>
          </section>
        ) : result.error ? (
          <section className={styles.panel}>
            <h3>Kandidatdata kunde inte laddas</h3>
            <p>Försök igen senare.</p>
          </section>
        ) : !candidate ? (
          <section className={styles.panel}>
            <h3>Kandidaten hittades inte</h3>
            <p>Profilen kunde inte hittas.</p>
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
                <span>Skapad: {formatDate(candidate.createdAt)}</span>
                <span>Uppdaterad: {formatDate(candidate.updatedAt)}</span>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>Kandidatprofil</p>
                  <h3>Profil för jobbmatchning</h3>
                  <p className={styles.formIntro}>
                    Fyll i dina preferenser så att jobbmatchningen kan anpassas
                    efter din erfarenhet och dina mål.
                  </p>
                </div>
              </div>

              {profileResult.profile && profileCompletionIssues(profileResult.profile).length > 0 && <p role="status">Att komplettera eller kontrollera: {profileCompletionIssues(profileResult.profile).join(", ")}. Lägg till uppgifter där det är relevant för dig.</p>}
              {!profileResult.configured ? (
                <p>Profilen kan inte sparas just nu. Försök igen senare.</p>
              ) : profileResult.error ? (
                <section>
                  <h4>Kandidatprofilen kunde inte laddas</h4>
                  <p>Ett tekniskt fel uppstod när profilinformationen lästes.</p>
                </section>
              ) : (
                <form
                  id="profile-editor"
                  action={saveCandidateProfileAction}
                  className={styles.profileForm}
                >
                  <input
                    type="hidden"
                    name="candidateId"
                    value={candidate.id}
                  />

                  {profileResult.profile && <details>
                    <summary>Granska kompetensernas datakvalitet</summary>
                    <p>Inga sparade uppgifter tas bort automatiskt. Granska varje markerat värde: behåll det, flytta texten till rätt erfarenhet eller certifiering, eller ta bort det från kompetensfältet. Ändringarna gäller först när du sparar profilen. Misstänkta värden används inte som kompetenser i nya dokument.</p>
                    <ul>{reviewProfileQuality(profileResult.profile).filter(item => item.suspicious).map(item => <li key={`${item.field}:${item.index}`}><strong>{item.value}</strong> — {item.classification}</li>)}</ul>
                  </details>}

                  <div className={styles.profileGrid}>
                    <label className={styles.profileField}>
                      Yrkesrubrik
                      <input
                        type="text"
                        name="headline"
                        required
                        defaultValue={profileResult.profile?.headline === "Job seeker" ? "" : profileResult.profile?.headline ?? ""}
                        placeholder="Exempel: IT-supporttekniker"
                      />
                    </label>

                    <label className={styles.profileField}>
                      Antal års erfarenhet
                      <input
                        type="number"
                        name="yearsOfExperience"
                        min="0"
                        step="0.5"
                        required
                        defaultValue={
                          profileResult.profile?.yearsOfExperience ?? ""
                        }
                      />
                    </label>

                    <label className={styles.profileField}>
                      Arbetsform
                      <select
                        name="workMode"
                        required
                        defaultValue={profileResult.profile?.workMode ?? ""}
                      >
                        <option value="" disabled>
                          Välj arbetsform
                        </option>
                        <option value="open">Öppen</option>
                        <option value="onsite">På plats</option>
                        <option value="hybrid">Hybrid</option>
                        <option value="remote">Distans</option>
                      </select>
                    </label>

                    <label className={styles.profileCheckbox}>
                      <input
                        type="checkbox"
                        name="remotePreference"
                        defaultChecked={
                          profileResult.profile?.remotePreference ?? false
                        }
                      />
                      Öppen för distansarbete
                    </label>
                  </div>

                  <div className={styles.profileGrid}>
                  <label className={styles.profileField}>
                    Målroller
                    <textarea
                      name="targetRoles"
                      rows={4}
                      defaultValue={
                        profileResult.profile?.targetRoles.join("\n") ?? ""
                      }
                      placeholder={"IT Support\nIT Coordinator"}
                    />
                  </label>

                  <label className={styles.profileField}>
                    Önskade orter
                    <textarea
                      name="locationPreferences"
                      rows={4}
                      defaultValue={
                        profileResult.profile?.locationPreferences.join("\n") ??
                        ""
                      }
                      placeholder={"Jönköping\nGöteborg"}
                    />
                  </label>

                  <label className={styles.profileField}>
                    Branscher
                    <textarea
                      name="preferredIndustries"
                      rows={4}
                      defaultValue={
                        profileResult.profile?.preferredIndustries.join("\n") ??
                        ""
                      }
                      placeholder={"IT\nTeknik"}
                    />
                  </label>
                  </div>

                  <fieldset className={styles.profileFieldset}>
                    <legend>Anställningsformer</legend>

                    <div className={styles.profileOptions}>
                    {[
                      ["full-time", "Heltid"],
                      ["part-time", "Deltid"],
                      ["contract", "Konsult / kontrakt"],
                      ["temporary", "Visstid"],
                      ["internship", "Praktik"],
                      ["open", "Öppen"],
                    ].map(([value, label]) => (
                      <label key={value} className={styles.profileOption}>
                        <input
                          type="checkbox"
                          name="preferredEmploymentType"
                          value={value}
                          defaultChecked={
                            profileResult.profile?.preferredEmploymentType.includes(
                              value as
                                | "full-time"
                                | "part-time"
                                | "contract"
                                | "temporary"
                                | "internship"
                                | "open",
                            ) ?? false
                          }
                        />
                        {label}
                      </label>
                    ))}
                    </div>
                  </fieldset>

                  <div className={styles.profileGrid}>
                  <label className={`${styles.profileField} ${styles.profileFieldWide}`}>
                    Tekniska kompetenser
                    <textarea
                      name="technicalSkills"
                      rows={6}
                      defaultValue={
                        profileResult.profile?.skills.technical.join("\n") ?? ""
                      }
                      placeholder={"Microsoft 365\nAzure\nLinux"}
                    />
                  </label>

                  <label className={styles.profileField}>
                    Mjuka kompetenser
                    <textarea
                      name="softSkills"
                      rows={5}
                      defaultValue={
                        profileResult.profile?.skills.soft.join("\n") ?? ""
                      }
                      placeholder={"Kommunikation\nProblemlösning"}
                    />
                  </label>

                  <label className={styles.profileField}>
                    Certifieringar
                    <textarea
                      name="certifications"
                      rows={5}
                      defaultValue={
                        profileResult.profile?.certifications.join("\n") ?? ""
                      }
                      placeholder={"CompTIA A+\nAZ-104"}
                    />
                  </label>

                  <label className={styles.profileField}>
                    Språk
                    <textarea
                      name="languages"
                      rows={5}
                      defaultValue={
                        profileResult.profile?.languages
                          .map(
                            (language) =>
                              `${language.name} | ${language.level}`,
                          )
                          .join("\n") ?? ""
                      }
                      placeholder={
                        "Svenska | Professionell\nEngelska | Professionell"
                      }
                    />
                    <span className={styles.profileHelper}>
                      Ett språk per rad i formatet: Språk | Nivå
                    </span>
                  </label>

                  <label className={styles.profileField}>
                    Karriärmål
                    <textarea
                      name="careerGoals"
                      rows={5}
                      defaultValue={
                        profileResult.profile?.careerGoals.join("\n") ?? ""
                      }
                      placeholder={"Arbeta inom IT-support\nUtvecklas inom cloud"}
                    />
                  </label>

                  <label className={`${styles.profileField} ${styles.profileFieldWide}`}>
                    Sammanfattning
                    <textarea
                      name="summary"
                      rows={6}
                      defaultValue={profileResult.profile?.summary ?? ""}
                      placeholder="Kort professionell sammanfattning"
                    />
                  </label>
                  </div>

                  <StructuredProfileFields profile={profileResult.profile} />
                  <p>När du sparar uppdateras erfarenhet, utbildning och kompetenser i ditt grund-CV. Anpassad rubrik, sammanfattning och synlighet i grund-CV:t bevaras.</p>
                  <div className={styles.profileActions}>
                    <button
                      type="submit"
                      className={styles.secondaryButton}
                    >
                      Spara kandidatprofil
                    </button>
                  </div>
                </form>
              )}
            </section>

            <section className={styles.panel}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>Dokumentgrund</p>
                  <h3>Grund-CV</h3>
                </div>
              </div>

              {!baseCvResult.ok ? (
                <>
                  <p>
                    {baseCvResult.code === "PROFILE_NOT_FOUND"
                      ? "Kandidatprofil saknas. Lägg till profilinformation innan du skapar ett grund-CV."
                      : "Grund-CV:t kunde inte laddas just nu."}
                  </p>
                </>
              ) : !baseCvResult.baseCv ? (
                <>
                  <p>Grund-CV är inte skapat ännu.</p>
                  <p>Kandidatprofil: Tillgänglig</p>
                  <form action={createBaseCvAction}>
                    <input
                      type="hidden"
                      name="candidateId"
                      value={candidate.id}
                    />
                    <button type="submit" className={styles.secondaryButton}>
                      Skapa grund-CV från kandidatprofil
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <p>
                    Senast uppdaterat: {formatDate(baseCvResult.baseCv.updatedAt)}
                  </p>

                  {profileCompletionIssues(baseCvResult.baseCv).length > 0 && <p role="status">Grund-CV:t behöver kompletteras eller kontrolleras: {profileCompletionIssues(baseCvResult.baseCv).join(", ")}. <a href="#profile-editor">Öppna profiluppgifterna</a>.</p>}
                  <div className={styles.baseCvContent}>
                    {baseCvResult.baseCv.visibility.headline ? (
                      <section>
                        <h4>Yrkesrubrik</h4>
                        <p>{baseCvResult.baseCv.headline}</p>
                      </section>
                    ) : null}

                    {baseCvResult.baseCv.visibility.summary &&
                    baseCvResult.baseCv.summary ? (
                      <section>
                        <h4>Profil</h4>
                        <p>{baseCvResult.baseCv.summary}</p>
                      </section>
                    ) : null}

                    {baseCvResult.baseCv.visibility.workExperience &&
                    baseCvResult.baseCv.workExperience.length > 0 ? (
                      <section>
                        <h4>Erfarenhet</h4>
                        {baseCvResult.baseCv.workExperience.map((experience) => (
                          <p key={`${experience.title}-${experience.company}`}>
                            <strong>{experience.title}</strong>, {experience.company}
                            {experience.summary ? `: ${experience.summary}` : ""}
                          </p>
                        ))}
                      </section>
                    ) : null}

                    {baseCvResult.baseCv.visibility.education &&
                    baseCvResult.baseCv.education.length > 0 ? (
                      <section>
                        <h4>Utbildning</h4>
                        {baseCvResult.baseCv.education.map((education) => (
                          <p key={`${education.degree}-${education.institution}`}>
                            {education.degree}, {education.field} ({education.institution})
                          </p>
                        ))}
                      </section>
                    ) : null}

                    {baseCvResult.baseCv.visibility.technicalSkills &&
                    baseCvResult.baseCv.technicalSkills.length > 0 ? (
                      <section>
                        <h4>Tekniska kompetenser</h4>
                        <p>{baseCvResult.baseCv.technicalSkills.join(", ")}</p>
                      </section>
                    ) : null}

                    {baseCvResult.baseCv.visibility.softSkills &&
                    baseCvResult.baseCv.softSkills.length > 0 ? (
                      <section>
                        <h4>Mjuka kompetenser</h4>
                        <p>{baseCvResult.baseCv.softSkills.join(", ")}</p>
                      </section>
                    ) : null}

                    {baseCvResult.baseCv.visibility.certifications &&
                    baseCvResult.baseCv.certifications.length > 0 ? (
                      <section>
                        <h4>Certifieringar</h4>
                        <p>{baseCvResult.baseCv.certifications.join(", ")}</p>
                      </section>
                    ) : null}

                    {baseCvResult.baseCv.visibility.languages &&
                    baseCvResult.baseCv.languages.length > 0 ? (
                      <section>
                        <h4>Språk</h4>
                        <p>
                          {baseCvResult.baseCv.languages
                            .map((language) => `${language.name} (${language.level})`)
                            .join(", ")}
                        </p>
                      </section>
                    ) : null}

                    {baseCvResult.baseCv.visibility.projects &&
                    (baseCvResult.baseCv.projects?.length ?? 0) > 0 ? (
                      <section>
                        <h4>Projekt</h4>
                        {baseCvResult.baseCv.projects!.map((project) => (
                          <p key={project.title}>
                            <strong>{project.title}</strong>
                            {project.description ? `: ${project.description}` : ""}
                            {project.technologies?.length ? ` (${project.technologies.join(", ")})` : ""}
                          </p>
                        ))}
                      </section>
                    ) : null}
                  </div>

                  <details className={styles.baseCvEditor}>
                    <summary>Redigera grund-CV</summary>
                    <p>Erfarenhet, utbildning, kompetenser, certifieringar och språk hämtas från din profil vid varje profilsparning. <a href="#profile-editor">Redigera dessa uppgifter i profilen</a>. Här kan du anpassa rubrik, sammanfattning och vilka avsnitt som visas.</p>
                    <form action={updateBaseCvAction} className={styles.profileForm}>
                      <input
                        type="hidden"
                        name="candidateId"
                        value={candidate.id}
                      />
                      <label className={styles.profileField}>
                        Yrkesrubrik
                        <input
                          type="text"
                          name="headline"
                          required
                          defaultValue={baseCvResult.baseCv.headline}
                        />
                      </label>
                      <label className={styles.profileField}>
                        Profiltext
                        <textarea
                          name="summary"
                          rows={5}
                          defaultValue={baseCvResult.baseCv.summary ?? ""}
                        />
                      </label>
                      <fieldset className={styles.profileFieldset}>
                        <legend>Visa avsnitt</legend>
                        <div className={styles.profileOptions}>
                          {([
                            ["headline", "Yrkesrubrik"],
                            ["summary", "Profil"],
                            ["workExperience", "Erfarenhet"],
                            ["education", "Utbildning"],
                            ["technicalSkills", "Tekniska kompetenser"],
                            ["softSkills", "Mjuka kompetenser"],
                            ["certifications", "Certifieringar"],
                            ["languages", "Språk"],
                            ["projects", "Projekt"],
                          ] as const).map(([key, label]) => (
                            <label key={key} className={styles.profileOption}>
                              <input
                                type="checkbox"
                                name={`visibility.${key}`}
                                defaultChecked={baseCvResult.baseCv?.visibility[key]}
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <button type="submit" className={styles.secondaryButton}>
                        Spara grund-CV
                      </button>
                    </form>
                  </details>
                </>
              )}
            </section>

            {!result.applicationRepositoryConfigured ? (
              <section className={styles.panel}>
                <h3>Ansökningsdata är inte tillgänglig just nu</h3>
                <p>
                  Dina ansökningar och uppföljningar kan inte visas just nu.
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
                    <p>Uppföljningar kunde inte laddas just nu.</p>
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
                                    Slutför
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
                      <p className={styles.eyebrow}>Anteckningar</p>
                      <h3>Kandidatens anteckningar</h3>
                    </div>

                    <span>{noteResult.notes.length}</span>
                  </div>

                  {!noteResult.configured ? (
                    <p>Anteckningar kan inte visas just nu.</p>
                  ) : noteResult.error ? (
                    <p>Anteckningar kunde inte laddas just nu.</p>
                  ) : (
                    <>
                      <form action={createNoteAction}>
                        <input
                          type="hidden"
                          name="candidateId"
                          value={candidate.id}
                        />

                        <label>
                          Ny anteckning
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
                                      Pågående
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
                                  Uppdatera
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
                          Aktivitet
                          <select name="kind" required defaultValue="">
                            <option value="" disabled>
                              Välj aktivitet
                            </option>
                            <option value="applyForJob">Sök jobb</option>
                            <option value="updateCv">Uppdatera CV</option>
                            <option value="contactEmployer">
                              Kontakta arbetsgivare
                            </option>
                            <option value="attendInterview">
                              Gå på intervju
                            </option>
                            <option value="completeCourseStep">
                              Slutför kurssteg
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
                                      ? "Kontakta arbetsgivare"
                                      : activity.kind === "attendInterview"
                                        ? "Gå på intervju"
                                        : activity.kind === "completeCourseStep"
                                          ? "Slutför kurssteg"
                                          : "Möte"}
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
                                  Uppdatera
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
