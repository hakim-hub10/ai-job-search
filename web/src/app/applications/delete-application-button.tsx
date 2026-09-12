"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";

import styles from "../page.module.css";

function ConfirmDeleteSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={styles.dangerButton}>
      {pending ? "Raderar…" : "Radera ansökan"}
    </button>
  );
}

export function DeleteApplicationButton({
  applicationId,
  deleteAction,
}: {
  applicationId: string;
  deleteAction: (formData: FormData) => void | Promise<void>;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  return (
    <details className={styles.deleteDetails} ref={detailsRef}>
      <summary>Radera</summary>

      <div className={styles.deleteConfirm}>
        <strong>Radera ansökan?</strong>
        <p>
          Den sparade ansökan och information som endast tillhör den här
          ansökan tas bort. Därefter kan du skapa en ny ansökan för jobbet.
        </p>

        <div className={styles.deleteConfirmActions}>
          <button
            type="button"
            onClick={() => {
              if (detailsRef.current) detailsRef.current.open = false;
            }}
          >
            Avbryt
          </button>

          <form action={deleteAction}>
            <input type="hidden" name="applicationId" value={applicationId} />
            <ConfirmDeleteSubmit />
          </form>
        </div>
      </div>
    </details>
  );
}
