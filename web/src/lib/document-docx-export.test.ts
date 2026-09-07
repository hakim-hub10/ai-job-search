import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "bun:test";

import type { DocumentExportModel } from "./document-export";
import { exportDocumentToDocx } from "./document-docx-export";

const execFileAsync = promisify(execFile);
const mediaType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const;

function model(documentType: "cv" | "coverLetter", templateId: "modern" | "classic" | "minimal", content = "## Profil\n- Supporttekniker åäö ÅÄÖ – “citat” • punkt\n## Kompetenser\n- Microsoft 365\n## Erfarenhet\n- Felsökning och användarstöd\n## Okänd framtidssektion\n- Bevarad rad"): DocumentExportModel {
  return {
    applicationId: "application-1",
    documentType,
    documentVersion: 3,
    templateId,
    presentation: {
      documentType,
      version: 3,
      createdAt: "2026-09-07T10:00:00.000Z",
      sections: content.split("## ").filter(Boolean).map((part) => {
        const [heading, ...items] = part.split("\n");
        return { heading, items: items.filter((item) => item.startsWith("- ")).map((item) => item.slice(2)) };
      }),
      rawContent: content,
    },
    format: { format: "docx", extension: "docx", mediaType },
    suggestedFilename: `${documentType}-${templateId}-v3.docx`,
  };
}

async function withDocx<T>(bytes: Uint8Array, action: (path: string) => Promise<T>): Promise<T> {
  const path = `/tmp/phase-11-7c-${crypto.randomUUID()}.docx`;
  await Bun.write(path, bytes);
  try {
    return await action(path);
  } finally {
    await Bun.file(path).delete();
  }
}

async function docxPart(bytes: Uint8Array, part: string): Promise<string> {
  return withDocx(bytes, async (path) => (await execFileAsync("unzip", ["-p", path, part], { maxBuffer: 10 * 1024 * 1024 })).stdout);
}

async function docxEntries(bytes: Uint8Array): Promise<string> {
  return withDocx(bytes, async (path) => (await execFileAsync("unzip", ["-Z1", path])).stdout);
}

describe("Phase 11.7C DOCX export", () => {
  it.each([
    ["cv", "modern"], ["cv", "classic"], ["cv", "minimal"],
    ["coverLetter", "modern"], ["coverLetter", "classic"], ["coverLetter", "minimal"],
  ] as const)("creates an editable A4 OOXML document for %s/%s", async (documentType, templateId) => {
    const result = await exportDocumentToDocx(model(documentType, templateId));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.mediaType).toBe(mediaType);
    expect(result.value.filename).toEndWith(".docx");
    expect(result.value.bytes.length).toBeGreaterThan(1000);
    expect(String.fromCharCode(...result.value.bytes.slice(0, 2))).toBe("PK");
    const entries = await docxEntries(result.value.bytes);
    expect(entries).toContain("[Content_Types].xml");
    expect(entries).toContain("_rels/.rels");
    expect(entries).toContain("word/document.xml");
    expect(entries).not.toContain("vbaProject.bin");
    expect(entries).not.toContain("embeddings/");
    expect(entries).not.toContain("activeX/");
    const documentXml = await docxPart(result.value.bytes, "word/document.xml");
    expect(documentXml).toContain("Supporttekniker åäö ÅÄÖ – “citat” • punkt");
    expect(documentXml).toContain("Okänd framtidssektion");
    expect(documentXml).toContain('w:w="11906"');
    expect(documentXml).toContain('w:h="16838"');
  });

  it("preserves long CV and cover-letter content, unknown sections, and an absent title", async () => {
    const longItems = Array.from({ length: 220 }, (_, index) => `- Rad ${index} med svensk text åäö`).join("\n");
    for (const documentType of ["cv", "coverLetter"] as const) {
      const result = await exportDocumentToDocx(model(documentType, "minimal", `## \n${longItems}\n## Sista sektionen\n- SLUTORD-11-7C`));
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const documentXml = await docxPart(result.value.bytes, "word/document.xml");
      expect(documentXml).toContain("Rad 219 med svensk text åäö");
      expect(documentXml).toContain("Sista sektionen");
      expect(documentXml).toContain("SLUTORD-11-7C");
      expect(documentXml).not.toContain("undefined");
    }
  });

  it("treats hostile text as inert Word text without unsafe package relationships or mutation", async () => {
    const source = model("coverLetter", "modern", "## Kontext\n- <script>alert(1)</script> & < > \" ' ../../etc/passwd javascript:alert(1) {{constructor.constructor(\"return process\")()}}\n## Språk\n- å ä ö Å Ä Ö – — “ ” •");
    const before = structuredClone(source);
    const result = await exportDocumentToDocx(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const documentXml = await docxPart(result.value.bytes, "word/document.xml");
    const relationships = await docxPart(result.value.bytes, "word/_rels/document.xml.rels");
    expect(documentXml).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt; &gt; &quot; &apos;");
    expect(documentXml).toContain("../../etc/passwd javascript:alert(1)");
    expect(documentXml).toContain("å ä ö Å Ä Ö – — “ ” •");
    expect(relationships).not.toContain('TargetMode="External"');
    expect(source).toEqual(before);
  });

  it("removes XML-invalid controls while preserving Swedish and valid Unicode text", async () => {
    const source = model("cv", "minimal", "## Profil\n- Före\u0000\u0007\u001b\tåäö\u2028\u2029\u200b\u202eEfter");
    const result = await exportDocumentToDocx(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const documentXml = await docxPart(result.value.bytes, "word/document.xml");
    expect(documentXml).toContain("Före\tåäö\u2028\u2029\u200b\u202eEfter");
    expect(documentXml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u);
    expect(source.presentation.sections[0].items[0]).toContain("\u0000");
  });

  it("returns typed errors for invalid formats and templates", async () => {
    expect(await exportDocumentToDocx({ ...model("cv", "modern"), templateId: "unknown" as never })).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_DOCX_TEMPLATE" } });
    expect(await exportDocumentToDocx({ ...model("cv", "modern"), format: { format: "pdf", extension: "pdf", mediaType: "application/pdf" } })).toMatchObject({ ok: false, error: { code: "INVALID_EXPORT_MODEL" } });
  });
});