"use client";
import { useFormStatus } from "react-dom";
import styles from "../preparation.module.css";
export function MockStartSubmit() {
  const { pending } = useFormStatus();
  return <button className={styles.submit} type="submit" disabled={pending}>{pending ? "Startar övningsintervjun…" : "Starta mockintervju"}</button>;
}
