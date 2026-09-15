import Link from "next/link";
import { applicationInterviewPath } from "@/lib/interview-presentation";

import { loadApplicationDetail } from "@/lib/application-detail";
import { loadApplicationDocumentState } from "@/lib/application-documents";
import { loadCandidateBaseCvState } from "@/lib/candidate-base-cv-state";
import { loadCandidateProfile } from "@/lib/candidate-profiles";
import { isApplicationAnalysisStale } from "@/lib/application-reanalysis";
import { buildMatchComparison } from "@/lib/match-comparison";
import SubmitButton from "@/components/submit-button";

import {
  createCoverLetterAction,
  createTailoredCvAction,
  reanalyzeApplicationAction,
  updateApplicationStatusAction,
} from "../actions";
import { configuredAuthorizationDependencies, requireOwnedApplication } from "@/lib/authorization";

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
  searchParams,
}: {
  params: Promise<{ applicationId: string }>;
  searchParams: Promise<{ reanalyzed?: string }>;
}) {
  const { applicationId } = await params;
  const { reanalyzed } = await searchParams;
  const decodedId = decodeURIComponent(applicationId);
  const authorization = configuredAuthorizationDependencies();
  const owned = authorization.ok ? await requireOwnedApplication(decodedId, authorization.value) : authorization;
  if (!owned.ok) return <main style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}><h1>Ansökan kunde inte laddas</h1><p>Ansökan hittades inte.</p></main>;

  const result = await loadApplicationDetail(decodedId);
  const documentResult = await loadApplicationDocumentState(decodedId);

  if (!result.configured) {
    return (
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <Link href="/applications">← Ansökningar</Link>
        <h1>Ansökningar kan inte visas just nu</h1>
      </main>
    );
  }

  if (result.error || !result.application) {
    return (
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <Link href="/applications">← Ansökningar</Link>
        <h1>Ansökan kunde inte laddas</h1>
        <p>Ansökan hittades inte i din lista.</p>
      </main>
    );
  }

  const application = result.application;
  const candidateId = owned.value.context.candidate.id;
  const baseCvResult = await loadCandidateBaseCvState(candidateId);
  const currentProfile = await loadCandidateProfile(candidateId);
  const analysisIsStale = isApplicationAnalysisStale(application, currentProfile.profile?.updatedAt);
  const matchComparison = application.previousAnalysisSnapshot
    ? buildMatchComparison(application.previousAnalysisSnapshot, application.analysisSnapshot, application.jobSnapshot)
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
        <h2>Matchning</h2>

        {reanalyzed === "1" ? (
          <p role="status">Matchningen har uppdaterats utifrån din senaste profil.</p>
        ) : null}

        {analysisIsStale ? (
          <p role="status">Din profil har ändrats sedan den senaste analysen.</p>
        ) : null}

        <form action={reanalyzeApplicationAction} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <input type="hidden" name="applicationId" value={application.id} />
          <SubmitButton pendingLabel="Analyserar jobbet igen…">Analysera om jobbet</SubmitButton>
          <Link href={`/candidates/${encodeURIComponent(candidateId)}?fromApplication=${encodeURIComponent(application.id)}&fromJobTitle=${encodeURIComponent(application.jobSnapshot.title)}`}>
            Uppdatera min profil
          </Link>
        </form>
        <p style={{ marginTop: 8, fontSize: 13 }}>
          Lägg endast till erfarenheter och kompetenser som du faktiskt har.
        </p>

        {matchComparison ? (
          <div style={{ marginTop: 24 }}>
            <p>Tidigare matchning: {matchComparison.previousScore}/100</p>
            <p>Ny matchning: {matchComparison.currentScore}/100</p>
            <p>
              Förändring: {matchComparison.change > 0 ? "+" : ""}
              {matchComparison.change}
            </p>

            {matchComparison.newMatches.length > 0 ? (
              <div style={{ marginTop: 16 }}>
                <strong>Nya matchningar</strong>
                <ul>
                  {matchComparison.newMatches.map((title) => (
                    <li key={title}>✓ {title}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {matchComparison.remainingMissing.length > 0 ? (
              <div style={{ marginTop: 16 }}>
                <strong>Kvarvarande saknade krav</strong>
                <ul>
                  {matchComparison.remainingMissing.map((item, index) => (
                    <li key={`${item.title}:${index}`}>• {item.title}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {matchComparison.remainingUncertain.length > 0 ? (
              <div style={{ marginTop: 16 }}>
                <strong>Kvarvarande osäkerheter</strong>
                <ul>
                  {matchComparison.remainingUncertain.map((item, index) => (
                    <li key={`${item.title}:${index}`}>• {item.title}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {matchComparison.remainingConflicting.length > 0 ? (
              <div style={{ marginTop: 16 }}>
                <strong>Kvarvarande konflikter</strong>
                <ul>
                  {matchComparison.remainingConflicting.map((item, index) => (
                    <li key={`${item.title}:${index}`}>• {item.title}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

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
        <h2>Dina dokument</h2>

        {!documentResult.ok ? (
          <p>Dokumentstatus kunde inte laddas just nu.</p>
        ) : (
          <>
            <p>Skapa och granska dokument som hör till den här ansökan.</p>
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
                        <p><Link href={`/applications/${encodeURIComponent(application.id)}/documents/cv`}>Visa anpassat CV</Link></p>
                        <form action={createTailoredCvAction}>
                          <label>Dokumentspråk <select name="documentLanguage" defaultValue="auto"><option value="auto">Annonsens språk</option><option value="sv">Svenska</option><option value="en">English</option></select></label>
                          <input type="hidden" name="applicationId" value={application.id} />
                          <button type="submit">Skapa ny version</button>
                        </form>
                      </>
                    ) : baseCvResult?.ok && baseCvResult.baseCv ? (
                      <form action={createTailoredCvAction}>
                          <label>Dokumentspråk <select name="documentLanguage" defaultValue="auto"><option value="auto">Annonsens språk</option><option value="sv">Svenska</option><option value="en">English</option></select></label>
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
                        <p><Link href={`/applications/${encodeURIComponent(application.id)}/documents/cover-letter`}>Visa personligt brev</Link></p>
                        <form action={createCoverLetterAction}>
                          <label>Dokumentspråk <select name="documentLanguage" defaultValue="auto"><option value="auto">Annonsens språk</option><option value="sv">Svenska</option><option value="en">English</option></select></label>
                          <input type="hidden" name="applicationId" value={application.id} />
                          <button type="submit">Skapa ny version</button>
                        </form>
                      </>
                    ) : (
                      <form action={createCoverLetterAction}>
                          <label>Dokumentspråk <select name="documentLanguage" defaultValue="auto"><option value="auto">Annonsens språk</option><option value="sv">Svenska</option><option value="en">English</option></select></label>
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
