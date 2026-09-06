"use client";

import { useState } from "react";

import { requestDocumentAiRewriteAction, saveDocumentEditAction } from "@/app/applications/actions";

const modes = [
  ["improve", "Förbättra text"],
  ["shorten", "Gör kortare"],
  ["professional", "Mer professionell"],
  ["jobTailored", "Anpassa till jobbet"],
] as const;

interface EditorControlsProps {
  applicationId: string;
  documentType: string;
  currentVersion: number;
  initialContent: string;
}

export default function EditorControls({
  applicationId,
  documentType,
  currentVersion,
  initialContent,
}: EditorControlsProps) {
  const [content, setContent] = useState(initialContent);
  const [proposal, setProposal] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function requestProposal(mode: string) {
    setPending(true);
    setMessage("");
    const formData = new FormData();
    formData.set("applicationId", applicationId);
    formData.set("documentType", documentType);
    formData.set("rewriteMode", mode);
    formData.set("currentDraft", content);
    const result = await requestDocumentAiRewriteAction(formData);
    setPending(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setProposal(result.value.content);
  }

  return (
    <>
      <form action={saveDocumentEditAction} style={{ marginTop: 24 }}>
        <input type="hidden" name="applicationId" value={applicationId} />
        <input type="hidden" name="documentType" value={documentType} />
        <label htmlFor="document-content">Dokumenttext</label>
        <textarea
          id="document-content"
          name="content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          maxLength={20_000}
          rows={24}
          style={{
            display: "block",
            width: "100%",
            marginTop: 8,
            padding: 16,
            font: "inherit",
            lineHeight: 1.5,
          }}
        />
        <button type="submit" style={{ marginTop: 16 }}>
          Spara som ny version
        </button>
      </form>

      <section style={{ marginTop: 32 }}>
        <h2>AI-assistans</h2>
        <p>AI kan hjälpa dig att förbättra formuleringen men får inte lägga till nya meriter.</p>
        <p>Nuvarande version: {currentVersion}. AI-förslag sparas inte automatiskt.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {modes.map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              disabled={pending}
              onClick={() => void requestProposal(mode)}
            >
              {label}
            </button>
          ))}
        </div>
        {message ? <p role="status" style={{ marginTop: 12 }}>{message}</p> : null}
        {proposal ? (
          <div style={{ marginTop: 20 }}>
            <h3>AI-förslag</h3>
            <pre style={{ whiteSpace: "pre-wrap", padding: 16, border: "1px solid #eaecf0" }}>
              {proposal}
            </pre>
            <button type="button" onClick={() => setContent(proposal)}>
              Använd förslag
            </button>
          </div>
        ) : null}
      </section>
    </>
  );
}
