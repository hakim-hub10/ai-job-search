import { describe, expect, it, mock } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getCandidateImport } from "../../../.agents/job-search/cli/src/candidate-import";

mock.module("server-only", () => ({}));
const { validateCandidateImportUpload: validate, MAX_CANDIDATE_IMPORT_BYTES: max } = await import("./candidate-import-upload");
const pdf = new TextEncoder().encode("%PDF-1.7\nSYNTHETIC_PRIVATE_BODY");
// Synthetic ZIP local header, intentionally NOT a validated DOCX package.
const zip = new Uint8Array(30);
zip.set([80, 75, 3, 4]);
const candidate = { id: "candidate-A" };
const input = () => ({ candidateId: candidate.id, filename: "cv.pdf", mimeType: "application/pdf", bytes: pdf.slice() });

describe("candidate import admission", () => {
  it("admits PDF metadata without treating content as approved evidence", () => {
    const result = validate(input(), candidate);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected admission");
    expect(result.value.status).toBe("validated");
    expect(result.value.document.format).toBe("pdf");
    expect(result.value.document.importId).toBe(result.value.id);
    expect(result.value.document.candidateId).toBe(candidate.id);
    expect(result.value.createdAt).toBe(result.value.updatedAt);
    expect(result.value.document.validationVersion).toBe(1);
  });
  it("admits only the DOCX ZIP signature, without claiming package validation", () => {
    const result = validate({ ...input(), filename: "cv.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: zip }, candidate);
    expect(result.ok && result.value.document.format).toBe("docx");
  });
  for (const [name, change, code] of [
    ["unsupported extension", { filename: "cv.exe" }, "UNSUPPORTED_FORMAT"],
    ["no extension", { filename: "pdf" }, "UNSUPPORTED_FORMAT"],
    ["unsupported MIME", { mimeType: "text/plain" }, "UNSUPPORTED_FORMAT"],
    ["mismatched MIME", { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, "FORMAT_MISMATCH"],
    ["PDF with ZIP signature", { bytes: zip }, "FORMAT_MISMATCH"],
    ["DOCX with PDF signature", { filename: "cv.docx", mimeType: "", bytes: pdf }, "FORMAT_MISMATCH"],
    ["invalid signature", { bytes: new Uint8Array([1, 2, 3]) }, "INVALID_SIGNATURE"],
    ["truncated ZIP header", { filename: "cv.docx", mimeType: "", bytes: zip.slice(0, 4) }, "INVALID_SIGNATURE"],
    ["invalid PDF version", { bytes: new TextEncoder().encode("%PDF-bad\n") }, "INVALID_SIGNATURE"],
    ["empty file", { bytes: new Uint8Array() }, "EMPTY_FILE"],
    ["oversized file", { bytes: new Uint8Array(max + 1) }, "FILE_TOO_LARGE"],
    ["POSIX traversal", { filename: "../../cv.pdf" }, "INVALID_FILENAME"],
    ["Windows traversal", { filename: "..\\..\\cv.pdf" }, "INVALID_FILENAME"],
    ["Windows absolute path", { filename: "C:\\private\\cv.pdf" }, "INVALID_FILENAME"],
    ["control character", { filename: "private\ncv.pdf" }, "INVALID_FILENAME"],
    ["empty filename", { filename: "" }, "INVALID_FILENAME"],
    ["wrong candidate", { candidateId: "candidate-B" }, "INVALID_CANDIDATE"],
    ["empty candidate", { candidateId: "" }, "INVALID_CANDIDATE"],
  ] as const) {
    it(`rejects ${name} with a sanitized failure`, () => {
      const result = validate({ ...input(), ...change }, candidate);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected rejection");
      expect(result.error.code).toBe(code);
      expect(Object.keys(result.error).sort()).toEqual(["code", "message"]);
      expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE_BODY");
      expect(JSON.stringify(result)).not.toContain("../../");
    });
  }
  it("accepts exactly the maximum size", () => {
    const bytes = new Uint8Array(max);
    bytes.set(pdf);
    const result = validate({ ...input(), bytes }, candidate);
    expect(result.ok && result.value.document.byteSize).toBe(max);
  });
  it("supports missing MIME and case-insensitive extension/MIME", () => {
    expect(validate({ ...input(), mimeType: undefined }, candidate).ok).toBe(true);
    expect(validate({ ...input(), filename: "CV.PDF", mimeType: "APPLICATION/PDF" }, candidate).ok).toBe(true);
  });
  it("hashes exact bytes deterministically but generates independent identities", () => {
    const first = validate(input(), candidate);
    const second = validate(input(), candidate);
    if (!first.ok || !second.ok) throw new Error("Expected admission");
    expect(first.value.document.sha256).toBe(createHash("sha256").update(pdf).digest("hex"));
    expect(first.value.document.sha256).toBe(second.value.document.sha256);
    expect(first.value.id).not.toBe(second.value.id);
    expect(first.value.document.id).not.toBe(second.value.document.id);
    const bytes = input().bytes;
    bytes[bytes.length - 1] ^= 1;
    const changed = validate({ ...input(), bytes }, candidate);
    expect(changed.ok && changed.value.document.sha256).not.toBe(first.value.document.sha256);
  });
  it("returns only metadata, retains no byte reference, and introduces no persistence", () => {
    const upload = { ...input(), rawText: "PRIVATE_RAW_TEXT", claims: ["UNAPPROVED"] };
    const result = validate(upload, candidate);
    if (!result.ok) throw new Error("Expected admission");
    const serialized = JSON.stringify(result.value);
    expect(Object.keys(result.value).sort()).toEqual(["candidateId", "createdAt", "document", "id", "status", "updatedAt"]);
    expect(Object.keys(result.value.document).sort()).toEqual(["byteSize", "candidateId", "format", "id", "importId", "originalFilename", "sha256", "validationVersion"]);
    for (const forbidden of ["PRIVATE_RAW_TEXT", "SYNTHETIC_PRIVATE_BODY", "UNAPPROVED", "rawText", "bytes", "claims"]) expect(serialized).not.toContain(forbidden);
    upload.bytes.fill(0);
    expect(JSON.stringify(result.value)).toBe(serialized);
  });
  it("refuses cross-candidate and inconsistent document linkage; reads are copy-safe", () => {
    const result = validate(input(), candidate);
    if (!result.ok) throw new Error("Expected admission");
    expect(getCandidateImport(result.value, "candidate-B")).toBeNull();
    expect(getCandidateImport({ ...result.value, document: { ...result.value.document, candidateId: "candidate-B" } }, candidate.id)).toBeNull();
    expect(getCandidateImport({ ...result.value, document: { ...result.value.document, importId: "different" } }, candidate.id)).toBeNull();
    const copy = getCandidateImport(result.value, candidate.id)!;
    copy.document.originalFilename = "changed.pdf";
    expect(result.value.document.originalFilename).toBe("cv.pdf");
  });
  it("has an explicit server-only marker", async () => {
    const source = await readFile(new URL("./candidate-import-upload.ts", import.meta.url), "utf8");
    expect(source.startsWith('import "server-only";')).toBe(true);
  });
});
