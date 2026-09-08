import type { PreparationDetail } from "@/lib/interview-preparation-data";
import { requirementStatus } from "@/lib/interview-preparation-presentation";
import styles from "./preparation.module.css";
export function PreparationQuestion({ q, language, index: i }: {
  q: PreparationDetail["questions"][number]; language: "sv" | "en"; index: number;
}) {
  return <article className={styles.panel} aria-labelledby={`question-${i}`}>
        <p className={styles.eyebrow}>Fråga {i + 1}</p><h3 id={`question-${i}`} lang={language} className={styles.question}>{q.prompt}</h3>
        <div className={styles.block}><h4>Vad arbetsgivaren sannolikt vill bedöma</h4><p lang={language}>{q.rationale}</p></div>
        {q.requirements.length > 0 && <div className={styles.block}><h4>Relevant krav eller koppling</h4><ul className={styles.list}>
          {q.requirements.map((r) => <li key={r.key}><strong>{r.label}</strong> — {r.source === "job" ? requirementStatus(r.status) : "Koppling i din profil, inte ett angivet jobbkrav"}</li>)}
        </ul></div>}
        <div className={styles.block}><h4>Erfarenhet du kan använda i svaret</h4>
          {q.evidence.length > 0 ? <ul className={styles.evidence}>{q.evidence.map((e) => <li key={e.id}>
            {(e.role || e.employer) && <p className={styles.evidenceContext}>{[e.role, e.employer].filter(Boolean).join(" · ")}</p>}<p>{e.content}</p>
          </li>)}</ul> : <><p>Din verifierade profil innehåller inget tydligt exempel för den här frågan.</p>
            <p>Använd ett verkligt exempel om du har ett. Svara ärligt och koppla till överförbar erfarenhet endast där det faktiskt stämmer.</p></>}
        </div>
        {q.starPrompts.map((s, index) => <div className={styles.block} key={index}><h4>Strukturera exemplet med STAR</h4>
          <dl className={styles.star}>{[["Situation", s.situationPrompt], ["Uppgift", s.taskPrompt], ["Handling", s.actionPrompt], ["Resultat", s.resultPrompt]].map(([label, text]) =>
            <div key={label}><dt>{label}</dt><dd lang={language}>{text}</dd></div>)}</dl>
          {s.warnings.map((warning, j) => <p className={styles.note} key={j} lang={language}>{warning}</p>)}
        </div>)}
      </article>;
}
