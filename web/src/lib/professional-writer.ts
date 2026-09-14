import {
  createOpenAIDocumentGenerator,
  generateApplicationDocument,
  type ApplicationDocumentGenerator,
  type GenerateApplicationDocumentInput,
  type GeneratedApplicationDocumentWorkflowResult,
  type OpenAIDocumentGeneratorConfig,
} from "../../../.agents/job-search/cli/src/index";
import { createJobAwareDocumentGenerator } from "./professional-documents";

/**
 * Shared token budget for every feature that sends the application-document
 * JSON schema to an OpenAI Responses model (full CV/cover-letter generation
 * here, and the manual AI-rewrite feature in applications/actions.ts). Proven
 * live against gpt-5.6-sol: 1200 (the old default, sized for the older
 * non-reasoning gpt-4.1-mini) truncated with status="incomplete" because a
 * reasoning-capable model spends part of max_output_tokens on internal
 * reasoning tokens before emitting visible JSON; 8000 completed in full. Keep
 * every caller of the OpenAI document generator on this one constant instead
 * of a locally hardcoded number, so this proven budget cannot silently drift
 * out of sync between features that share the exact same request/response
 * shape and model.
 */
export const PROFESSIONAL_WRITER_MAX_OUTPUT_TOKENS = 8000;

export type ProfessionalWriterConfigResult =
  | { config: OpenAIDocumentGeneratorConfig; missing: [] }
  | { config: null; missing: string[] };

/**
 * Reads the live AI Professional Writer configuration. No default model is
 * assumed: an operator must set OPENAI_MODEL explicitly, so production never
 * silently runs a model nobody chose - if anything is missing, the caller
 * falls back to the deterministic generator rather than guessing.
 */
export function resolveProfessionalWriterConfig(): ProfessionalWriterConfigResult {
  const missing: string[] = [];
  const enabled = process.env.AI_DOCUMENTS_ENABLED === "true";
  if (!enabled) missing.push("AI_DOCUMENTS_ENABLED=true");
  const consent = process.env.AI_REMOTE_GENERATION_CONSENT === "true";
  if (!consent) missing.push("AI_REMOTE_GENERATION_CONSENT=true");
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  if (!apiKey) missing.push("OPENAI_API_KEY");
  const model = process.env.OPENAI_MODEL?.trim() ?? "";
  if (!model) missing.push("OPENAI_MODEL");
  if (missing.length) return { config: null, missing };
  return { config: { enabled, remoteGenerationConsent: consent, apiKey, model, maxOutputTokens: PROFESSIONAL_WRITER_MAX_OUTPUT_TOKENS, timeoutMs: 30_000 }, missing: [] };
}

export type ProfessionalWriterGeneratorUsed = "ai" | "deterministic";

export interface ProfessionalWriterFallbackReason {
  stage: "generation";
  code: string;
}

export interface ProfessionalWriterOutcome {
  result: GeneratedApplicationDocumentWorkflowResult;
  generatorUsed: ProfessionalWriterGeneratorUsed;
  /** Present only when the AI writer was tried and a fallback to the deterministic generator actually happened. */
  fallbackReason?: ProfessionalWriterFallbackReason;
}

/**
 * The single production entry point for job-aware, Base-CV-aware CV and
 * cover-letter generation: prefers the GPT Professional Writer when it is
 * enabled and configured, and falls back to the existing deterministic
 * generator whenever the AI path cannot produce a document.
 *
 * A fallback is triggered only for a "generation"-stage failure - covering
 * both a provider-level failure (unavailable, timeout, malformed/incomplete
 * response, rate limit, refusal) and a validateGeneratedDocumentProposal
 * rejection (unsupported claim, missing/unapproved evidence, invalid cover
 * letter structure, etc.). Either way, the invalid or failed AI attempt is
 * never returned as ok:true, so callers can never persist it - only the
 * deterministic retry's own successful result can be saved. A failure at any
 * other stage (foundation/tailoring/conversion/rendering) is not retried,
 * since it reflects the input data itself and would fail identically for the
 * deterministic generator.
 */
export async function generateProfessionalDocument(
  input: Omit<GenerateApplicationDocumentInput, "generator">,
  deterministicGenerator: ApplicationDocumentGenerator,
): Promise<ProfessionalWriterOutcome> {
  const { config } = resolveProfessionalWriterConfig();
  if (!config) {
    return { result: await generateApplicationDocument({ ...input, generator: deterministicGenerator }), generatorUsed: "deterministic" };
  }
  const aiGenerator = createJobAwareDocumentGenerator(createOpenAIDocumentGenerator(config));
  const aiResult = await generateApplicationDocument({ ...input, generator: aiGenerator });
  if (aiResult.ok) return { result: aiResult, generatorUsed: "ai" };
  if (aiResult.error.stage !== "generation") return { result: aiResult, generatorUsed: "ai" };
  const fallbackResult = await generateApplicationDocument({ ...input, generator: deterministicGenerator });
  return {
    result: fallbackResult,
    generatorUsed: "deterministic",
    fallbackReason: { stage: "generation", code: aiResult.error.error.code },
  };
}
