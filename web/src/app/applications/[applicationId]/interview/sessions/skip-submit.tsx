"use client";
import { useFormStatus } from "react-dom";
import styles from "../preparation.module.css";
export function MockInterviewSkipSubmit() {
  const { pending } = useFormStatus();
  return <button className={styles.secondary} type="submit" disabled={pending}>{pending ? "Hoppar över…" : "Hoppa över frågan"}</button>;
}
