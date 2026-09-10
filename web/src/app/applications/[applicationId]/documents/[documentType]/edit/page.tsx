import Link from "next/link";

import {
  createConfiguredDocumentEditorDependencies,
  readDocumentEditorState,
} from "@/lib/document-editor";
import EditorControls from "../editor-controls";
import { configuredAuthorizationDependencies, requireOwnedApplication } from "@/lib/authorization";

export const dynamic = "force-dynamic";

function documentLabel(documentType: string) {
  return documentType === "cv" ? "CV" : "Personligt brev";
}

export default async function DocumentEditorPage({
  params,
}: {
  params: Promise<{ applicationId: string; documentType: string }>;
}) {
  const { applicationId, documentType } = await params;
  const decodedId = decodeURIComponent(applicationId);
  const authorization = configuredAuthorizationDependencies();
  const owned = authorization.ok ? await requireOwnedApplication(decodedId, authorization.value) : authorization;
  if (!owned.ok) return <main style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}><h1>Dokumenteditor</h1><p>Dokumentet kunde inte hittas.</p></main>;
  const internalDocumentType = documentType === "cover-letter" ? "coverLetter" : documentType;
  const dependencies = createConfiguredDocumentEditorDependencies();
  const result = dependencies
    ? await readDocumentEditorState(decodedId, internalDocumentType, dependencies)
    : { ok: false as const, code: "DOCUMENT_STORAGE_FAILURE", message: "Dokumentvyn är inte konfigurerad." };
  const backHref = `/applications/${encodeURIComponent(decodedId)}/documents/${encodeURIComponent(documentType)}`;

  if (!result.ok) {
    return (
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <Link href={backHref}>← Tillbaka till dokumentet</Link>
        <h1>Dokumenteditor</h1>
        <p>{result.message}</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
      <Link href={backHref}>← Tillbaka till dokumentet</Link>
      <p style={{ marginTop: 32 }}>DOKUMENTEDITOR</p>
      <h1>{documentLabel(result.value.documentType)}</h1>
      <p>Nuvarande version: {result.value.currentVersion}</p>
      <p>Ändringar sparas som en ny version.</p>

      <EditorControls
        applicationId={result.value.applicationId}
        documentType={result.value.documentType}
        currentVersion={result.value.currentVersion}
        initialContent={result.value.currentContent}
      />
    </main>
  );
}
