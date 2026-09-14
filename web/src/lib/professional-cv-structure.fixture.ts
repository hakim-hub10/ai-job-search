import { analyzeJobs, createApplication, normalizeJob, generateApplicationDocument } from "../../../.agents/job-search/cli/src/index";
import { createDefaultCandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import type { CandidateProfile } from "../../../.agents/job-search/cli/src/profile";
import type { NormalizedJob } from "../../../.agents/job-search/cli/src/index";
import type { ApplicationDocumentRecord } from "../../../.agents/job-search/cli/src/application-document-repository";
import { documentQualityProfile, professionalDocumentGenerator } from "./professional-documents";

/**
 * Synthetic candidate profile for manual CV structure/design review. No real
 * user data - every name, employer, school and credential below is
 * fictitious. Deliberately large (20 technical skills, 5 soft skills, 6
 * certifications, 4 projects, 3 languages, 3 experiences, 2 education
 * records) to exercise selection/grouping/omission at realistic scale.
 */
export function structureReviewProfile(): CandidateProfile {
  const profile: CandidateProfile = createDefaultCandidateProfile();
  profile.headline = "Senior Data Platform Engineer";
  profile.summary = "Data platform engineer with six years of experience designing reliable pipelines and analytics infrastructure for logistics and retail organizations. Specializes in cloud-native ETL, warehouse modeling, and turning operational data into decisions teams can act on. Recently led the migration of a legacy batch pipeline to a streaming architecture, cutting reporting latency from a day to minutes.";
  profile.targetRoles = ["Data Platform Engineer", "Data Engineer"];
  profile.locationPreferences = ["Stockholm", "Remote"];
  profile.workMode = "hybrid";
  profile.remotePreference = true;
  profile.preferredIndustries = ["Logistics", "Retail", "Technology"];
  profile.preferredEmploymentType = ["full-time"];
  profile.yearsOfExperience = 6;
  profile.careerGoals = ["Lead a data platform team", "Deepen streaming-architecture expertise"];
  profile.skills = {
    technical: [
      "SQL", "Python", "Apache Airflow", "Apache Kafka", "dbt", "Snowflake", "BigQuery",
      "Terraform", "Docker", "Kubernetes", "AWS", "GCP", "Power BI", "Looker",
      "Spark", "Data modeling", "ETL design", "CI/CD", "Git", "Data quality testing",
    ],
    soft: ["Communication", "Stakeholder management", "Mentoring", "Prioritization", "Cross-team collaboration"],
  };
  profile.certifications = [
    "AWS Certified Data Analytics – Specialty",
    "Google Cloud Professional Data Engineer",
    "dbt Analytics Engineering Certification",
    "Certified Kubernetes Administrator (CKA)",
    "PL-300: Power BI Data Analyst",
    "Snowflake SnowPro Core",
  ];
  profile.projects = [
    {
      title: "Real-time order analytics pipeline",
      description: "Built a Kafka-to-warehouse streaming pipeline that replaced a nightly batch job, cutting reporting latency to under five minutes.",
      technologies: ["Kafka", "Spark", "Snowflake"],
      url: "https://example.test/projects/order-analytics",
    },
    {
      title: "Self-service data quality dashboard",
      description: "Designed a dbt-based test suite and Looker dashboard so analysts could trace data quality issues to their source without engineering support.",
      technologies: ["dbt", "Looker", "SQL"],
    },
    {
      title: "Warehouse cost optimization",
      description: "Reworked partitioning and clustering across the largest tables, reducing monthly warehouse compute cost by roughly a third.",
      technologies: ["BigQuery", "SQL"],
    },
    {
      title: "Community data-literacy workshop series",
      description: "Organized a quarterly workshop series teaching non-technical staff how to read dashboards and ask better data questions.",
    },
  ];
  profile.languages = [
    { name: "English", level: "Professional working proficiency" },
    { name: "Swedish", level: "Native" },
    { name: "German", level: "Conversational" },
  ];
  profile.workExperience = [
    {
      title: "Senior Data Platform Engineer",
      company: "Northgate Logistics",
      location: "Stockholm",
      startDate: "2022",
      endDate: "2025",
      summary: "Led migration of a legacy batch reporting pipeline to a streaming architecture on Kafka and Snowflake, and mentored two junior engineers.",
    },
    {
      title: "Data Engineer",
      company: "Havenmark Retail",
      location: "Stockholm",
      startDate: "2019",
      endDate: "2022",
      summary: "Built and maintained Airflow-orchestrated ETL pipelines feeding the company's demand-forecasting models.",
    },
    {
      title: "Data Analyst",
      company: "Fjordline Analytics",
      location: "Gothenburg",
      startDate: "2017",
      endDate: "2019",
      summary: "Delivered weekly operational reporting in SQL and Power BI for the supply-chain planning team.",
    },
  ];
  profile.education = [
    { degree: "MSc", field: "Computer Science", institution: "Example Institute of Technology", startYear: 2015, endYear: 2017 },
    { degree: "BSc", field: "Information Systems", institution: "Example University", startYear: 2012, endYear: 2015 },
  ];
  return profile;
}

function strongRelevantJob(): NormalizedJob {
  return normalizeJob({
    id: "structure-review-strong",
    source: "freehire",
    title: "Senior Data Platform Engineer",
    company: "Fictional Freight Systems",
    location: "Stockholm",
    remote: "hybrid",
    employmentType: "full-time",
    seniority: "senior",
    category: "Technology",
    skills: ["SQL", "Python", "Apache Kafka", "Snowflake", "Terraform", "Kubernetes"],
    description: "Requirements: SQL, Python, and Apache Kafka. Snowflake and Terraform experience required. Kubernetes knowledge is a plus. Experience with data modeling and ETL design. Communication and stakeholder management required. English and Swedish required. AWS or Google Cloud Professional Data Engineer certification preferred.",
  });
}

function partiallyRelevantJob(): NormalizedJob {
  return normalizeJob({
    id: "structure-review-partial",
    source: "freehire",
    title: "Backend Software Engineer",
    company: "Fictional Ledger Systems",
    location: "Stockholm",
    remote: "onsite",
    employmentType: "full-time",
    seniority: "mid",
    category: "Technology",
    skills: ["Python", "Docker", "Distributed systems"],
    description: "Requirements: Python and Docker experience. Distributed systems knowledge required. Experience with CI/CD pipelines. Communication required. Public speaking is a plus. Certified Scrum Master preferred.",
  });
}

export function structureReviewJobs(): { strong: NormalizedJob; partial: NormalizedJob } {
  return { strong: strongRelevantJob(), partial: partiallyRelevantJob() };
}

export async function generateStructureReviewCv(
  job: NormalizedJob,
  language: "sv" | "en",
) {
  const profile = structureReviewProfile();
  const application = createApplication({ id: `structure-review-${job.id}`, rankedJob: analyzeJobs(profile, [job]).rankedJobs[0], createdAt: "2026-09-13T10:00:00Z" });
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
    id: `structure-review-document-${job.id}-${language}`,
    applicationId: application.value.id,
    documentType: "cv",
    language,
    version: 1,
    createdAt: "2026-09-13T10:00:00Z",
    generatedDocument: generated.value.document,
    renderedDocument: generated.value.renderedDocument,
  } as ApplicationDocumentRecord;
  return { record, generated: generated.value, profile };
}
