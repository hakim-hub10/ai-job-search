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
  const profileChangedSinceLastAnalysis = Boolean(
    !analysisIsStale
      && application.previousAnalysisSnapshot
      && application.previousAnalysisSnapshot.candidateProfileUpdatedAt !== application.analysisSnapshot.candidateProfileUpdatedAt,
  );

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

            {profileChangedSinceLastAnalysis ? (
              <section style={{ marginTop: 24, padding: 16, border: "1px solid #ccd2dc", borderRadius: 8 }}>
                <h3>Uppdatera dina ansökningsdokument</h3>
                <p>
                  Din profil och matchningsanalys har uppdaterats. Du kan nu skapa nya versioner av ditt anpassade CV och personliga brev.
                </p>
                <p style={{ fontSize: 13 }}>Lägg endast till erfarenheter och kompetenser som du faktiskt har.</p>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {baseCvResult?.ok && baseCvResult.baseCv ? (
                    <form action={createTailoredCvAction}>
                      <input type="hidden" name="applicationId" value={application.id} />
                      <SubmitButton pendingLabel="Skapar ny CV-version med AI…">Skapa ny CV-version</SubmitButton>
                    </form>
                  ) : null}
                  <form action={createCoverLetterAction}>
                    <input type="hidden" name="applicationId" value={application.id} />
                    <SubmitButton pendingLabel="Skapar nytt personligt brev med AI…">Skapa ny version av personligt brev</SubmitButton>
                  </form>
                </div>
              </section>
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
            <p>Skapa och granska dokument som hör till den här ansökan. Tidigare versioner tas aldrig bort.</p>
            {analysisIsStale ? (
              <section style={{ padding: 16, border: "1px solid #ccd2dc", borderRadius: 8 }} role="status">
                <p>Din profil har ändrats sedan den senaste analysen.</p>
                <p>Analysera om jobbet först för att använda din senaste profil i de anpassade dokumenten.</p>
                <form action={reanalyzeApplicationAction}>
                  <input type="hidden" name="applicationId" value={application.id} />
                  <SubmitButton pendingLabel="Analyserar jobbet igen…">Analysera om jobbet</SubmitButton>
                </form>
              </section>
            ) : null}
            {(["cv", "coverLetter"] as const).map((documentType) => {
              const versions = [...documentResult.documents]
                .filter((document) => document.documentType === documentType)
                .sort((a, b) => b.version - a.version);
              const latest = versions[0];
              const viewHref = documentType === "cv"
                ? `/applications/${encodeURIComponent(application.id)}/documents/cv`
                : `/applications/${encodeURIComponent(application.id)}/documents/cover-letter`;
              const createAction = documentType === "cv" ? createTailoredCvAction : createCoverLetterAction;
              const newVersionPendingLabel = documentType === "cv" ? "Skapar ny CV-version med AI…" : "Skapar nytt personligt brev med AI…";
              const firstVersionPendingLabel = documentType === "cv" ? "Skapar anpassat CV med AI…" : "Skapar personligt brev med AI…";
              const viewLabel = documentType === "cv" ? "Visa anpassat CV" : "Visa personligt brev";
              const createLabel = documentType === "cv" ? "Skapa anpassat CV" : "Skapa personligt brev";

              return (
                <div key={documentType}>
                  <p>
                    <strong>{formatDocumentType(documentType)}</strong>
                  </p>
                  {versions.length > 0 ? (
                    <ul>
                      {versions.map((document, index) => (
                        <li key={document.version}>
                          Version {document.version} — {index === 0 ? "senaste" : "tidigare"} · Skapad: {document.createdAt}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>Inte skapat</p>
                  )}
                  {latest ? <p><Link href={viewHref}>{viewLabel}</Link></p> : null}
                  {analysisIsStale ? null : latest ? (
                    <form action={createAction}>
                      <label>Dokumentspråk <select name="documentLanguage" defaultValue="auto"><option value="auto">Annonsens språk</option><option value="sv">Svenska</option><option value="en">English</option></select></label>
                      <input type="hidden" name="applicationId" value={application.id} />
                      <SubmitButton pendingLabel={newVersionPendingLabel}>Skapa ny version</SubmitButton>
                    </form>
                  ) : !latest && documentType === "cv" && !(baseCvResult?.ok && baseCvResult.baseCv) ? (
                    <p>Grund-CV saknas. Skapa ett grund-CV innan du skapar ett anpassat CV.</p>
                  ) : !latest ? (
                    <form action={createAction}>
                      <label>Dokumentspråk <select name="documentLanguage" defaultValue="auto"><option value="auto">Annonsens språk</option><option value="sv">Svenska</option><option value="en">English</option></select></label>
                      <input type="hidden" name="applicationId" value={application.id} />
                      <SubmitButton pendingLabel={firstVersionPendingLabel}>{createLabel}</SubmitButton>
                    </form>
                  ) : null}
                </div>
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
