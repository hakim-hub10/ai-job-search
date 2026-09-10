import Link from "next/link";
import { redirect } from "next/navigation";

import { getAuthenticatedUser } from "@/lib/auth-session";
import { getOrCreateOwnedCandidateForUser } from "@/lib/job-seeker-ownership";
import { loadCandidateProfile } from "@/lib/candidate-profiles";

import styles from "./page.module.css";

export const dynamic = "force-dynamic";

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
  const profile = await loadCandidateProfile(owned.value.id);
  if (!profile.profile) redirect(`/candidates/${encodeURIComponent(owned.value.id)}/onboarding`);

  return <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.logoMark}>AC</div>
          <div>
            <strong>AI Career Agent</strong>
            <span>Din jobbsökning</span>
          </div>
        </div>

        <nav className={styles.nav}>
          <Link className={styles.active} href="/">Översikt</Link>
          <Link href={`/candidates/${encodeURIComponent(owned.value.id)}`}>Min profil</Link>
          <Link href="/jobs">Hitta jobb</Link>
          <Link href="/applications">Mina ansökningar</Link>
        </nav>

        <div className={styles.sidebarFooter}>
          <span>Personlig arbetsyta</span>
          <small>Din profil och dina ansökningar</small>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.header}>
          <div><p className={styles.eyebrow}>Översikt</p><h1>Hej, {user.name || "där"}</h1><p className={styles.subtitle}>Fortsätt med din profil, hitta jobb och följ dina ansökningar.</p></div>

          <Link href={`/candidates/${encodeURIComponent(owned.value.id)}`}>Öppna min profil</Link>
        </header>

        <section className={styles.panel}>
          <div className={styles.panelHeader}><p className={styles.eyebrow}>Nästa steg</p><h2>Välj vad du vill göra nu</h2></div>
          <div className={styles.capabilities}><Link href={`/candidates/${encodeURIComponent(owned.value.id)}`}>Kontrollera min profil</Link><Link href="/jobs">Hitta jobb</Link><Link href="/applications">Se mina ansökningar</Link></div>
        </section>
      </main>
    </div>;
}
