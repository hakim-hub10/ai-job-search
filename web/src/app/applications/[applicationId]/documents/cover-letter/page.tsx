import Link from "next/link";

import { loadApplicationDocumentState } from "@/lib/application-documents";
import { coverLetterDate, resolveDocumentTemplate, toDocumentPresentationModel } from "@/lib/document-presentation";
import { DocumentPreview } from "../document-preview";
import { configuredAuthorizationDependencies, requireOwnedApplication } from "@/lib/authorization";

export const dynamic = "force-dynamic";

export default async function ApplicationCoverLetterPage({
  params,
  searchParams,
}: {
  params: Promise<{ applicationId: string }>;
  searchParams: Promise<{ template?: string }>;
}) {
  const { applicationId } = await params;
  const { template: templateId } = await searchParams;
  const decodedId = decodeURIComponent(applicationId);
  const authorization = configuredAuthorizationDependencies();
  const owned = authorization.ok ? await requireOwnedApplication(decodedId, authorization.value) : authorization;
  if (!owned.ok) return <main className="documentPage"><h1>Personligt brev kunde inte laddas</h1></main>;
  const result = await loadApplicationDocumentState(decodedId);
  const resolution = resolveDocumentTemplate(templateId);

  if (!result.ok) {
    return <main className="documentPage"><Link href={`/applications/${encodeURIComponent(decodedId)}`}>← Tillbaka till ansökan</Link><h1>Personligt brev kunde inte laddas</h1><p>Dokumentet kunde inte läsas just nu.</p></main>;
  }
  const coverLetter = [...result.documents].filter((document) => document.documentType === "coverLetter").sort((a, b) => b.version - a.version)[0];
  if (!coverLetter) {
    return <main className="documentPage"><Link href={`/applications/${encodeURIComponent(decodedId)}`}>← Tillbaka till ansökan</Link><h1>Personligt brev är inte skapat ännu</h1><p>Skapa ett personligt brev från ansökan innan du öppnar förhandsvisningen.</p></main>;
  }
  const presentation = toDocumentPresentationModel(coverLetter);
  return (
    <DocumentPreview
      applicationId={decodedId}
      presentation={presentation}
      template={resolution.ok ? resolution.template : resolution.fallback}
      editPath={`/applications/${encodeURIComponent(decodedId)}/documents/cover-letter/edit`}
      coverLetterHeader={{
        candidateName: owned.value.context.candidate.displayName,
        candidateEmail: owned.value.context.user.email,
        date: coverLetterDate(presentation.language),
        jobTitle: owned.value.application.jobSnapshot.title,
        employerName: owned.value.application.jobSnapshot.company ?? undefined,
        employerLocation: owned.value.application.jobSnapshot.location ?? undefined,
      }}
    />
  );
}
