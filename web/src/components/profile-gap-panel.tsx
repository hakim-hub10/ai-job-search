import type { ProfileGapContext } from "@/lib/profile-gap-context";
import styles from "../app/page.module.css";

function GapList({ title, hint, items }: { title: string; hint: string; items: ProfileGapContext["verifiedGaps"] }) {
  if (items.length === 0) return null;
  return (
    <section className={styles.analysisSection}>
      <h4>{title}</h4>
      <p className={styles.analysisSectionHint}>{hint}</p>
      <ul>
        {items.map((item, index) => (
          <li key={`${item.dimension}:${item.title}:${index}`}>
            <strong>{item.title}</strong>
            <span>{item.description}</span>
            <span>Ditt nuvarande värde: {item.currentValue}</span>
            <a href={`#${item.fieldId}`}>Redigera i profilen</a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ProfileGapPanel({ context }: { context: ProfileGapContext }) {
  return (
    <section className={styles.panel} aria-label="Varför du kom hit">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>Matchningsanalys</p>
          <h3>Lös kompetensgap för {context.jobTitle}</h3>
          <p className={styles.formIntro}>
            Lägg endast till erfarenheter och kompetenser som du faktiskt har. Ingen kompetens, roll, certifiering eller erfarenhet läggs till automatiskt - du bekräftar eller redigerar själv nedan.
          </p>
        </div>
      </div>

      {context.targetRoleExplanation ? (
        <section className={styles.analysisSection}>
          <h4>Målroll</h4>
          <p>Jobbets roll: <strong>{context.targetRoleExplanation.jobRole}</strong></p>
          <p>
            Dina nuvarande målroller:{" "}
            <strong>{context.targetRoleExplanation.candidateTargetRoles.join(", ") || "Inga angivna"}</strong>
          </p>
          <p className={styles.analysisSectionHint}>{context.targetRoleExplanation.explanation}</p>
          <a href={`#${context.targetRoleExplanation.fieldId}`}>Redigera målroller</a>
        </section>
      ) : null}

      <div className={styles.analysisGrid}>
        <GapList
          title="Saknade verifierade krav"
          hint="Annonsen kräver detta uttryckligen, och det saknas i din verifierade profil."
          items={context.verifiedGaps}
        />
        <GapList
          title="Osäkert kandidatunderlag"
          hint="Annonsen nämner kravet, men din profil ger inte tillräckligt underlag för en säker bedömning."
          items={context.candidateUncertain}
        />
        <GapList
          title="Motstridig information"
          hint="Din profil motsäger direkt vad annonsen anger."
          items={context.conflicting}
        />
      </div>

      {context.verifiedGaps.length === 0 && context.candidateUncertain.length === 0 && context.conflicting.length === 0 && context.targetRoleExplanation === null ? (
        <p>Inga specifika kandidatsidiga gap hittades för den här annonsen.</p>
      ) : null}
    </section>
  );
}
