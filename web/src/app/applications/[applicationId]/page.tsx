import Link from "next/link";
import { applicationInterviewPath } from "@/lib/interview-presentation";

import { loadApplicationDetail } from "@/lib/application-detail";
import { loadApplicationCandidate } from "@/lib/application-candidate";
import { loadApplicationDocumentState } from "@/lib/application-documents";
import { loadCandidateBaseCvState } from "@/lib/candidate-base-cv-state";

import {
  associateApplicationCandidateAction,
  createCoverLetterAction,
  createTailoredCvAction,
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

function formatDocumentType(documentType: string) {
  return documentType === "cv" ? "CV" : "Personligt brev";
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
  const documentResult = await loadApplicationDocumentState(decodedId);

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
        <p>Ansökan hittades inte i det lokala ansökningsarkivet.</p>
      </main>
    );
  }

  const application = result.application;
  const baseCvResult = candidateResult.candidate
    ? await loadCandidateBaseCvState(candidateResult.candidate.id)
    : null;

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
      <Link href="/applications">← Ansökningar</Link>

      <nav aria-label="Ansökans sidor" style={{ marginTop: 24 }}>
        <Link href={applicationInterviewPath(application.id)}>Intervju</Link>
      </nav>

      <p style={{ marginTop: 32 }}>ANSÖKAN</p>

      <h1>{application.jobSnapshot.title}</h1>

      <p>
        {application.jobSnapshot.company ?? "Företag saknas"}
        {" · "}
        {application.jobSnapshot.location ?? "Plats saknas"}
      </p>

      <p>
        <strong>ID:</strong> {application.id}
      </p>

      <p>
        <strong>Aktuell status:</strong> {formatApplicationStatus(application.status)}
      </p>

      {application.jobSnapshot.url ? (
        <p>
          <strong>Originalannons:</strong>{" "}
          <a
            href={application.jobSnapshot.url}
            rel="noreferrer"
            target="_blank"
          >
            Öppna jobbannons
          </a>
        </p>
      ) : null}

      <section style={{ marginTop: 40 }}>
        <h2>Uppdatera status</h2>

        <form action={updateApplicationStatusAction}>
          <input
            type="hidden"
            name="applicationId"
            value={application.id}
          />

          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <label htmlFor="applicationStatus">Status</label>
            <select
              id="applicationStatus"
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
        <h2>Dokument</h2>

        {!documentResult.ok ? (
          <p>Dokumentstatus kunde inte laddas just nu.</p>
        ) : (
          <>
            <p>
              Kandidatprofil: {documentResult.profile
                ? "Tillgänglig"
                : documentResult.associationMissing
                  ? "Kandidatkoppling saknas"
                  : "Profilinformation saknas"}
            </p>
            <p>
              Dokumentunderlag: {documentResult.profile && !documentResult.associationMissing
                ? "Redo"
                : "Saknas"}
            </p>
            {(["cv", "coverLetter"] as const).map((documentType) => {
              const latest = [...documentResult.documents]
                .filter((document) => document.documentType === documentType)
                .sort((a, b) => b.version - a.version)[0];

              if (documentType === "cv") {
                return (
                  <div key={documentType}>
                    <p>
                      CV: {latest
                        ? `Version ${latest.version} · Skapad: ${latest.createdAt}`
                        : "Inte skapat"}
                    </p>
                    {latest ? (
                      <>
                        <p>
                          <Link href={`/applications/${encodeURIComponent(application.id)}/documents/cv`}>
                            Visa CV
                          </Link>
                        </p>
                        <form action={createTailoredCvAction}>
                          <input type="hidden" name="applicationId" value={application.id} />
                          <button type="submit">Skapa ny version</button>
                        </form>
                      </>
                    ) : baseCvResult?.ok && baseCvResult.baseCv ? (
                      <form action={createTailoredCvAction}>
                        <input type="hidden" name="applicationId" value={application.id} />
                        <button type="submit">Skapa anpassat CV</button>
                      </form>
                    ) : (
                      <p>
                        Grund-CV saknas. Skapa ett grund-CV innan du skapar ett anpassat CV.
                      </p>
                    )}
                  </div>
                );
              }

              if (documentType === "coverLetter") {
                return (
                  <div key={documentType}>
                    <p>
                      Personligt brev: {latest
                        ? `Version ${latest.version} · Skapad: ${latest.createdAt}`
                        : "Inte skapat"}
                    </p>
                    {latest ? (
                      <>
                        <p>
                          <Link href={`/applications/${encodeURIComponent(application.id)}/documents/cover-letter`}>
                            Visa personligt brev
                          </Link>
                        </p>
                        <form action={createCoverLetterAction}>
                          <input type="hidden" name="applicationId" value={application.id} />
                          <button type="submit">Skapa ny version</button>
                        </form>
                      </>
                    ) : (
                      <form action={createCoverLetterAction}>
                        <input type="hidden" name="applicationId" value={application.id} />
                        <button type="submit">Skapa personligt brev</button>
                      </form>
                    )}
                  </div>
                );
              }

              return (
                <p key={documentType}>
                  {formatDocumentType(documentType)}: {latest
                    ? `Utkast finns (version ${latest.version})`
                    : "Inte skapat"}
                </p>
              );
            })}
          </>
        )}
      </section>

      <section style={{ marginTop: 40 }}>
        <h2>Tilldelad kandidat</h2>

        {!candidateResult.configured ? (
          <p>Jobbcoachens arbetsyta är inte konfigurerad.</p>
        ) : candidateResult.error ? (
          <p>Kandidattilldelningen kunde inte laddas just nu.</p>
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
              <label htmlFor="candidateId">Kandidat</label>
              <select
                id="candidateId"
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
                  Välj kandidat
                </option>

                {candidateResult.candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.displayName}
                  </option>
                ))}
              </select>

              <button type="submit">
                Tilldela kandidat
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
