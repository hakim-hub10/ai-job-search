import Link from "next/link";

import { configuredAuthorizationDependencies, getAuthorizedCandidateContext } from "@/lib/authorization";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

export default async function CandidatesPage() {
  const authorization = configuredAuthorizationDependencies();
  if (!authorization.ok) return <main className={styles.main}><section className={styles.panel}><h1>Din profil kunde inte laddas</h1><p>Försök igen senare.</p></section></main>;
  const context = await getAuthorizedCandidateContext(authorization.value);
  if (!context.ok) return <main className={styles.main}><section className={styles.panel}><h1>Din profil kunde inte laddas</h1><p>Logga in igen eller försök senare.</p></section></main>;
  return <main className={styles.main}>
    <header className={styles.header}><div><p className={styles.eyebrow}>Min profil</p><h1>{context.value.candidate.displayName}</h1><p className={styles.subtitle}>Din personliga kandidatprofil.</p></div><Link href="/">Tillbaka till översikten</Link></header>
    <section className={styles.panel}><p>Här hittar du din profil, ditt grund-CV och onboarding från CV.</p><Link href={`/candidates/${encodeURIComponent(context.value.candidate.id)}`}>Öppna min profil</Link></section>
  </main>;
}
