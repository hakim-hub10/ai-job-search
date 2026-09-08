"use client";
import { useFormStatus } from "react-dom";
import styles from "../preparation.module.css";
export function PreparationSubmit() {
  const { pending } = useFormStatus();
  return <button className={styles.submit} type="submit" disabled={pending} aria-disabled={pending}>
    {pending ? "Sparar förberedelsen…" : "Skapa och spara förberedelse"}
  </button>;
}
