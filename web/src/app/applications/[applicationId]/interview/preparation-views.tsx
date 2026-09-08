import Link from "next/link";
import { PreparationQuestion } from "./preparation-question";
import { MockStartSubmit } from "./sessions/start-submit";
import { mockInterviewError } from "@/lib/mock-interview-presentation";
import type { ReactNode } from "react";
import type { PreparationDetail, PreparationList, PreparationResult } from "@/lib/interview-preparation-data";
import { applicationInterviewPath, formatInterviewLanguage, formatInterviewType } from "@/lib/interview-presentation";
import { answerGuidance, preparationError, preparationPath, preparationWarning } from "@/lib/interview-preparation-presentation";
import { PreparationSubmit } from "./prepare/submit";
import styles from "./preparation.module.css";

function Frame({ applicationId, children }: { applicationId: string; children: ReactNode }) {
  return <main className={styles.page} lang="sv"><div className={styles.content}>
    <Link className={styles.link} href={applicationInterviewPath(applicationId)}>← Tillbaka till intervjuöversikten</Link>
    {children}
  </div></main>;
}
function Failure({ applicationId, code }: { applicationId: string; code: string }) {
  return <Frame applicationId={applicationId}><header className={styles.header}><h1>Förberedelsen kunde inte visas</h1></header>
    <p role="alert">{preparationError(code)}</p>
    <Link className={styles.link} href={code === "APPLICATION_NOT_FOUND" ? "/applications" : preparationPath(applicationId)}>
      {code === "APPLICATION_NOT_FOUND" ? "Till ansökningar" : "Till intervjuförberedelser"}
    </Link></Frame>;
}
export function PreparationCreateView({ applicationId, result, action, error }: {
  applicationId: string; result: PreparationResult<PreparationList>; action: (formData: FormData) => Promise<void>; error?: string;
}) {
  if (!result.ok) return <Failure applicationId={applicationId} code={result.code} />;
  const model = result.value;
  return <Frame applicationId={applicationId}>
    <header className={styles.header}><p className={styles.eyebrow}>Intervjuförberedelse</p><h1>Förbered intervju</h1>
      <p className={styles.job}>{model.jobTitle}</p>{model.company && <p>{model.company}</p>}
      <p>Förbered frågor med stöd av jobbunderlaget och din verifierade profil.</p></header>
    <section className={styles.panel} aria-labelledby="create-heading"><h2 id="create-heading">Skapa en förberedelse</h2>
      <p>Varje förberedelse sparas separat. Tidigare förberedelser finns kvar med sitt ursprungliga underlag.</p>
      {error && <p className={styles.error} role="alert">{preparationError(error)}</p>}
      <form action={action} className={styles.form}>
        <input type="hidden" name="applicationId" value={applicationId} />
        <div className={styles.fields}>
          <div><label htmlFor="interview-type">Intervjutyp</label><select id="interview-type" name="interviewType" defaultValue="hiringManager" required>
            {["recruiterScreening", "hiringManager", "behavioral", "roleSpecific", "situational"].map((type) => <option key={type} value={type}>{formatInterviewType(type)}</option>)}
          </select></div>
          <div><label htmlFor="interview-language">Frågornas språk</label><select id="interview-language" name="language" defaultValue="sv" required>
            <option value="sv">Svenska</option><option value="en">Engelska</option>
          </select></div>
        </div>
        <PreparationSubmit />
      </form>
    </section>
    <section className={styles.panel} aria-labelledby="saved-heading"><h2 id="saved-heading">Sparade förberedelser ({model.preparations.length})</h2>
      {model.preparations.length === 0 ? <p>Ingen sparad förberedelse ännu. Välj intervjutyp och språk ovan för att börja.</p> :
        <ul className={styles.saved}>{model.preparations.map((p, i) => <li key={p.preparationId}>
          <Link className={styles.link} href={preparationPath(applicationId, p.preparationId)}>Förberedelse {i + 1}: {formatInterviewType(p.interviewType)}</Link>
          <p>{formatInterviewLanguage(p.language)} · {p.questionCount} frågor</p>
        </li>)}</ul>}
    </section>
  </Frame>;
}
export function PreparationDetailView({ applicationId, result, startAction, startError }: { applicationId: string; result: PreparationResult<PreparationDetail>; startAction?: (data: FormData) => Promise<void>; startError?: string }) {
  if (!result.ok) return <Failure applicationId={applicationId} code={result.code} />;
  const p = result.value;
  return <Frame applicationId={applicationId}>
    <header className={styles.header}><p className={styles.eyebrow}>Sparad intervjuförberedelse</p><h1>{formatInterviewType(p.interviewType)}</h1>
      <p className={styles.job}>{p.jobTitle}</p>{p.company && <p>{p.company}</p>}
      <p>{formatInterviewLanguage(p.language)} · {p.questionCount} frågor</p>
      <p>Frågorna och exemplen kommer från underlaget som sparades när du skapade förberedelsen.</p>
      <Link className={styles.link} href={preparationPath(applicationId)}>Alla förberedelser och skapa en ny →</Link>
    </header>
    {startAction && <section className={styles.panel} aria-labelledby="mock-start-heading">
      <h2 id="mock-start-heading">Öva med den här förberedelsen</h2>
      <p>Starta en mockintervju med de sparade frågorna och exemplen. Varje start skapar en separat övningsintervju.</p>
      {startError && <p role="alert" className={styles.error}>{mockInterviewError(startError)}</p>}
      <form action={startAction} className={styles.form}>
        <input type="hidden" name="applicationId" value={applicationId} />
        <input type="hidden" name="preparationId" value={p.preparationId} />
        <MockStartSubmit />
      </form>
    </section>}
    <section className={styles.panel} aria-labelledby="guidance-heading"><h2 id="guidance-heading">Bygg ett tydligt svar</h2>
      <p>Det här är intervjucoachning, inte arbetsgivarens bedömningsmall.</p>
      <ul className={styles.list}>{answerGuidance.map((text) => <li key={text}>{text}</li>)}</ul>
      <div className={styles.block}><h3>STAR som stöd för verkliga exempel</h3>
        <p>Använd strukturen när ett verkligt exempel passar frågan. Det är ett stöd för ditt eget svar.</p>
        <dl className={styles.star}>
          <div><dt>Situation</dt><dd>Beskriv sammanhanget kort, med uppgifter som stämmer.</dd></div>
          <div><dt>Uppgift</dt><dd>Förklara vad du ansvarade för.</dd></div>
          <div><dt>Handling</dt><dd>Berätta vad du själv gjorde och varför.</dd></div>
          <div><dt>Resultat</dt><dd>Beskriv bara resultat som du kan styrka. Säg till om ett mätbart resultat saknas.</dd></div>
        </dl>
      </div>
    </section>
    {p.warnings.length > 0 && <section className={styles.panel} aria-labelledby="warnings-heading"><h2 id="warnings-heading">Att tänka på i underlaget</h2>
      <ul className={styles.list}>{p.warnings.map((w, i) => <li key={i}>{preparationWarning(w.code)}{w.requirementLabel && <> Krav: {w.requirementLabel}.</>}</li>)}</ul>
    </section>}
    <section aria-labelledby="questions-heading"><h2 id="questions-heading" className={styles.sectionHeading}>Dina frågor</h2>
      {p.questions.map((q, i) => <PreparationQuestion key={q.id} q={q} language={p.language} index={i} />)}
    </section>
  </Frame>;
}
