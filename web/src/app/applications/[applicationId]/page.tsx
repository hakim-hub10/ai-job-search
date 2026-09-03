import Link from "next/link";

import { loadApplicationDetail } from "@/lib/application-detail";
import { loadApplicationCandidate } from "@/lib/application-candidate";

import {
  associateApplicationCandidateAction,
  updateApplicationStatusAction,
} from "../actions";

export const dynamic = "force-dynamic";

const statuses = [
  "saved",
  "preparing",
  "applied",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
  "closed",
] as const;

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const { applicationId } = await params;
  const decodedId = decodeURIComponent(applicationId);

  const result = await loadApplicationDetail(decodedId);
  const candidateResult = await loadApplicationCandidate(decodedId);

  if (!result.configured) {
    return (
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <Link href="/applications">← Applications</Link>
        <h1>Application repository not configured</h1>
      </main>
    );
  }

  if (result.error || !result.application) {
    return (
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <Link href="/applications">← Applications</Link>
        <h1>Application could not be loaded</h1>
        <p>
          {result.error
            ? `${result.error.code}: ${result.error.message}`
            : "Application not found."}
        </p>
      </main>
    );
  }

  const application = result.application;

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
      <Link href="/applications">← Applications</Link>

      <p style={{ marginTop: 32 }}>APPLICATION</p>

      <h1>{application.jobSnapshot.title}</h1>

      <p>
        {application.jobSnapshot.company ?? "Unknown company"}
        {" · "}
        {application.jobSnapshot.location ?? "Unknown location"}
      </p>

      <p>
        <strong>ID:</strong> {application.id}
      </p>

      <p>
        <strong>Current status:</strong> {application.status}
      </p>

      <section style={{ marginTop: 40 }}>
        <h2>Update status</h2>

        <form action={updateApplicationStatusAction}>
          <input
            type="hidden"
            name="applicationId"
            value={application.id}
          />

          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <select
              name="status"
              defaultValue={application.status}
              style={{
                padding: "10px 12px",
                border: "1px solid #ccd2dc",
                borderRadius: 8,
                font: "inherit",
              }}
            >
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>

            <button type="submit">
              Update status
            </button>
          </div>
        </form>
      </section>

      <section style={{ marginTop: 40 }}>
        <h2>Assigned candidate</h2>

        {!candidateResult.configured ? (
          <p>Coach workspace is not configured.</p>
        ) : candidateResult.error ? (
          <p>
            Candidate assignment could not be loaded:{" "}
            {candidateResult.error.code}
          </p>
        ) : candidateResult.candidate ? (
          <div>
            <strong>{candidateResult.candidate.displayName}</strong>
            <p>{candidateResult.candidate.id}</p>
          </div>
        ) : candidateResult.candidates.length === 0 ? (
          <p>No candidates are available.</p>
        ) : (
          <form action={associateApplicationCandidateAction}>
            <input
              type="hidden"
              name="applicationId"
              value={application.id}
            />

            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <select
                name="candidateId"
                required
                defaultValue=""
                style={{
                  padding: "10px 12px",
                  border: "1px solid #ccd2dc",
                  borderRadius: 8,
                  font: "inherit",
                }}
              >
                <option value="" disabled>
                  Select candidate
                </option>

                {candidateResult.candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.displayName}
                  </option>
                ))}
              </select>

              <button type="submit">
                Assign candidate
              </button>
            </div>
          </form>
        )}
      </section>

      <section style={{ marginTop: 40 }}>
        <h2>Status history</h2>

        <div style={{ display: "grid", gap: 12 }}>
          {application.statusHistory.map((event, index) => (
            <div key={`${event.timestamp}-${index}`}>
              <strong>{event.status}</strong>
              <p>{event.timestamp}</p>
              {event.note ? <p>{event.note}</p> : null}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
