import { describe, expect, it, mock } from "bun:test";
import JSZip from "jszip";

mock.module("server-only", () => ({}));
const {
  extractCandidateImportDocx: extract,
  MAX_CANDIDATE_IMPORT_DOCX_ENTRIES: maxEntries,
  MAX_CANDIDATE_IMPORT_DOCX_TEXT_LENGTH: maxText,
} = await import("./candidate-import-docx");

const candidate = { id: "candidate-A" };
const contentTypes = "<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>";
const documentXml = (body: string) => `<?xml version="1.0"?><w:document xmlns:w="urn:test"><w:body>${body}</w:body></w:document>`;

async function docx(entries: Record<string, string> = {}, compression: "DEFLATE" | "STORE" = "DEFLATE"): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("word/document.xml", documentXml("<w:p><w:r><w:t>Ada Lovelace</w:t></w:r></w:p>"));
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array", compression }));
}

function upload(bytes: Uint8Array) {
  return { candidateId: candidate.id, filename: "cv.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes };
}

const failureCases = [
  ["an arbitrary ZIP", await (async () => { const zip = new JSZip(); zip.file("plain.txt", "no docx"); return new Uint8Array(await zip.generateAsync({ type: "uint8array" })); })(), "INVALID_DOCX_STRUCTURE"],
  ["malformed archive", new Uint8Array([80, 75, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "MALFORMED_ARCHIVE"],
  ["malformed document XML", await docx({ "word/document.xml": "<w:document><broken>" }), "MALFORMED_DOCUMENT_XML"],
  ["an external relationship", await docx({ "word/_rels/document.xml.rels": "<Relationships><Relationship TargetMode=\"External\" Target=\"https://example.invalid\"/></Relationships>" }), "EXTERNAL_RELATIONSHIP"],
  ["a macro entry", await docx({ "word/vbaProject.bin": "not executed" }), "SUSPICIOUS_CONTENT"],
  ["too many entries", await docx(Object.fromEntries(Array.from({ length: maxEntries - 1 }, (_, index) => [`word/media/${index}.bin`, "x"]))), "ARCHIVE_ENTRY_LIMIT_EXCEEDED"],
  ["text over the limit", await docx({ "word/document.xml": documentXml(`<w:p><w:r><w:t>${"x".repeat(maxText + 1)}</w:t></w:r></w:p>`) }, "STORE"), "TEXT_LIMIT_EXCEEDED"],
] as const;

describe("candidate import DOCX extraction", () => {
  it("extracts paragraphs, tabs and table cells as untrusted text deterministically", async () => {
    const bytes = await docx({ "word/document.xml": documentXml("<w:p><w:r><w:t>Ada</w:t><w:tab/><w:t>Lovelace</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Platform</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Engineer</w:t></w:r></w:p></w:tc></w:tr></w:tbl>") });
    const first = await extract(upload(bytes), candidate);
    expect(first).toEqual(await extract(upload(bytes), candidate));
    const serialized = JSON.stringify(first);
    expect(serialized).toContain("Ada\\tLovelace");
    expect(serialized).toContain("Platform");
    expect(serialized).toContain("Engineer");
    expect(serialized).toContain("\"trust\":\"untrusted\"");
  });

  for (const [name, bytes, code] of failureCases) {
    it(`returns a sanitized error for ${name}`, async () => {
      const result = await extract(upload(bytes), candidate);
      expect(result).toEqual({ ok: false, error: { code, message: expect.any(String) } });
      expect(JSON.stringify(result)).not.toContain("example.invalid");
    });
  }

  it("accepts exactly the text limit", async () => {
    const result = await extract(upload(await docx({ "word/document.xml": documentXml(`<w:p><w:r><w:t>${"x".repeat(maxText)}</w:t></w:r></w:p>`) }, "STORE")), candidate);
    expect(result.ok && result.value.text).toHaveLength(maxText);
  });
});