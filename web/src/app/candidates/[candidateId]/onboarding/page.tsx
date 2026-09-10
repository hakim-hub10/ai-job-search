import Link from "next/link";

import { loadCandidateOperationalOverview } from "@/lib/candidate-overview";
import { configuredAuthorizationDependencies, requireOwnedCandidate } from "@/lib/authorization";
import OnboardingClient from "./onboarding-client";
import styles from "../../../page.module.css";

export const dynamic = "force-dynamic";

export default async function CandidateOnboardingPage({ params }: { params: Promise<{ candidateId: string }> }) {
  const { candidateId } = await params;
  const authorization = configuredAuthorizationDependencies();
  const owned = authorization.ok ? await requireOwnedCandidate(candidateId, authorization.value) : authorization;
  if (!owned.ok) return <main className={styles.main}><section className={styles.panel}><h1>Kandidaten kunde inte laddas</h1><p>Resursen kunde inte hittas.</p></section></main>;
  const result = await loadCandidateOperationalOverview(candidateId);

  if (!result.configured || result.error || !result.candidate) {
    return (
      <main className={styles.main}>
        <Link href="/candidates">Tillbaka till kandidater</Link>
        <section className={styles.panel} style={{ marginTop: 32 }}>
          <h1>Kandidaten kunde inte laddas</h1>
          <p>Kontrollera kandidatens uppgifter och försök igen.</p>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>AI-jobbcoach</p>
          <h1>Lär känna din profil</h1>
          <p className={styles.subtitle}>En enkel genomgång för {result.candidate.displayName}.</p>
        </div>
        <Link href={`/candidates/${encodeURIComponent(candidateId)}`}>Tillbaka till profilen</Link>
      </header>
      <OnboardingClient candidateId={candidateId} />
    </main>
  );
}
