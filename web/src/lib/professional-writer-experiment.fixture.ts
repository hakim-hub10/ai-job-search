import {
  analyzeJobs,
  createApplication,
  generateApplicationDocument,
  createOpenAIDocumentGenerator,
  type NormalizedJob,
  type ApplicationDocumentGenerator,
  type OpenAIDocumentGeneratorConfig,
} from "../../../.agents/job-search/cli/src/index";
import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import { createCandidateBaseCvFromProfile, mergeBaseCvIntoProfile } from "./candidate-base-cv";
import { documentQualityProfile, createProfessionalDocumentGenerator, createJobAwareDocumentGenerator } from "./professional-documents";
import { jobAwareProfile, itSupportJob } from "./job-aware-generation.fixture";
import { resolveProfessionalWriterConfig } from "./professional-writer";

export { jobAwareProfile, itSupportJob };

/**
 * This experiment reuses the exact same production config resolver
 * (professional-writer.ts) rather than a parallel copy, so the A/B
 * comparison always reflects the real production token budget and env
 * contract - never a second, possibly-drifting definition of "configured".
 */
export const experimentOpenAiConfig = resolveProfessionalWriterConfig;

/** applicationId is isolated per call (crypto.randomUUID) - never a stored/real application. */
function experimentApplication(profile: CandidateProfile, job: NormalizedJob) {
  const rankedJob = analyzeJobs(profile, [job]).rankedJobs[0];
  const created = createApplication({ id: `experiment-${crypto.randomUUID()}`, rankedJob, createdAt: new Date().toISOString() });
  if (!created.ok) throw new Error("experiment fixture failed to build an application");
  return created.value;
}

async function run(
  profile: CandidateProfile,
  job: NormalizedJob,
  type: "cv" | "coverLetter",
  language: "sv" | "en",
  generator: ApplicationDocumentGenerator,
  identity: { fullName: string; email?: string; phone?: string },
) {
  const application = experimentApplication(profile, job);
  return generateApplicationDocument({
    application,
    candidateDocumentInput: { matchingProfile: documentQualityProfile(profile), identity },
    tailoringOptions: { type, language, maxEvidenceItems: 200 },
    generator,
    generationOptions: { untrustedJobDescription: job.description ?? undefined },
  });
}

const identity = { fullName: "Alex Testsson", email: "alex.testsson@example.test", phone: "070-000 00 00" };

/**
 * Shared evidence path for BOTH CV and cover letter: profile merged through a
 * synthetic Base CV first, using the same mergeBaseCvIntoProfile production
 * CV generation (tailored-cv.ts) and cover-letter generation (cover-letter.ts)
 * both now call. All four generation functions below use this same merged
 * profile, so the generator is the only variable in the A/B comparison, and
 * CV vs. cover letter draw from the identical approved evidence universe -
 * matching production, not diverging from it as an earlier version of this
 * fixture (deliberately) did before that production gap was fixed.
 */
function evidenceProfile(): CandidateProfile {
  const profile = jobAwareProfile();
  const baseCv = createCandidateBaseCvFromProfile("experiment-candidate", profile, "2026-09-13T10:00:00.000Z");
  if (!baseCv.ok) throw new Error("experiment fixture failed to build a Base CV");
  return mergeBaseCvIntoProfile(profile, baseCv.value);
}

export async function generateDeterministicCv(job: NormalizedJob, language: "sv" | "en") {
  return run(evidenceProfile(), job, "cv", language, createProfessionalDocumentGenerator({ composeSummary: true }), identity);
}

export async function generateAiWrittenCv(job: NormalizedJob, language: "sv" | "en", config: OpenAIDocumentGeneratorConfig) {
  return run(evidenceProfile(), job, "cv", language, createJobAwareDocumentGenerator(createOpenAIDocumentGenerator(config)), identity);
}

export async function generateDeterministicCoverLetter(job: NormalizedJob, language: "sv" | "en") {
  return run(evidenceProfile(), job, "coverLetter", language, createProfessionalDocumentGenerator({ composeSummary: true }), identity);
}

export async function generateAiWrittenCoverLetter(job: NormalizedJob, language: "sv" | "en", config: OpenAIDocumentGeneratorConfig) {
  return run(evidenceProfile(), job, "coverLetter", language, createJobAwareDocumentGenerator(createOpenAIDocumentGenerator(config)), identity);
}
