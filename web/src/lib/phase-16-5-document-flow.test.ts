import { readFile } from "node:fs/promises";
import { describe, expect, it } from "bun:test";

const appPage = new URL("../app/applications/[applicationId]/page.tsx", import.meta.url);

describe("Phase 16.5 document workflow boundary", () => {
  it("makes the Application page the document hub without coach assignment UI", async () => {
    const source = await readFile(appPage, "utf8");
    expect(source).toContain("Dina dokument");
    expect(source).toContain("Skapa anpassat CV");
    expect(source).toContain("Skapa personligt brev");
    expect(source).toContain("Visa anpassat CV");
    expect(source).toContain("Visa personligt brev");
    expect(source).toContain("createTailoredCvAction");
    expect(source).toContain("createCoverLetterAction");
    expect(source).not.toContain("Tilldelad kandidat");
    expect(source).not.toContain("Tilldela kandidat");
    expect(source).not.toContain('name="candidateId"');
  });

  it("keeps review/edit/export as existing document routes", async () => {
    const source = await readFile(appPage, "utf8");
    expect(source).toContain("/documents/cv");
    expect(source).toContain("/documents/cover-letter");
    expect(source).toContain("/documents");
    expect(source).toContain("requireOwnedApplication");
  });
});
