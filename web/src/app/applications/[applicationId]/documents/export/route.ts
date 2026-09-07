import { resolve } from "node:path";
import { createFileApplicationDocumentRepository } from "../../../../../../../.agents/job-search/cli/src/application-document-file-repository";

import { downloadDocument } from "@/lib/document-download";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ applicationId: string }> },
): Promise<Response> {
  const { applicationId } = await context.params;
  const documentRepositoryPath = process.env.APPLICATION_DOCUMENT_REPOSITORY;
  if (!documentRepositoryPath) {
    return new Response("Exporten kunde inte genomföras.", {
      status: 500,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const search = new URL(request.url).searchParams;
  return downloadDocument({
    applicationId,
    documentType: search.get("documentType"),
    templateId: search.get("template"),
    format: search.get("format"),
  }, {
    documentRepository: createFileApplicationDocumentRepository(resolve(documentRepositoryPath)),
  });
}