import type { CareerActionInsight } from "@/lib/analytics";
import styles from "../../page.module.css";
export function CareerActionList({ actions }: { actions: CareerActionInsight[] }) {
  if (actions.length === 0) return <p>Inga särskilda förslag på nästa steg finns utifrån de sparade analyserna.</p>;
  return <ul className={styles.candidateList}>{actions.map((action) => <li className={styles.candidateRow} key={action.id}><div><strong>{action.title}</strong><p>{action.description}</p><p>Underlag: {action.evidence}</p></div></li>)}</ul>;
}
