import "server-only";

import JSZip from "jszip";
import { XMLValidator } from "fast-xml-parser";

import { type CandidateImportUpload, validateCandidateImportUpload } from "./candidate-import-upload";

export const MAX_CANDIDATE_IMPORT_DOCX_ENTRIES = 64;
export const MAX_CANDIDATE_IMPORT_DOCX_TOTAL_UNCOMPRESSED_BYTES = 2 * 1024 * 1024;
export const MAX_CANDIDATE_IMPORT_DOCX_ENTRY_BYTES = 1 * 1024 * 1024;
export const MAX_CANDIDATE_IMPORT_DOCX_COMPRESSION_RATIO = 100;
export const MAX_CANDIDATE_IMPORT_DOCX_TEXT_LENGTH = 100_000;

export interface CandidateImportDocxExtraction {
  text: string;
  extractionVersion: 1;
  trust: "untrusted";
}

const messages = {
  ADMISSION_FAILED: "The DOCX did not pass upload admission.",
  MALFORMED_ARCHIVE: "The DOCX archive could not be read.",
  INVALID_DOCX_STRUCTURE: "The upload is not a supported DOCX document.",
  UNSAFE_ARCHIVE_ENTRY: "The DOCX contains an unsafe archive entry.",
  ARCHIVE_ENTRY_LIMIT_EXCEEDED: "The DOCX contains too many archive entries.",
  ARCHIVE_SIZE_LIMIT_EXCEEDED: "The DOCX archive exceeds extraction limits.",
  COMPRESSION_RISK_EXCEEDED: "The DOCX archive exceeds compression safety limits.",
  ENCRYPTED_ARCHIVE: "Encrypted DOCX archives are not supported.",
  EXTERNAL_RELATIONSHIP: "DOCX files with external relationships are not supported.",
  SUSPICIOUS_CONTENT: "The DOCX contains unsupported embedded content.",
  MALFORMED_DOCUMENT_XML: "The DOCX document text could not be read.",
  NO_EXTRACTABLE_TEXT: "The DOCX does not contain extractable text.",
  TEXT_LIMIT_EXCEEDED: "The DOCX exceeds the 100,000-character extraction limit.",
} as const;

export type CandidateImportDocxExtractionErrorCode = keyof typeof messages;
export type CandidateImportDocxExtractionResult =
  | { ok: true; value: CandidateImportDocxExtraction }
  | { ok: false; error: { code: CandidateImportDocxExtractionErrorCode; message: string } };

function failure(code: CandidateImportDocxExtractionErrorCode): CandidateImportDocxExtractionResult {
  return { ok: false, error: { code, message: messages[code] } };
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

function safeEntryName(name: string): boolean {
  return Boolean(name) && !name.startsWith("/") && !/^[A-Za-z]:/u.test(name)
    && !/[\\\0\u0000-\u001f\u007f]/u.test(name) && !name.split("/").includes("..");
}

function inspectArchive(bytes: Uint8Array): { ok: true; names: Set<string> } | { ok: false; code: CandidateImportDocxExtractionErrorCode } {
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (readU32(bytes, offset) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0 || end + 22 > bytes.length) return { ok: false, code: "MALFORMED_ARCHIVE" };
  const entries = readU16(bytes, end + 10), directorySize = readU32(bytes, end + 12), directoryOffset = readU32(bytes, end + 16);
  if (entries === 0xffff || directoryOffset === 0xffffffff || directoryOffset + directorySize > end) return { ok: false, code: "MALFORMED_ARCHIVE" };
  if (entries > MAX_CANDIDATE_IMPORT_DOCX_ENTRIES) return { ok: false, code: "ARCHIVE_ENTRY_LIMIT_EXCEEDED" };
  const names = new Set<string>(); let cursor = directoryOffset, total = 0;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > bytes.length || readU32(bytes, cursor) !== 0x02014b50) return { ok: false, code: "MALFORMED_ARCHIVE" };
    const flags = readU16(bytes, cursor + 8), compressed = readU32(bytes, cursor + 20), uncompressed = readU32(bytes, cursor + 24);
    const nameLength = readU16(bytes, cursor + 28), extraLength = readU16(bytes, cursor + 30), commentLength = readU16(bytes, cursor + 32);
    const endOfEntry = cursor + 46 + nameLength + extraLength + commentLength;
    if (endOfEntry > bytes.length) return { ok: false, code: "MALFORMED_ARCHIVE" };
    const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    if (!safeEntryName(name) || names.has(name)) return { ok: false, code: "UNSAFE_ARCHIVE_ENTRY" };
    if ((flags & 1) !== 0) return { ok: false, code: "ENCRYPTED_ARCHIVE" };
    if (uncompressed > MAX_CANDIDATE_IMPORT_DOCX_ENTRY_BYTES) return { ok: false, code: "ARCHIVE_SIZE_LIMIT_EXCEEDED" };
    total += uncompressed;
    if (total > MAX_CANDIDATE_IMPORT_DOCX_TOTAL_UNCOMPRESSED_BYTES) return { ok: false, code: "ARCHIVE_SIZE_LIMIT_EXCEEDED" };
    if ((compressed === 0 && uncompressed > 0) || (compressed > 0 && uncompressed / compressed > MAX_CANDIDATE_IMPORT_DOCX_COMPRESSION_RATIO)) return { ok: false, code: "COMPRESSION_RISK_EXCEEDED" };
    names.add(name); cursor = endOfEntry;
  }
  return { ok: true, names };
}

function normalize(text: string): string {
  return text.replace(/\r\n?/gu, "\n").replace(/\0/gu, "").trim();
}

function decodeXmlText(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos);/gu, (_match, name: string) => ({ amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" })[name]!);
}

function extractWordText(xml: string): string {
  const withBreaks = xml
    .replace(/<w:(?:tab)\b[^>]*\/?\s*>/giu, "\t")
    .replace(/<w:(?:br|cr)\b[^>]*\/?\s*>/giu, "\n")
    .replace(/<\/w:tc\s*>/giu, "\t")
    .replace(/<\/w:(?:p|tr)\s*>/giu, "\n");
  return decodeXmlText(withBreaks.replace(/<[^>]+>/gu, ""));
}

/** Extracts transient untrusted text from an admitted DOCX without writing files or following relationships. */
export async function extractCandidateImportDocx(upload: CandidateImportUpload, candidate: { id: string }): Promise<CandidateImportDocxExtractionResult> {
  const admission = validateCandidateImportUpload(upload, candidate);
  if (!admission.ok || admission.value.document.format !== "docx") return failure("ADMISSION_FAILED");
  const inspected = inspectArchive(upload.bytes);
  if (!inspected.ok) return failure(inspected.code);
  if (!inspected.names.has("[Content_Types].xml") || !inspected.names.has("word/document.xml")) return failure("INVALID_DOCX_STRUCTURE");
  if ([...inspected.names].some((name) => /(?:^|\/)(?:vbaProject\.bin|activeX\/|embeddings\/|oleObject)/iu.test(name))) return failure("SUSPICIOUS_CONTENT");
  try {
    const zip = await JSZip.loadAsync(upload.bytes.slice(), { checkCRC32: false, createFolders: false });
    const relationships = Object.values(zip.files).filter((entry) => /\.rels$/u.test(entry.name));
    for (const relationship of relationships) {
      const content = await relationship.async("string");
      if (/TargetMode\s*=\s*["']External["']/iu.test(content)) return failure("EXTERNAL_RELATIONSHIP");
    }
    const document = zip.file("word/document.xml");
    if (!document) return failure("INVALID_DOCX_STRUCTURE");
    const xml = await document.async("string");
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(xml) || XMLValidator.validate(xml) !== true) return failure("MALFORMED_DOCUMENT_XML");
    const text = normalize(extractWordText(xml));
    if (!text) return failure("NO_EXTRACTABLE_TEXT");
    if (text.length > MAX_CANDIDATE_IMPORT_DOCX_TEXT_LENGTH) return failure("TEXT_LIMIT_EXCEEDED");
    return { ok: true, value: { text, extractionVersion: 1, trust: "untrusted" } };
  } catch {
    return failure("MALFORMED_ARCHIVE");
  }
}