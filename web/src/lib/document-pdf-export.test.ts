import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "bun:test";

import type { DocumentExportModel } from "./document-export";
import { exportDocumentToPdf } from "./document-pdf-export";

const execFileAsync = promisify(execFile);

function model(documentType: "cv" | "coverLetter", templateId: "modern" | "classic" | "minimal", content = "## Profil\n- Supporttekniker åäö ÅÄÖ – “citat” • punkt\n## Kompetenser\n- Microsoft 365"): DocumentExportModel {
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
    format: { format: "pdf", extension: "pdf", mediaType: "application/pdf" },
    suggestedFilename: `${documentType}-${templateId}-v3.pdf`,
  };
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const file = `/tmp/phase-11-7b-${crypto.randomUUID()}.pdf`;
  await Bun.write(file, bytes);
  try {
    return (await execFileAsync("pdftotext", [file, "-"])).stdout;
  } finally {
    await Bun.file(file).delete();
  }
}

async function pdfInfo(bytes: Uint8Array): Promise<string> {
  const file = `/tmp/phase-11-7b-${crypto.randomUUID()}.pdf`;
  await Bun.write(file, bytes);
  try {
    return (await execFileAsync("pdfinfo", [file])).stdout;
  } finally {
    await Bun.file(file).delete();
  }
}

describe("Phase 11.7B PDF export", () => {
  it.each([
    ["cv", "modern"], ["cv", "classic"], ["cv", "minimal"],
    ["coverLetter", "modern"], ["coverLetter", "classic"], ["coverLetter", "minimal"],
  ] as const)("creates a real selectable PDF for %s/%s", async (documentType, templateId) => {
    const result = await exportDocumentToPdf(model(documentType, templateId));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.mediaType).toBe("application/pdf");
    expect(result.value.filename.endsWith(".pdf")).toBe(true);
    expect(String.fromCharCode(...result.value.bytes.slice(0, 4))).toBe("%PDF");
    expect((await pdfInfo(result.value.bytes))).toContain("Pages:");
    const text = await pdfText(result.value.bytes);
    expect(text).toContain("Supporttekniker");
    expect(text).toContain("åäö");
    expect(text).toContain("ÅÄÖ");
    expect(text).toContain("citat");
  });

  it("flows long content to multiple pages without truncating the final section", async () => {
    const content = `## Profil\n- Supporttekniker\n${Array.from({ length: 180 }, (_, index) => `- Rad ${index} åäö med tillräckligt innehåll för sidflöde`).join("\n")}\n## Sista sektionen\n- SLUTORD-11-7B`;
    const result = await exportDocumentToPdf(model("cv", "modern", content));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const info = await pdfInfo(result.value.bytes);
    const pages = Number(/Pages:\s+(\d+)/u.exec(info)?.[1] ?? 0);
    expect(pages).toBeGreaterThan(1);
    expect(await pdfText(result.value.bytes)).toContain("SLUTORD-11-7B");
  });

  it("renders hostile document text as inert selectable text and does not mutate the model", async () => {
    const source = model("coverLetter", "minimal", "## Kontext\n- <script>alert(1)</script> javascript:alert(1) ../../etc/passwd {{constructor.constructor()}}\n## Okänt\n- rad");
    const before = structuredClone(source);
    const result = await exportDocumentToPdf(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const text = await pdfText(result.value.bytes);
    expect(text).toContain("script");
    expect(text).toContain("javascript:alert(1)");
    expect(text).toContain("../../etc/passwd");
    expect(source).toEqual(before);
  });

  it("removes XML-invalid controls without changing valid Swedish Unicode", async () => {
    const source = model("cv", "classic", "## Profil\n- Före\u0000\u0007\u001b\tåäö\u2028\u2029\u200b\u202eEfter");
    const result = await exportDocumentToPdf(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const text = await pdfText(result.value.bytes);
    expect(text).toContain("Före");
    expect(text).toContain("åäö");
    expect(text).not.toContain("BEL");
    expect(source.presentation.sections[0].items[0]).toContain("\u0000");
  });

  it("rejects unsupported template/model combinations without invoking LibreOffice", async () => {
    const result = await exportDocumentToPdf({ ...model("cv", "modern"), templateId: "unknown" as never });
    expect(result).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_PDF_TEMPLATE" } });
  });
});