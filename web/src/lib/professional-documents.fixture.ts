import { analyzeJobs, createApplication, normalizeJob, generateApplicationDocument } from "../../../.agents/job-search/cli/src/index";
import { createDefaultCandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import type { ApplicationDocumentRecord } from "../../../.agents/job-search/cli/src/application-document-repository";
import { documentQualityProfile, professionalDocumentGenerator } from "./professional-documents";
export function professionalFixture() {
  const profile = createDefaultCandidateProfile();
  profile.headline = "Operations Analyst"; delete profile.summary;
  profile.targetRoles = ["Operations Analyst"]; profile.locationPreferences = ["Stockholm"];
  profile.skills = { technical: ["SQL", "Excel", "Python", "Power BI", "Forecasting", "Budgeting", "Procurement", "Risk assessment", "Data visualization", "Scheduling", "Process mapping", "Inventory management", "Quality assurance", "Research", "Documentation", "M365", "Office 365", "IT-", "Responsible for supporting all local teams and reviewing their daily reports"], soft: ["Communication", "Collaboration", "Problem solving"] };
  profile.certifications = ["Lean Six Sigma Yellow Belt", "PRINCE2 Foundation", "PL-300", "AZ-900", "ITIL Foundation"];
  profile.languages = [{ name: "English", level: "Professional" }, { name: "Swedish", level: "Professional" }, { name: "German", level: "Intermediate" }];
  profile.workExperience = [
    { title: "Operations Analyst", company: "Example Logistics", location: "Stockholm", startDate: "2022", endDate: "2025", summary: "Prepared SQL reports and Excel forecasts for inventory planning." },
    { title: "Planning Coordinator", company: "Example Retail", location: "Stockholm", startDate: "2020", endDate: "2022", summary: "Coordinated schedules and documented purchasing processes." },
    { title: "Research Assistant", company: "Example Institute", location: "Uppsala", startDate: "2018", endDate: "2020", summary: "Compiled research datasets and checked source references." },
  ];
  profile.education = [{ degree: "BSc", field: "Economics", institution: "Example University", startYear: 2015, endYear: 2018 }, { degree: "Diploma", field: "Data analysis", institution: "Example College", startYear: 2021, endYear: 2022 }];
  const job = normalizeJob({ id: "quality-rich", source: "freehire", title: "Operations Analyst", company: "Research & Planning", location: "Stockholm", remote: "hybrid", employmentType: "full-time", seniority: "mid", category: "Technology", skills: ["SQL", "Excel", "Python", "Power BI"], description: "Requirements: SQL, Excel and Python. Power BI is required. Experience in operations analysis and communication. English and Swedish required. PL-300 certification preferred. Kubernetes is required." });
  return { profile, job };
}
export async function generateProfessionalFixture(type: "cv" | "coverLetter", language: "sv" | "en") {
  const { profile, job } = professionalFixture();
  const application = createApplication({ id: "quality-application", rankedJob: analyzeJobs(profile, [job]).rankedJobs[0], createdAt: "2026-09-12T10:00:00Z" });
  if (!application.ok) throw new Error("fixture application failed");
  const generated = await generateApplicationDocument({ application: application.value, candidateDocumentInput: { matchingProfile: documentQualityProfile(profile), identity: { fullName: "Alex Example" } }, tailoringOptions: { type, language, maxEvidenceItems: 200 }, generationOptions: { untrustedJobDescription: job.description ?? undefined }, generator: professionalDocumentGenerator });
  if (!generated.ok) throw new Error(JSON.stringify(generated.error));
  const record = { id: "quality-document", applicationId: application.value.id, documentType: type, language, version: 1, createdAt: "2026-09-12T10:00:00Z", generatedDocument: generated.value.document, renderedDocument: generated.value.renderedDocument } as ApplicationDocumentRecord;
  return { record, generated: generated.value, profile };
}
