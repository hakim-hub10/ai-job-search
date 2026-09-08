import Link from "next/link";
import type { MockInterviewReadModel, MockInterviewResult } from "@/lib/mock-interview-data";
import { applicationInterviewPath, formatInterviewLanguage, formatInterviewStatus, formatInterviewType } from "@/lib/interview-presentation";
import { mockInterviewError, mockInterviewResultsPath } from "@/lib/mock-interview-presentation";
import { preparationPath } from "@/lib/interview-preparation-presentation";
import { PreparationQuestion } from "../preparation-question";
import { MockInterviewAnswerForm } from "./answer-form";
import type { AnswerActionState } from "./answer-form";
import styles from "../preparation.module.css";
type Action = (data: FormData) => Promise<void>;
type AnswerAction = (previousState: unknown, data: FormData) => Promise<AnswerActionState>;
export function MockInterviewView({ applicationId, result, showAnswerForm, answerAction, skipAction, answerError, skipError }: { applicationId: string; result: MockInterviewResult<MockInterviewReadModel>; showAnswerForm?: boolean; answerAction?: AnswerAction; skipAction?: Action; answerError?: string; skipError?: string }) {
  return <main lang="sv" className={styles.page}><div className={styles.content}>
    <Link className={styles.link} href={result.ok || result.code !== "APPLICATION_NOT_FOUND" ? applicationInterviewPath(applicationId) : "/applications"}>← Tillbaka till {result.ok || result.code !== "APPLICATION_NOT_FOUND" ? "intervjuöversikten" : "ansökningar"}</Link>
    {!result.ok ? <><header className={styles.header}><h1>Mockintervjun kunde inte visas</h1></header>
      <p role="alert">{mockInterviewError(result.code)}</p>
      <Link className={styles.link} href={preparationPath(applicationId)}>Till sparade förberedelser</Link>
    </> : <>
      <header className={styles.header}><p className={styles.eyebrow}>Övningsintervju</p><h1>Mockintervju</h1>
        <p className={styles.job}>{result.value.application.jobTitle}</p>{result.value.application.company && <p>{result.value.application.company}</p>}
        <p>{formatInterviewType(result.value.session.interviewType)} · {formatInterviewLanguage(result.value.session.language)}</p>
        <p>Status: {formatInterviewStatus(result.value.session.status)}</p>
        <p>Det här är övning inför en intervju. Frågan och underlaget kommer från din valda, sparade förberedelse.</p>
        <Link className={styles.link} href={preparationPath(applicationId, result.value.preparationId)}>Visa den använda förberedelsen →</Link>
      </header>
      {result.value.session.status === "completed" ? <section className={styles.panel}><h2>Övningsintervjun är klar.</h2><p>Alla {result.value.session.totalQuestions} frågor har hanterats.</p><Link className={styles.link} href={mockInterviewResultsPath(applicationId, result.value.session.sessionId)}>Visa träningsfeedback →</Link></section> :
        <section aria-labelledby="current-heading"><h2 id="current-heading" className={styles.sectionHeading}>Fråga {result.value.session.currentQuestionIndex + 1} av {result.value.session.totalQuestions}</h2>
          {result.value.currentQuestion && <PreparationQuestion q={result.value.currentQuestion} index={result.value.session.currentQuestionIndex} language={result.value.session.language} />}
          {answerError && <p className={styles.error} role="alert">{mockInterviewError(answerError)}</p>}
          {skipError && <p className={styles.error} role="alert">{mockInterviewError(skipError)}</p>}
          {showAnswerForm && answerAction && result.value.currentQuestion && <section className={styles.panel} aria-labelledby="answer-heading">
            <h2 id="answer-heading">Ditt svar</h2><p id="answer-guidance">Svara konkret, beskriv din egen roll och använd ett verkligt exempel när det passar.</p>
            <MockInterviewAnswerForm applicationId={applicationId} sessionId={result.value.session.sessionId} questionId={result.value.currentQuestion.id} action={answerAction} />
            {skipAction && <form action={skipAction} className={styles.form}>
              <input type="hidden" name="applicationId" value={applicationId} /><input type="hidden" name="sessionId" value={result.value.session.sessionId} />
              <input type="hidden" name="expectedQuestionId" value={result.value.currentQuestion.id} /><button className={styles.secondary} type="submit">Hoppa över frågan</button>
            </form>}
          </section>}
        </section>}
    </>}
  </div></main>;
}
