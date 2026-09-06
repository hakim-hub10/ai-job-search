import Link from "next/link";

import { loadApplicationDocumentState } from "@/lib/application-documents";
import { resolveDocumentTemplate, toDocumentPresentationModel } from "@/lib/document-presentation";
import { DocumentPreview } from "../document-preview";

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
  const result = await loadApplicationDocumentState(decodedId);
  const resolution = resolveDocumentTemplate(templateId);

  if (!result.ok) {
    return <main className="documentPage"><Link href={`/applications/${encodeURIComponent(decodedId)}`}>← Tillbaka till ansökan</Link><h1>Personligt brev kunde inte laddas</h1><p>Dokumentet kunde inte läsas från det lokala dokumentarkivet.</p></main>;
  }
  const coverLetter = [...result.documents].filter((document) => document.documentType === "coverLetter").sort((a, b) => b.version - a.version)[0];
  if (!coverLetter) {
    return <main className="documentPage"><Link href={`/applications/${encodeURIComponent(decodedId)}`}>← Tillbaka till ansökan</Link><h1>Personligt brev är inte skapat ännu</h1><p>Skapa ett personligt brev från ansökan innan du öppnar förhandsvisningen.</p></main>;
  }
  return <DocumentPreview applicationId={decodedId} presentation={toDocumentPresentationModel(coverLetter)} template={resolution.ok ? resolution.template : resolution.fallback} editPath={`/applications/${encodeURIComponent(decodedId)}/documents/cover-letter/edit`} />;
}
