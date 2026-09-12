import type { CareerActionInsight } from "@/lib/analytics";
import styles from "../../page.module.css";

const VISIBLE_ACTIONS = 3;

function actionItem(action: CareerActionInsight) {
  return <li className={styles.candidateRow} key={action.id}><div><strong>{action.title}</strong><p>{action.description}</p><p>Underlag: {action.evidence}</p></div></li>;
}

export function CareerActionList({ actions }: { actions: CareerActionInsight[] }) {
  if (actions.length === 0) return <p>Inga särskilda förslag på nästa steg finns utifrån de sparade analyserna.</p>;
  const visible = actions.slice(0, VISIBLE_ACTIONS);
  const rest = actions.slice(VISIBLE_ACTIONS);
  return (
    <>
      <ul className={styles.candidateList}>{visible.map(actionItem)}</ul>
      {rest.length > 0 && (
        <details className={styles.analysisDetails}>
          <summary>Visa alla rekommendationer ({actions.length})</summary>
          <ul className={styles.candidateList}>{rest.map(actionItem)}</ul>
        </details>
      )}
    </>
  );
}
