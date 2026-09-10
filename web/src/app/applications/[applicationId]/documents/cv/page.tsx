import Link from "next/link";

import { loadApplicationDocumentState } from "@/lib/application-documents";
import { resolveDocumentTemplate, toDocumentPresentationModel } from "@/lib/document-presentation";
import { DocumentPreview } from "../document-preview";
import { configuredAuthorizationDependencies, requireOwnedApplication } from "@/lib/authorization";

export const dynamic = "force-dynamic";

export default async function ApplicationCvPage({
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
  if (!owned.ok) return <main className="documentPage"><h1>CV kunde inte laddas</h1><p>Dokumentet kunde inte hittas.</p></main>;
  const result = await loadApplicationDocumentState(decodedId);
  const resolution = resolveDocumentTemplate(templateId);

  if (!result.ok) {
    return <main className="documentPage"><Link href={`/applications/${encodeURIComponent(decodedId)}`}>← Tillbaka till ansökan</Link><h1>CV kunde inte laddas</h1><p>Dokumentet kunde inte läsas från det lokala dokumentarkivet.</p></main>;
  }
  const cv = [...result.documents].filter((document) => document.documentType === "cv").sort((a, b) => b.version - a.version)[0];
  if (!cv) {
    return <main className="documentPage"><Link href={`/applications/${encodeURIComponent(decodedId)}`}>← Tillbaka till ansökan</Link><h1>CV är inte skapat ännu</h1><p>Skapa ett anpassat CV från ansökan innan du öppnar förhandsvisningen.</p></main>;
  }
  return <DocumentPreview applicationId={decodedId} presentation={toDocumentPresentationModel(cv)} template={resolution.ok ? resolution.template : resolution.fallback} editPath={`/applications/${encodeURIComponent(decodedId)}/documents/cv/edit`} />;
}
