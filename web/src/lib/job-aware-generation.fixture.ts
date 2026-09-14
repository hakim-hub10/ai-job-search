import { analyzeJobs, createApplication, normalizeJob, generateApplicationDocument } from "../../../.agents/job-search/cli/src/index";
import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import type { NormalizedJob } from "../../../.agents/job-search/cli/src/index";
import type { ApplicationDocumentRecord } from "../../../.agents/job-search/cli/src/application-document-repository";
import { documentQualityProfile, professionalDocumentGenerator } from "./professional-documents";

/**
 * Synthetic candidate for job-awareness testing: an IT-support/cloud role
 * plus a logistics/coordination role with genuinely transferable evidence -
 * no real user data. Both work-experience descriptions carry multiple
 * distinct verified claims so tests can prove selection changes with the
 * target job rather than always rendering everything.
 */
export function jobAwareProfile(): CandidateProfile {
  return {
    headline: "IT-supporttekniker",
    targetRoles: ["IT-support", "Cloud Engineer"],
    locationPreferences: ["Göteborg"],
    workMode: "hybrid",
    remotePreference: true,
    preferredIndustries: ["IT"],
    preferredEmploymentType: ["full-time"],
    yearsOfExperience: 3,
    careerGoals: ["Fördjupa kunskaper inom cybersäkerhet"],
    skills: {
      technical: ["Microsoft 365", "Active Directory", "Windows 10/11", "ServiceNow", "Azure", "AWS", "Terraform", "Kubernetes", "Nätverk", "Linux"],
      soft: ["Problemlösning", "Kommunikation", "Serviceinriktad", "Samarbete"],
    },
    certifications: ["Microsoft Azure Administrator Associate – AZ-104", "Microsoft Azure Fundamentals – AZ-900"],
    languages: [{ name: "Svenska", level: "Flytande" }, { name: "Engelska", level: "Flytande" }],
    workExperience: [
      {
        title: "Cloud Engineer / IT-support",
        company: "Nordvik IT Solutions AB",
        location: "Göteborg",
        startDate: "2025",
        endDate: "2026",
        summary: "Arbetade med IT-support, användarstöd, felsökning och drift av tekniska miljöer inom Microsoft 365, Azure och AWS. Hanterade tekniska incidenter och gav fjärrsupport till användare via Teams och ärendehanteringssystem. Arbetade med dokumentation, åtkomstkontroll i Active Directory och övervakning av säkerhetshändelser. Deltog i automatisering av infrastruktur med Terraform och Kubernetes. Ansvarade för nätverkskonfiguration och Linux-servrar i molnmiljön. Höll interna utbildningar i kundbemötande och service för nya supportkollegor.",
      },
      {
        title: "Lagmedarbetare / Driftledare",
        company: "Storelogik Lager AB",
        location: "Jönköping",
        startDate: "2022",
        endDate: undefined,
        summary: "Arbetar i en operativ logistikmiljö med ansvar för att koordinera det dagliga arbetet och prioritera uppgifter. Stöttar kollegor, hanterar operativa problem och kommunicerar mellan medarbetare och ansvariga funktioner. Rollen har utvecklat förmåga inom problemlösning, service, kommunikation och samarbete under tidspress.",
      },
    ],
    education: [{ degree: "Yrkeshögskoleexamen", field: "IT- och cybersäkerhetstekniker", institution: "Chas Academy", startYear: 2025, endYear: 2027 }],
    summary: undefined,
    updatedAt: "2026-09-13T10:00:00Z",
  };
}

export function itSupportJob(): NormalizedJob {
  return normalizeJob({
    id: "job-aware-it-support",
    source: "platsbanken",
    title: "IT-support, 1st line",
    company: "Fictional Support Partners AB",
    location: "Göteborg",
    remote: "onsite",
    employmentType: "part-time",
    seniority: "entry",
    category: "IT",
    skills: ["Windows", "Active Directory", "Microsoft 365"],
    description: "Som 1st line supporttekniker hanterar du inkommande supportärenden via telefon och e-post samt ärendehanteringssystem. Du ger teknisk support till användare i Windows- och Mac-miljöer, kontohantering i Active Directory, support i Microsoft 365 och grundläggande stöd kring Azure eller andra molntjänster. Vi ser gärna att du är serviceinriktad, kommunikativ och trivs med att felsöka tekniska problem. Dokumentation av lösningar i ärendehanteringssystemet ingår i rollen. Du har god förmåga till kundbemötande och ger alltid service av hög kvalitet till användare.",
  });
}

export function cloudEngineerJob(): NormalizedJob {
  return normalizeJob({
    id: "job-aware-cloud",
    source: "platsbanken",
    title: "Cloud Engineer",
    company: "Fictional Cloud Systems AB",
    location: "Göteborg",
    remote: "hybrid",
    employmentType: "full-time",
    seniority: "mid",
    category: "IT",
    skills: ["Azure", "AWS", "Terraform", "Kubernetes"],
    description: "Vi söker en Cloud Engineer med erfarenhet av AWS, Azure, Terraform och Kubernetes. Du kommer att arbeta med automatisering av infrastruktur, nätverkskonfiguration och Linux-servrar i molnmiljön samt övervakning av säkerhetshändelser. Erfarenhet av containerplattformar är meriterande.",
  });
}

export async function generateJobAwareCv(job: NormalizedJob, language: "sv" | "en") {
  const profile = jobAwareProfile();
  const application = createApplication({ id: `job-aware-${job.id}`, rankedJob: analyzeJobs(profile, [job]).rankedJobs[0], createdAt: "2026-09-13T10:00:00Z" });
  if (!application.ok) throw new Error("fixture application failed");
  const generated = await generateApplicationDocument({
    application: application.value,
    candidateDocumentInput: { matchingProfile: documentQualityProfile(profile), identity: { fullName: "Alex Testsson", email: "alex.testsson@example.test", phone: "070-000 00 00" } },
    tailoringOptions: { type: "cv", language, maxEvidenceItems: 200 },
    generationOptions: { untrustedJobDescription: job.description ?? undefined },
    generator: professionalDocumentGenerator,
  });
  if (!generated.ok) throw new Error(JSON.stringify(generated.error));
  const record = {
    id: `job-aware-document-${job.id}-${language}`,
    applicationId: application.value.id,
    documentType: "cv",
    language,
    version: 1,
    createdAt: "2026-09-13T10:00:00Z",
    generatedDocument: generated.value.document,
    renderedDocument: generated.value.renderedDocument,
  } as ApplicationDocumentRecord;
  return { record, generated: generated.value, profile, application: application.value };
}

export async function generateJobAwareCoverLetter(job: NormalizedJob, language: "sv" | "en") {
  const profile = jobAwareProfile();
  const application = createApplication({ id: `job-aware-letter-${job.id}`, rankedJob: analyzeJobs(profile, [job]).rankedJobs[0], createdAt: "2026-09-13T10:00:00Z" });
  if (!application.ok) throw new Error("fixture application failed");
  const generated = await generateApplicationDocument({
    application: application.value,
    candidateDocumentInput: { matchingProfile: documentQualityProfile(profile), identity: { fullName: "Alex Testsson", email: "alex.testsson@example.test", phone: "070-000 00 00" } },
    tailoringOptions: { type: "coverLetter", language, maxEvidenceItems: 200 },
    generationOptions: { untrustedJobDescription: job.description ?? undefined },
    generator: professionalDocumentGenerator,
  });
  if (!generated.ok) throw new Error(JSON.stringify(generated.error));
  return { generated: generated.value, profile };
}
