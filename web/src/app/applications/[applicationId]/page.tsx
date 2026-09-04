import Link from "next/link";

import { loadApplicationDetail } from "@/lib/application-detail";
import { loadApplicationCandidate } from "@/lib/application-candidate";

import {
  associateApplicationCandidateAction,
  updateApplicationStatusAction,
} from "../actions";

export const dynamic = "force-dynamic";

function formatApplicationStatus(status: string) {
  switch (status) {
    case "saved":
      return "Sparad";
    case "preparing":
      return "Förbereds";
    case "applied":
      return "Ansökt";
    case "interview":
      return "Intervju";
    case "offer":
      return "Erbjudande";
    case "rejected":
      return "Avslagen";
    case "withdrawn":
      return "Tillbakadragen";
    case "closed":
      return "Avslutad";
    default:
      return status;
  }
}

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
        <Link href="/applications">← Ansökningar</Link>
        <h1>Ansökningsarkivet är inte konfigurerat</h1>
      </main>
    );
  }

  if (result.error || !result.application) {
    return (
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <Link href="/applications">← Ansökningar</Link>
        <h1>Ansökan kunde inte laddas</h1>
        <p>
          {result.error
            ? `${result.error.code}: ${result.error.message}`
            : "Ansökan hittades inte."}
        </p>
      </main>
    );
  }

  const application = result.application;

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
      <Link href="/applications">← Ansökningar</Link>

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
        <strong>Aktuell status:</strong> {formatApplicationStatus(application.status)}
      </p>

      <section style={{ marginTop: 40 }}>
        <h2>Uppdatera status</h2>

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
                  {formatApplicationStatus(status)}
                </option>
              ))}
            </select>

            <button type="submit">
              Uppdatera status
            </button>
          </div>
        </form>
      </section>

      <section style={{ marginTop: 40 }}>
        <h2>Tilldelad kandidat</h2>

        {!candidateResult.configured ? (
          <p>Jobbcoachens arbetsyta är inte konfigurerad.</p>
        ) : candidateResult.error ? (
          <p>
            Kandidattilldelningen kunde inte laddas:{" "}
            {candidateResult.error.code}
          </p>
        ) : candidateResult.candidate ? (
          <div>
            <strong>{candidateResult.candidate.displayName}</strong>
            <p>{candidateResult.candidate.id}</p>
          </div>
        ) : candidateResult.candidates.length === 0 ? (
          <p>Inga kandidater är tillgängliga.</p>
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
        <h2>Statushistorik</h2>

        <div style={{ display: "grid", gap: 12 }}>
          {application.statusHistory.map((event, index) => (
            <div key={`${event.timestamp}-${index}`}>
              <strong>{formatApplicationStatus(event.status)}</strong>
              <p>{event.timestamp}</p>
              {event.note ? <p>{event.note}</p> : null}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
