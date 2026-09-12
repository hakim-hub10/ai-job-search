import PersonalNavigation from "@/components/personal-navigation";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getAuthenticatedUser } from "@/lib/auth-session";
import { getOrCreateOwnedCandidateForUser } from "@/lib/job-seeker-ownership";
import { loadCandidateProfile } from "@/lib/candidate-profiles";
import { loadCandidateBaseCvState } from "@/lib/candidate-base-cv-state";
import { loadApplications } from "@/lib/applications";
import { buildPersonalDashboardModel } from "@/lib/personal-dashboard";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const statusLabels: Record<string, string> = {
  saved: "Sparad",
  preparing: "Förbereds",
  applied: "Ansökt",
  interview: "Intervju",
  offer: "Erbjudande",
  rejected: "Avslagen",
  withdrawn: "Tillbakadragen",
  closed: "Avslutad",
};

export default async function Home() {
  let user = null;
  try {
    user = await getAuthenticatedUser();
  } catch {
    user = null;
  }
  if (!user) {
    return <main className={styles.main}><section className={styles.panel}><p className={styles.eyebrow}>AI-jobbcoach</p><h1>Din jobbsökning börjar här</h1><p>Logga in för att fortsätta till din profil och dina jobb.</p><p><Link href="/login">Logga in</Link> · <Link href="/register">Skapa konto</Link></p></section></main>;
  }

  const owned = await getOrCreateOwnedCandidateForUser(user);
  if (!owned.ok) return <main className={styles.main}><section className={styles.panel}><h1>Din profil kunde inte laddas</h1><p>Försök igen senare.</p></section></main>;
  const candidateId = owned.value.id;
  const profile = await loadCandidateProfile(candidateId);
  if (!profile.profile) redirect(`/candidates/${encodeURIComponent(candidateId)}/onboarding`);

  const [baseCvState, applications] = await Promise.all([
    loadCandidateBaseCvState(candidateId),
    loadApplications(candidateId),
  ]);
  const model = buildPersonalDashboardModel(candidateId, {
    profile: profile.profile,
    baseCv: baseCvState.ok ? baseCvState.baseCv : null,
    applications: applications.error ? [] : applications.applications,
  });

  return <div className={styles.shell}>
    <aside className={styles.sidebar}>
      <div className={styles.brand}><div className={styles.logoMark}>AC</div><div><strong>AI Career Agent</strong><span>Din jobbsökning</span></div></div>
      <PersonalNavigation candidateId={candidateId} active="overview" />
      <div className={styles.sidebarFooter}><span>Personlig arbetsyta</span><small>Din profil och dina ansökningar</small></div>
    </aside>

    <main className={styles.main}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>Översikt</p><h1>Hej, {user.name || "där"}</h1><p className={styles.subtitle}>Här ser du din profilstatus, dina ansökningar och nästa steg.</p></div>
        <Link href={`/candidates/${encodeURIComponent(candidateId)}`}>Öppna min profil</Link>
      </header>

      <section className={styles.cards}>
        <article className={styles.card}><span>Profil</span><strong>Klar</strong><small>Din profil är redo för matchning</small></article>
        <article className={styles.card}><span>Grund-CV</span><strong>{model.baseCvReady ? "Klar" : "Saknas"}</strong><small>{model.baseCvReady ? "Redo att användas i ansökningar" : "Skapa ett grund-CV"}</small></article>
        <article className={styles.card}><span>Ansökningar</span><strong>{model.applicationCount}</strong><small>{model.applicationCount === 1 ? "Sparad ansökan" : "Sparade ansökningar"}</small></article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}><p className={styles.eyebrow}>Nästa steg</p><h2>{model.nextAction.label}</h2></div>
        <p className={styles.subtitle}>Fortsätt där du får mest nytta just nu.</p>
        <Link href={model.nextAction.href}>{model.nextAction.label}</Link>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <div className={styles.panelHeader}><p className={styles.eyebrow}>Ansökningar</p><h2>Dina senaste ansökningar</h2></div>
          {model.recentApplications.length === 0 ? <div className={styles.emptyState}><strong>Inga ansökningar ännu</strong><p>När du hittar ett intressant jobb kan du starta en ansökan därifrån.</p><Link href="/jobs">Hitta jobb</Link></div> : <div className={styles.candidateList}>{model.recentApplications.map((application) => <Link className={styles.candidateRow} href={`/applications/${encodeURIComponent(application.id)}`} key={application.id}><div><strong>{application.jobSnapshot.title}</strong><p>{application.jobSnapshot.company ?? "Företag saknas"}</p></div><div className={styles.candidateMeta}><span>{statusLabels[application.status] ?? application.status}</span><time dateTime={application.updatedAt}>Öppna</time></div></Link>)}</div>}
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}><p className={styles.eyebrow}>CV och intervju</p><h2>Fortsätt ditt arbete</h2></div>
          <div className={styles.candidateList}>
            <Link className={styles.candidateRow} href={`/candidates/${encodeURIComponent(candidateId)}`}><div><strong>{model.baseCvReady ? "Granska ditt grund-CV" : "Skapa ditt grund-CV"}</strong><p>Din profil och ditt CV</p></div><span>Öppna</span></Link>
            {model.interviewApplicationIds.length > 0 ? <Link className={styles.candidateRow} href={`/applications/${encodeURIComponent(model.interviewApplicationIds[0] as string)}/interview`}><div><strong>Fortsätt med intervju</strong><p>Du har en ansökan med intervjustatus</p></div><span>Öppna</span></Link> : <div className={styles.candidateRow}><div><strong>Ingen intervju att fortsätta</strong><p>Intervjustöd visas när en ansökan går vidare.</p></div></div>}
          </div>
        </article>
      </section>
    </main>
  </div>;
}
