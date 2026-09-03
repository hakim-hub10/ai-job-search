import Link from "next/link";

import { createCandidateAction } from "../actions";

export const dynamic = "force-dynamic";

export default function NewCandidatePage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
      <p>COACH WORKSPACE</p>

      <h1>New candidate</h1>

      <p>
        Create a candidate record using the existing coach workspace workflow.
      </p>

      <form action={createCandidateAction}>
        <div style={{ display: "grid", gap: 8, marginTop: 32 }}>
          <label htmlFor="displayName">
            <strong>Display name</strong>
          </label>

          <input
            id="displayName"
            name="displayName"
            type="text"
            required
            autoComplete="name"
            placeholder="Candidate name"
            style={{
              padding: "12px",
              border: "1px solid #ccd2dc",
              borderRadius: 8,
              font: "inherit",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
          <button
            type="submit"
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: 0,
              cursor: "pointer",
            }}
          >
            Create candidate
          </button>

          <Link href="/candidates">Cancel</Link>
        </div>
      </form>
    </main>
  );
}
