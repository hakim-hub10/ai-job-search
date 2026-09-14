import { afterEach, describe, expect, it } from "bun:test";

import {
  analyzeJobs,
  createApplication,
  normalizeJob,
  type ApplicationRecord,
  type ApplicationRepository,
  type CandidateApplicationAssociationRepository,
  type CoachWorkspaceRepository,
  type DocumentGenerationRequest,
  type GeneratedDocumentProposal,
  type NormalizedJob,
} from "../../../.agents/job-search/cli/src/index";
import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import type { CandidateProfileRepository } from "../../../.agents/job-search/cli/src/candidate-profile-repository";
import type { ApplicationDocumentRecord, ApplicationDocumentRepository } from "../../../.agents/job-search/cli/src/application-document-repository";
import type { CandidateBaseCvRepository } from "./candidate-base-cv-repository";
import { createCandidateBaseCvFromProfile } from "./candidate-base-cv";
import { createCoverLetter } from "./cover-letter";
import { createTailoredCv } from "./tailored-cv";

/**
 * Production-path tests: these exercise createTailoredCv/createCoverLetter
 * exactly as applications/actions.ts calls them - through the real
 * generateProfessionalDocument -> resolveProfessionalWriterConfig ->
 * createOpenAIDocumentGenerator -> createJobAwareDocumentGenerator chain -
 * never a parallel test-only generator. Only the network boundary
 * (global.fetch) is mocked, exactly like openai-document-generator.test.ts,
 * so this proves the real production composition without a live API call.
 */
const timestamp = "2026-09-06T10:00:00.000Z";
const candidateId = "candidate-a";
const applicationId = "application-a";

function profile(): CandidateProfile {
  return {
    headline: "IT-supporttekniker",
    targetRoles: ["IT Support"],
    locationPreferences: ["Jönköping"],
    workMode: "onsite",
    remotePreference: false,
    preferredIndustries: ["IT"],
    preferredEmploymentType: ["full-time"],
    skills: { technical: ["Microsoft 365", "Azure"], soft: ["Kommunikation"] },
    workExperience: [{ title: "Supporttekniker", company: "Exempel AB", location: "Jönköping", summary: "Arbetade med support." }],
    education: [],
    certifications: ["AZ-900"],
    languages: [{ name: "Svenska", level: "Professionell" }],
    projects: [{ title: "Internal ticketing tool", description: "Built a support ticketing tool." }],
    yearsOfExperience: 3,
    careerGoals: [],
    summary: "Erfaren supporttekniker.",
    updatedAt: timestamp,
  };
}

function application(): ApplicationRecord {
  const job: NormalizedJob = normalizeJob({
    id: "job-a",
    title: "IT Support",
    source: "jobtech",
    sourceId: "source-a",
    company: "Exempel AB",
    location: "Jönköping",
    url: "https://example.test/job-a",
    applyUrl: "https://example.test/apply-a",
    description: "Kubernetes is required. Microsoft 365 is useful.",
    skills: ["Kubernetes", "Microsoft 365"],
    remote: "onsite",
    employmentType: "full-time",
    seniority: "mid",
  });
  const created = createApplication({ id: applicationId, rankedJob: analyzeJobs(profile(), [job]).rankedJobs[0], createdAt: timestamp });
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function baseCvRepository(result?: Awaited<ReturnType<CandidateBaseCvRepository["getByCandidateId"]>>): CandidateBaseCvRepository {
  const fallback = (() => {
    const created = createCandidateBaseCvFromProfile(candidateId, profile(), timestamp);
    if (!created.ok) throw new Error(created.error.message);
    return { ok: true, value: created.value } as const;
  })();
  return {
    async save(value) { return { ok: true, value }; },
    async getByCandidateId() { return result ?? fallback; },
  };
}

function stores(options: { baseCvResult?: Awaited<ReturnType<CandidateBaseCvRepository["getByCandidateId"]>> } = {}) {
  const app = application();
  const documents: ApplicationDocumentRecord[] = [];
  const applicationRepository: ApplicationRepository = {
    async create(value) { return { ok: true, value }; },
    async save(value) { return { ok: true, value }; },
    async getById() { return { ok: true, value: app }; },
    async list() { return { ok: true, value: [app] }; },
    async remove() { throw new Error("not used"); },
  };
  const associationRepository: CandidateApplicationAssociationRepository = {
    async create(value) { return { ok: true, value }; },
    async getByApplicationId() { return { ok: true, value: { candidateId, applicationId, createdAt: timestamp } }; },
    async listByCandidateId() { return { ok: true, value: [] }; },
    async deleteByApplicationId() { throw new Error("not used"); },
  };
  const candidateRepository: CoachWorkspaceRepository = {
    async createCandidate() { throw new Error("not used"); },
    async getCandidateById() { return { ok: true, value: { id: candidateId, displayName: "Candidate A", createdAt: timestamp, updatedAt: timestamp } }; },
    async listCandidates() { return { ok: true, value: [] }; },
  };
  const profileRepository: CandidateProfileRepository = {
    async saveProfile() { throw new Error("not used"); },
    async getProfileByCandidateId() { return { ok: true, value: { candidateId, profile: profile() } }; },
    async listProfiles() { return { ok: true, value: [] }; },
  };
  const documentRepository: ApplicationDocumentRepository = {
    async create(value) { documents.push(value); return { ok: true, value }; },
    async getById() { throw new Error("not used"); },
    async listByApplication() { return { ok: true, value: documents }; },
    async listVersions() { return { ok: true, value: documents }; },
    async getLatest() { throw new Error("not used"); },
    async deleteByApplication() { throw new Error("not used"); },
  };
  return { applicationRepository, associationRepository, candidateRepository, profileRepository, baseCvRepository: baseCvRepository(options.baseCvResult), documentRepository, documents };
}

const ENV_KEYS = ["AI_DOCUMENTS_ENABLED", "AI_REMOTE_GENERATION_CONSENT", "OPENAI_API_KEY", "OPENAI_MODEL"] as const;
let savedEnv: Record<string, string | undefined> = {};
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function enableAiEnv() {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.AI_DOCUMENTS_ENABLED = "true";
  process.env.AI_REMOTE_GENERATION_CONSENT = "true";
  process.env.OPENAI_API_KEY = "test-secret-key";
  process.env.OPENAI_MODEL = "synthetic-test-model";
}

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
async function withFetch(handler: FetchMock, work: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  try { await work(); } finally { globalThis.fetch = original; }
}

function requestFromInit(init?: RequestInit): DocumentGenerationRequest {
  const body = JSON.parse(String(init?.body));
  return JSON.parse(body.input[0].content[0].text).generationRequest;
}
function completedResponse(proposal: GeneratedDocumentProposal): Response {
  return new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(proposal) }] }] }), { status: 200 });
}
function incompleteResponse(): Response {
  return new Response(JSON.stringify({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: '{"applicationId":"tru' }] }] }), { status: 200 });
}

/** A fake AI writer that echoes real selected evidence verbatim - a faithful, non-fabricating "success" case for tests. */
function echoAiFetch(sectionsFor: (request: DocumentGenerationRequest) => GeneratedDocumentProposal["sections"]): FetchMock {
  return async (_input, init) => {
    const request = requestFromInit(init);
    return completedResponse({ applicationId: request.applicationId, type: request.type, language: request.language, sections: sectionsFor(request) });
  };
}
function cvSections(request: DocumentGenerationRequest): GeneratedDocumentProposal["sections"] {
  const identity = request.selectedEvidence.filter((e) => e.kind === "identity");
  const skills = request.selectedEvidence.filter((e) => e.kind === "skill");
  const sections: GeneratedDocumentProposal["sections"] = [];
  if (identity.length) sections.push({ id: "identity", kind: "identity", claims: identity.map((e) => ({ id: `c:${e.id}`, kind: "candidateFact", provenance: "verbatim", text: e.content, evidenceIds: [e.id] })) });
  if (skills.length) sections.push({ id: "professional:technicalSkills", kind: "skill", claims: skills.map((e) => ({ id: `s:${e.id}`, kind: "candidateFact", provenance: "verbatim", text: e.content, evidenceIds: [e.id] })) });
  return sections;
}
function letterSections(request: DocumentGenerationRequest): GeneratedDocumentProposal["sections"] {
  const experience = request.selectedEvidence.find((e) => e.kind === "experience");
  const claims: GeneratedDocumentProposal["sections"][number]["claims"] = [{ id: "open", kind: "neutralContext", provenance: "neutral", text: "Dear Hiring Manager,", evidenceIds: [] }];
  if (experience) claims.push({ id: "body", kind: "candidateFact", provenance: "verbatim", text: experience.content, evidenceIds: [experience.id] });
  return [{ id: "professional:letter", kind: "context", claims }];
}

describe("Professional Writer - production path (createTailoredCv / createCoverLetter)", () => {
  it("A: AI enabled + valid provider - Create CV uses the Professional Writer", async () => {
    enableAiEnv();
    const store = stores();
    await withFetch(echoAiFetch(cvSections), async () => {
      const result = await createTailoredCv({ applicationId }, { ...store, createId: () => "cv-ai", now: () => timestamp });
      expect(result).toMatchObject({ ok: true, generatorUsed: "ai" });
      if (result.ok) expect(result.fallbackReason).toBeUndefined();
    });
  });

  it("B: AI enabled + valid provider - Create Cover Letter uses the Professional Writer", async () => {
    enableAiEnv();
    const store = stores();
    await withFetch(echoAiFetch(letterSections), async () => {
      const result = await createCoverLetter({ applicationId }, { ...store, createId: () => "letter-ai", now: () => timestamp });
      expect(result).toMatchObject({ ok: true, generatorUsed: "ai" });
      if (result.ok) expect(result.fallbackReason).toBeUndefined();
    });
  });

  it("C: AI disabled - deterministic CV still works", async () => {
    const store = stores();
    const result = await createTailoredCv({ applicationId }, { ...store, createId: () => "cv-det", now: () => timestamp });
    expect(result).toMatchObject({ ok: true, generatorUsed: "deterministic" });
    if (result.ok) {
      expect(result.fallbackReason).toBeUndefined();
      expect(result.document.renderedDocument.content).toContain("Microsoft 365");
    }
  });

  it("D: AI disabled - deterministic cover letter still works", async () => {
    const store = stores();
    const result = await createCoverLetter({ applicationId }, { ...store, createId: () => "letter-det", now: () => timestamp });
    expect(result).toMatchObject({ ok: true, generatorUsed: "deterministic" });
    if (result.ok) {
      expect(result.fallbackReason).toBeUndefined();
      expect(result.document.renderedDocument.content).toContain("Microsoft 365");
    }
  });

  it("E: provider failure (network error) - deterministic fallback works and is recorded", async () => {
    enableAiEnv();
    const store = stores();
    await withFetch(async () => { throw new Error("network down"); }, async () => {
      const result = await createTailoredCv({ applicationId }, { ...store, createId: () => "cv-fallback", now: () => timestamp });
      expect(result).toMatchObject({ ok: true, generatorUsed: "deterministic", fallbackReason: { stage: "generation", code: "UNAVAILABLE" } });
      if (result.ok) expect(result.document.renderedDocument.content).toContain("Microsoft 365");
    });
  });

  it("F: incomplete/max-token AI response - truncated content is never persisted, deterministic fallback runs", async () => {
    enableAiEnv();
    const store = stores();
    await withFetch(async () => incompleteResponse(), async () => {
      const result = await createTailoredCv({ applicationId }, { ...store, createId: () => "cv-truncated", now: () => timestamp });
      expect(result).toMatchObject({ ok: true, generatorUsed: "deterministic", fallbackReason: { stage: "generation", code: "MALFORMED_RESPONSE" } });
      if (result.ok) {
        expect(result.document.renderedDocument.content).not.toContain("tru");
        expect(result.document.renderedDocument.content).toContain("Microsoft 365");
      }
    });
  });

  it("G: validation rejection (fabricated evidence) - invalid AI content is never persisted, deterministic fallback runs", async () => {
    enableAiEnv();
    const store = stores();
    await withFetch(echoAiFetch(() => [{
      id: "s", kind: "skill",
      claims: [{ id: "fab", kind: "candidateFact", provenance: "verbatim", text: "SAP", evidenceIds: ["fabricated:not-in-evidence"] }],
    }]), async () => {
      const result = await createTailoredCv({ applicationId }, { ...store, createId: () => "cv-rejected", now: () => timestamp });
      expect(result).toMatchObject({ ok: true, generatorUsed: "deterministic", fallbackReason: { stage: "generation", code: "UNAPPROVED_EVIDENCE_REFERENCE" } });
      if (result.ok) expect(result.document.renderedDocument.content).not.toContain("SAP");
    });
  });

  it("H: Base CV edited employer - both AI CV and AI cover letter use the edited value, never the raw profile's", async () => {
    enableAiEnv();
    const base = createCandidateBaseCvFromProfile(candidateId, profile(), timestamp);
    if (!base.ok) throw new Error("fixture");
    base.value.workExperience = [{ ...base.value.workExperience[0], company: "Base CV Edited Employer AB" }];
    const store = stores({ baseCvResult: { ok: true, value: base.value } });

    await withFetch(echoAiFetch(letterSections), async () => {
      const letter = await createCoverLetter({ applicationId }, { ...store, createId: () => "letter-edited", now: () => timestamp });
      expect(letter.ok).toBe(true);
      if (letter.ok) expect(letter.document.renderedDocument.content).toContain("Base CV Edited Employer AB");
    });
    await withFetch(echoAiFetch((request) => {
      const experience = request.selectedEvidence.filter((e) => e.kind === "experience");
      return [{ id: "e", kind: "experience", claims: experience.map((e) => ({ id: `c:${e.id}`, kind: "candidateFact" as const, provenance: "verbatim" as const, text: e.content, evidenceIds: [e.id] })) }];
    }), async () => {
      const cv = await createTailoredCv({ applicationId }, { ...store, createId: () => "cv-edited", now: () => timestamp });
      expect(cv.ok).toBe(true);
      if (cv.ok) expect(cv.document.renderedDocument.content).toContain("Base CV Edited Employer AB");
    });
  });

  it("I: Base CV hidden section - hidden evidence is never sent to the AI provider by either document", async () => {
    enableAiEnv();
    const base = createCandidateBaseCvFromProfile(candidateId, profile(), timestamp);
    if (!base.ok) throw new Error("fixture");
    base.value.visibility.projects = false;
    base.value.visibility.certifications = false;
    const store = stores({ baseCvResult: { ok: true, value: base.value } });

    let capturedForCv: DocumentGenerationRequest | undefined;
    let capturedForLetter: DocumentGenerationRequest | undefined;
    await withFetch(async (_input, init) => { capturedForCv = requestFromInit(init); return completedResponse({ applicationId: capturedForCv.applicationId, type: capturedForCv.type, language: capturedForCv.language, sections: [] }); }, async () => {
      await createTailoredCv({ applicationId }, { ...store, createId: () => "cv-hidden", now: () => timestamp });
    });
    await withFetch(async (_input, init) => { capturedForLetter = requestFromInit(init); return completedResponse({ applicationId: capturedForLetter.applicationId, type: capturedForLetter.type, language: capturedForLetter.language, sections: [{ id: "professional:letter", kind: "context", claims: [] }] }); }, async () => {
      await createCoverLetter({ applicationId }, { ...store, createId: () => "letter-hidden", now: () => timestamp });
    });

    for (const captured of [capturedForCv, capturedForLetter]) {
      expect(captured).toBeDefined();
      const contents = captured!.selectedEvidence.map((e) => e.content);
      expect(contents).not.toContain("Internal ticketing tool");
      expect(contents).not.toContain("AZ-900");
    }
  });

  it("J: Swedish explicit selection produces Swedish output through the AI path", async () => {
    enableAiEnv();
    const store = stores();
    await withFetch(echoAiFetch(letterSections), async () => {
      const result = await createCoverLetter({ applicationId, language: "sv" }, { ...store, createId: () => "letter-sv", now: () => timestamp });
      expect(result).toMatchObject({ ok: true, document: { language: "sv" } });
    });
  });

  it("K: English explicit selection produces English output through the AI path", async () => {
    enableAiEnv();
    const store = stores();
    await withFetch(echoAiFetch(letterSections), async () => {
      const result = await createCoverLetter({ applicationId, language: "en" }, { ...store, createId: () => "letter-en", now: () => timestamp });
      expect(result).toMatchObject({ ok: true, document: { language: "en" } });
    });
  });

  it("L: a CV-style malformed cover letter from the AI is rejected by V2.1 structural validation, and deterministic fallback runs", async () => {
    enableAiEnv();
    const store = stores();
    await withFetch(echoAiFetch((request) => {
      const experience = request.selectedEvidence.find((e) => e.kind === "experience")!;
      return [
        { id: "motivation", kind: "motivation", claims: [{ id: "m", kind: "neutralContext", provenance: "neutral", text: "Motivated.", evidenceIds: [] }] },
        { id: "experience", kind: "experience", claims: [{ id: "e", kind: "candidateFact", provenance: "verbatim", text: experience.content, evidenceIds: [experience.id] }] },
      ];
    }), async () => {
      const result = await createCoverLetter({ applicationId }, { ...store, createId: () => "letter-malformed", now: () => timestamp });
      expect(result).toMatchObject({ ok: true, generatorUsed: "deterministic", fallbackReason: { stage: "generation", code: "INVALID_COVER_LETTER_STRUCTURE" } });
    });
  });

  it("M: document versioning/persistence still works with the AI path active", async () => {
    enableAiEnv();
    const store = stores();
    await withFetch(echoAiFetch(cvSections), async () => {
      const first = await createTailoredCv({ applicationId }, { ...store, createId: () => "cv-v1", now: () => timestamp });
      const second = await createTailoredCv({ applicationId }, { ...store, createId: () => "cv-v2", now: () => "2026-09-06T11:00:00.000Z" });
      expect(first).toMatchObject({ ok: true, document: { version: 1 } });
      expect(second).toMatchObject({ ok: true, document: { version: 2 } });
      expect(store.documents.map((d) => d.version)).toEqual([1, 2]);
    });
  });

  it("N: evidence IDs and provenance survive persistence through the AI path", async () => {
    enableAiEnv();
    const store = stores();
    await withFetch(echoAiFetch(cvSections), async () => {
      const result = await createTailoredCv({ applicationId }, { ...store, createId: () => "cv-provenance", now: () => timestamp });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const claims = result.document.generatedDocument.sections.flatMap((s) => s.claims);
      expect(claims.length).toBeGreaterThan(0);
      for (const claim of claims) {
        expect(claim.evidenceIds.length).toBeGreaterThan(0);
        expect(claim.provenance).toBe("verbatim");
      }
      expect(claims.flatMap((c) => c.evidenceIds)).toContain("profile:technical-skill:0");
    });
  });
});
