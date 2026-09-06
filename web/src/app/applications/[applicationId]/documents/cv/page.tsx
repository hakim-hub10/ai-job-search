import Link from "next/link";

import { loadApplicationDocumentState } from "@/lib/application-documents";

export const dynamic = "force-dynamic";

export default async function ApplicationCvPage({
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
        <h1>CV kunde inte laddas</h1>
        <p>Dokumentet kunde inte läsas från det lokala dokumentarkivet.</p>
      </main>
    );
  }

  const cv = [...result.documents]
    .filter((document) => document.documentType === "cv")
    .sort((a, b) => b.version - a.version)[0];

  if (!cv) {
    return (
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <Link href={`/applications/${encodeURIComponent(decodedId)}`}>
          ← Tillbaka till ansökan
        </Link>
        <h1>CV är inte skapat ännu</h1>
        <p>Skapa ett anpassat CV från ansökan innan du öppnar förhandsvisningen.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
      <Link href={`/applications/${encodeURIComponent(decodedId)}`}>
        ← Tillbaka till ansökan
      </Link>
      <p style={{ marginTop: 32 }}>DOKUMENT</p>
      <h1>CV</h1>
      <p>Version {cv.version} · Skapad: {cv.createdAt}</p>
      <p>Detta är ett internt utkast som ska granskas av användaren.</p>
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
        {cv.renderedDocument.content}
      </pre>
    </main>
  );
}
