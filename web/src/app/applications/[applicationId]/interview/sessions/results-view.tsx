import Link from "next/link";
import type { MockInterviewFeedbackReadModel, MockInterviewResult } from "@/lib/mock-interview-data";
import { applicationInterviewPath } from "@/lib/interview-presentation";
import { mockInterviewError, mockInterviewPath } from "@/lib/mock-interview-presentation";
import styles from "../preparation.module.css";

function FeedbackItems({ items }: { items: MockInterviewFeedbackReadModel["priorities"] }) {
  return items.length > 0 ? <ul className={styles.list}>{items.map((item, index) => <li key={`${item.code}-${index}`}><strong>{item.message}</strong>
    {item.questions.length > 0 && <p>Fråga: {item.questions.join(", ")}</p>}
    {item.requirements.length > 0 && <p>Koppling: {item.requirements.join(", ")}</p>}
    {item.evidence.length > 0 && <p>Underlag: {item.evidence.join(", ")}</p>}
  </li>)}</ul> : <p>Inga särskilda strukturella träningsprioriteringar registrerades.</p>;
}
export function MockInterviewResultsView({ applicationId, result }: { applicationId: string; result: MockInterviewResult<MockInterviewFeedbackReadModel> }) {
  return <main className={styles.page} lang="sv"><div className={styles.content}>
    <Link className={styles.link} href={result.ok ? mockInterviewPath(applicationId, result.value.summary.sessionId) : applicationInterviewPath(applicationId)}>← Tillbaka till övningsintervjun</Link>
    {!result.ok ? <><header className={styles.header}><h1>Träningsfeedbacken kunde inte visas</h1></header><p className={styles.error} role="alert">{mockInterviewError(result.code)}</p></> : <>
      <header className={styles.header}><p className={styles.eyebrow}>Träningsfeedback</p><h1>Intervjun är klar</h1><p className={styles.job}>{result.value.application.jobTitle}</p>{result.value.application.company && <p>{result.value.application.company}</p>}
        <p>Feedbacken beskriver registrerad övningsstruktur, inte kvaliteten på dina svar.</p></header>
      <section className={styles.panel} aria-labelledby="overview-heading"><h2 id="overview-heading">Översikt</h2><p>{result.value.summary.answeredQuestions} frågor besvarades och {result.value.summary.skippedQuestions} hoppades över av totalt {result.value.summary.totalQuestions}.</p>
        <p>Feedbacken bygger på struktur och referenser som registrerades under övningen. Själva svarstexten sparas inte, därför bedömer systemet inte hur övertygande eller välformulerat svaret var.</p></section>
      <section className={styles.panel} aria-labelledby="questions-heading"><h2 id="questions-heading">Frågor i övningen</h2><div className={styles.saved}>{result.value.questions.map((question, index) => <article key={`${question.prompt}-${index}`}><h3>{index + 1}. {question.prompt}</h3><p>{question.status === "submitted" ? `Besvarad${question.answerFormat ? ` · ${question.answerFormat === "star" ? "STAR-format" : "fritext"}` : ""}` : "Överhoppad"}</p>
        {question.structuralChecks && <p>Struktur: {question.structuralChecks.star === "complete" ? "komplett STAR" : question.structuralChecks.star === "partial" ? "partiell STAR" : question.structuralChecks.star === "notStructured" ? "ingen explicit STAR" : "inte tillämplig"}{question.structuralChecks.hasQuestionLinkedEvidence ? " · frågeanknuten evidens citerad" : ""}</p>}
        {question.priorities.length > 0 && <><h4>Träningssignal</h4><FeedbackItems items={question.priorities} /></>}</article>)}</div></section>
      <section className={styles.panel} aria-labelledby="coverage-heading"><h2 id="coverage-heading">Krav och träning</h2>{result.value.requirementCoverage.length > 0 ? <ul className={styles.list}>{result.value.requirementCoverage.map((item) => <li key={item.requirement}><strong>{item.requirement}</strong> · {item.status === "practiced" ? "övad" : item.status === "skipped" ? "överhoppad" : "inte med i övningen"}</li>)}</ul> : <p>Inga kravkopplingar registrerades i förberedelsen.</p>}</section>
      <section className={styles.panel} aria-labelledby="priorities-heading"><h2 id="priorities-heading">Vad du kan träna mer på</h2><FeedbackItems items={result.value.priorities} /></section>
    </>}
  </div></main>;
}
