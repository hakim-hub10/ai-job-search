"use client";
import { useActionState } from "react";
import Link from "next/link";
import { mockInterviewError, mockInterviewPath } from "@/lib/mock-interview-presentation";
import styles from "../preparation.module.css";

export type AnswerActionState = { ok: true; value: { proposal: { feedback: { id: string; suggestion: string }[]; followUpQuestions: { id: string; prompt: string }[] }; requiresHumanReview: true } } | { ok: false; code: string; message: string };
export function MockInterviewAnswerForm({ applicationId, sessionId, questionId, action: serverAction }: { applicationId: string; sessionId: string; questionId: string; action: (previousState: unknown, data: FormData) => Promise<AnswerActionState> }) {
  const [state, action, pending] = useActionState<AnswerActionState | null, FormData>(serverAction, null);
  return <>
    <form action={action} className={styles.form}>
      <input type="hidden" name="applicationId" value={applicationId} /><input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="expectedQuestionId" value={questionId} /><input type="hidden" name="format" value="freeText" />
      <label htmlFor="interview-answer">Skriv ditt svar</label><textarea id="interview-answer" name="text" rows={8} required aria-describedby="answer-guidance" />
      <button className={styles.submit} type="submit" name="mode" value="deterministic" disabled={pending}>{pending ? "Skickar svar…" : "Skicka svar"}</button>
      <fieldset className={styles.aiConsent}>
        <legend>Valfritt AI-stöd</legend>
        <p id="ai-consent-help">AI-stöd är frivilligt. Det här svaret och relevant intervjukontext skickas till en extern AI-tjänst för ett rådgivande träningsförslag. Intervjun fungerar utan AI.</p>
        <label><input type="checkbox" name="aiConsent" value="on" /> Jag vill skicka svaret för AI-coaching i den här åtgärden.</label>
        <button className={styles.secondary} type="submit" name="mode" value="ai" disabled={pending}>{pending ? "Bearbetar…" : "Få AI-coaching"}</button>
      </fieldset>
    </form>
    {state && (!state.ok ? <><p className={styles.error} role="alert" aria-live="assertive">{mockInterviewError(state.code)}</p><Link className={styles.link} href={mockInterviewPath(applicationId, sessionId)}>Fortsätt intervjun →</Link></> : <section className={styles.panel} aria-labelledby="ai-heading" aria-live="polite">
      <p className={styles.eyebrow}>Rådgivande stöd</p><h3 id="ai-heading">AI-coaching</h3>
      <p>Det här är ett träningsförslag. Granska råden själv innan du använder dem.</p>
      <p>AI-förslaget kräver mänsklig granskning och ändrar inte ditt svar eller intervjun.</p>
      {state.value.proposal.feedback.length > 0 && <><h4>Förslag</h4><ul className={styles.list}>{state.value.proposal.feedback.map((item) => <li key={item.id}>{item.suggestion}</li>)}</ul></>}
      {state.value.proposal.followUpQuestions.length > 0 && <><h4>Följdfrågor att träna på</h4><ul className={styles.list}>{state.value.proposal.followUpQuestions.map((item) => <li key={item.id}>{item.prompt}</li>)}</ul></>}
      <Link className={styles.link} href={mockInterviewPath(applicationId, sessionId)}>Fortsätt intervjun →</Link>
    </section>)}
  </>;
}
