/** Synthetic documents only. Writes review artifacts outside all candidate stores. */
import { mkdir } from "node:fs/promises";
import { generateProfessionalFixture } from "../src/lib/professional-documents.fixture";
import { toDocumentPresentationModel } from "../src/lib/document-presentation";
import { documentExportFormat, type DocumentExportModel } from "../src/lib/document-export";
import { exportDocumentToPdf } from "../src/lib/document-pdf-export";
import { exportDocumentToDocx } from "../src/lib/document-docx-export";
const directory = "/tmp/document-quality-review";
await mkdir(directory, { recursive: true });
for (const type of ["cv", "coverLetter"] as const) for (const language of ["sv", "en"] as const) {
  const { record } = await generateProfessionalFixture(type, language);
  for (const templateId of ["modern", "classic", "minimal"] as const) {
    const base = `${type}-${language}-${templateId}`;
    const model: DocumentExportModel = { applicationId: record.applicationId, documentType: type, documentVersion: 1, templateId, presentation: toDocumentPresentationModel(record), format: documentExportFormat("pdf")!, suggestedFilename: `${base}.pdf` };
    const pdf = await exportDocumentToPdf(model); if (!pdf.ok) throw new Error(pdf.error.code);
    await Bun.write(`${directory}/${base}.pdf`, pdf.value.bytes);
    const docx = await exportDocumentToDocx({ ...model, format: documentExportFormat("docx")!, suggestedFilename: `${base}.docx` }); if (!docx.ok) throw new Error(docx.error.code);
    await Bun.write(`${directory}/${base}.docx`, docx.value.bytes);
  }
}
console.log("Created 24 synthetic PDF/Word review artifacts in /tmp/document-quality-review");
