import { open, rm } from "node:fs/promises"
import type { ApplicationRecord } from "./applications"
import {
  buildApplicationDocumentFoundation,
  type CandidateDocumentInput,
  type DocumentFoundationError,
  type DocumentLanguage,
  type DocumentType,
} from "./application-documents"
import type { ApplicationDocumentGenerator } from "./document-generation"
import { renderApplicationDocument, type RenderError, type RenderedDocument } from "./document-rendering"
import { createTailoringPlan, type TailoringError } from "./document-tailoring"
import { generateApplicationDocument, type GeneratedApplicationDocumentWorkflowResult } from "./document-workflow"

export interface ExistingApplicationDocumentInput {
  application: ApplicationRecord
  candidateDocumentInput: Omit<CandidateDocumentInput, "matchingProfile">
  type: DocumentType
  language: DocumentLanguage
  outputPath?: string
  generator?: ApplicationDocumentGenerator
}

export type ExistingApplicationDocumentError =
  | { stage: "foundation"; error: DocumentFoundationError }
  | { stage: "tailoring"; error: TailoringError }
  | { stage: "rendering"; error: RenderError }
  | { stage: "output"; error: { code: "OUTPUT_EXISTS" | "OUTPUT_WRITE_FAILURE"; message: string } }

export type ExistingApplicationDocumentResult =
  | {
      ok: true
      deterministic: RenderedDocument
      outputPath?: string
      ai?: GeneratedApplicationDocumentWorkflowResult
    }
  | { ok: false; error: ExistingApplicationDocumentError }

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined
}

async function writeExclusiveOutput(path: string, content: string): Promise<{ ok: true } | { ok: false; code: "OUTPUT_EXISTS" | "OUTPUT_WRITE_FAILURE"; message: string }> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(path, "wx", 0o600)
  } catch (error) {
    return errorCode(error) === "EEXIST"
      ? { ok: false, code: "OUTPUT_EXISTS", message: "Document output target already exists." }
      : { ok: false, code: "OUTPUT_WRITE_FAILURE", message: "Document output file could not be created." }
  }
  try {
    await handle.writeFile(content, { encoding: "utf8" })
    await handle.sync()
    await handle.close()
    return { ok: true }
  } catch {
    await handle.close().catch(() => undefined)
    await rm(path, { force: true }).catch(() => undefined)
    return { ok: false, code: "OUTPUT_WRITE_FAILURE", message: "Document output file could not be written." }
  }
}

export async function generateExistingApplicationDocument(input: ExistingApplicationDocumentInput): Promise<ExistingApplicationDocumentResult> {
  const foundation = buildApplicationDocumentFoundation(input.application, input.candidateDocumentInput)
  if (!foundation.ok) return { ok: false, error: { stage: "foundation", error: foundation.error } }
  const plan = createTailoringPlan(foundation.value, { type: input.type, language: input.language })
  if (!plan.ok) return { ok: false, error: { stage: "tailoring", error: plan.error } }
  const rendered = renderApplicationDocument(foundation.value, plan.value)
  if (!rendered.ok) return { ok: false, error: { stage: "rendering", error: rendered.error } }

  if (input.outputPath) {
    const output = await writeExclusiveOutput(input.outputPath, rendered.value.content)
    if (!output.ok) return { ok: false, error: { stage: "output", error: output } }
  }

  const ai = input.generator
    ? await generateApplicationDocument({
        application: input.application,
        candidateDocumentInput: input.candidateDocumentInput,
        tailoringOptions: { type: input.type, language: input.language },
        generator: input.generator,
        generationOptions: { untrustedJobDescription: input.application.jobSnapshot.description ?? undefined },
      })
    : undefined
  return {
    ok: true,
    deterministic: rendered.value,
    ...(input.outputPath ? { outputPath: input.outputPath } : {}),
    ...(ai ? { ai } : {}),
  }
}
