import Link from "next/link";

import { loadApplicationDocumentState } from "@/lib/application-documents";

export const dynamic = "force-dynamic";

export default async function ApplicationCoverLetterPage({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const { applicationId } = await params;
  const decodedId = decodeURIComponent(applicationId);
  const result = await loadApplicationDocumentState(decodedId);

  if (!result.ok) {
    return (
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <Link href={`/applications/${encodeURIComponent(decodedId)}`}>
          ← Tillbaka till ansökan
        </Link>
        <h1>Personligt brev kunde inte laddas</h1>
        <p>Dokumentet kunde inte läsas från det lokala dokumentarkivet.</p>
      </main>
    );
  }

  const coverLetter = [...result.documents]
    .filter((document) => document.documentType === "coverLetter")
    .sort((a, b) => b.version - a.version)[0];

  if (!coverLetter) {
    return (
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <Link href={`/applications/${encodeURIComponent(decodedId)}`}>
          ← Tillbaka till ansökan
        </Link>
        <h1>Personligt brev är inte skapat ännu</h1>
        <p>Skapa ett personligt brev från ansökan innan du öppnar förhandsvisningen.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
      <Link href={`/applications/${encodeURIComponent(decodedId)}`}>
        ← Tillbaka till ansökan
      </Link>
      <p style={{ marginTop: 32 }}>DOKUMENT</p>
      <h1>Personligt brev</h1>
      <p>Version {coverLetter.version} · Skapad: {coverLetter.createdAt}</p>
      <p>Detta är en strukturerad disposition som ska granskas av användaren.</p>
      <p>
        <Link href={`/applications/${encodeURIComponent(decodedId)}/documents/cover-letter/edit`}>
          Redigera personligt brev
        </Link>
      </p>
      <pre
        style={{
          marginTop: 32,
          padding: 24,
          overflowX: "auto",
          whiteSpace: "pre-wrap",
          border: "1px solid #eaecf0",
          borderRadius: 8,
          background: "#fcfcfd",
          lineHeight: 1.6,
        }}
      >
        {coverLetter.renderedDocument.content}
      </pre>
    </main>
  );
}
