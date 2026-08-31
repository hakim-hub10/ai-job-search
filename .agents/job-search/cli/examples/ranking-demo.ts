import {
  createDefaultCandidateProfile,
  normalizeCandidateProfile,
  normalizeJob,
  matchProfile,
  scoreMatch,
  analyzeSkillGaps,
  rankJobs,
  getRankingSummary,
  formatRankedJob,
  type RankingInput,
} from "../src/index"

console.log("\n=== JOB RANKING ENGINE DEMONSTRATION ===\n")

// Example 1: IT Professional
console.log("--- SCENARIO 1: Software Engineer ---\n")

const itCandidate = normalizeCandidateProfile({
  headline: "Full-Stack Engineer with 3 years experience",
  targetRoles: ["Full-Stack Engineer", "Backend Engineer"],
  skills: {
    technical: ["TypeScript", "React", "Node.js", "PostgreSQL", "Docker"],
    soft: ["Communication", "Problem solving", "Teamwork"],
  },
  workExperience: [
    {
      title: "Full-Stack Developer",
      company: "TechStartup",
      location: "Stockholm, Sweden",
      summary: "Built web applications",
    },
  ],
  education: [
    {
      degree: "Bachelor's degree",
      field: "Computer Science",
      institution: "University",
    },
  ],
  languages: [{ name: "English", level: "Fluent" }],
  yearsOfExperience: 3,
  locationPreferences: ["Stockholm", "Remote"],
  workMode: "hybrid",
})

const itJobs = [
  normalizeJob({
    id: "it-1",
    source: "test",
    title: "Senior Backend Engineer",
    company: "ScaleTech",
    location: "Stockholm, Sweden",
    country: "Sweden",
    remote: "hybrid",
    employmentType: "full-time",
    seniority: "senior",
    skills: ["TypeScript", "Node.js", "PostgreSQL", "Redis"],
    category: "technology",
    url: "https://example.com/it-1",
  }),
  normalizeJob({
    id: "it-2",
    source: "test",
    title: "Platform Engineer",
    company: "CloudOps",
    location: "Copenhagen, Denmark",
    country: "Denmark",
    remote: "remote",
    employmentType: "full-time",
    seniority: "mid",
    skills: ["TypeScript", "Kubernetes", "AWS"],
    category: "technology",
    url: "https://example.com/it-2",
  }),
  normalizeJob({
    id: "it-3",
    source: "test",
    title: "React Developer",
    company: "UXStudio",
    location: "Remote",
    country: "Sweden",
    remote: "remote",
    employmentType: "full-time",
    seniority: "mid",
    skills: ["React", "TypeScript", "CSS"],
    category: "technology",
    url: "https://example.com/it-3",
  }),
]

function createRankingInput(job: any) {
  const matching = matchProfile(itCandidate, job)
  const scoring = scoreMatch(matching)
  const gaps = analyzeSkillGaps(itCandidate, job, matching)
  return { job, matchingResult: matching, scoringResult: scoring, skillGapResult: gaps }
}

const itInputs = itJobs.map(createRankingInput)
const itRanked = rankJobs(itInputs, itCandidate)
const itSummary = getRankingSummary(itRanked)

console.log(`Candidate: ${itCandidate.headline}`)
console.log(`Ranked ${itSummary.totalJobs} positions\n`)

for (const rankedJob of itRanked) {
  console.log(formatRankedJob(rankedJob))
  console.log("")
}

// Example 2: Healthcare Professional
console.log("\n--- SCENARIO 2: Healthcare Professional ---\n")

const healthcareCandidate = normalizeCandidateProfile({
  headline: "Registered Nurse with 7 years ICU experience",
  targetRoles: ["Registered Nurse", "Charge Nurse"],
  skills: {
    technical: ["Patient Care", "Electronic Health Records", "ICU Monitoring", "Medication Management"],
    soft: ["Empathy", "Communication", "Attention to detail", "Leadership"],
  },
  workExperience: [
    {
      title: "ICU Nurse",
      company: "Central Hospital",
      location: "Stockholm",
      summary: "Intensive care unit management",
    },
  ],
  education: [
    {
      degree: "Bachelor's degree",
      field: "Nursing",
      institution: "Karolinska Institute",
    },
  ],
  languages: [
    { name: "Swedish", level: "Native" },
    { name: "English", level: "Fluent" },
  ],
  yearsOfExperience: 7,
  locationPreferences: ["Stockholm", "Uppsala"],
  workMode: "onsite",
})

const healthcareJobs = [
  normalizeJob({
    id: "health-1",
    source: "test",
    title: "ICU Charge Nurse",
    company: "Stockholm Central Hospital",
    location: "Stockholm, Sweden",
    country: "Sweden",
    remote: "onsite",
    employmentType: "full-time",
    seniority: "senior",
    skills: ["Patient Care", "Leadership", "ICU Management", "EHR Systems"],
    category: "healthcare",
    description: "Lead ICU team with strong leadership and communication skills required",
    url: "https://example.com/health-1",
  }),
  normalizeJob({
    id: "health-2",
    source: "test",
    title: "Registered Nurse",
    company: "Private Clinic Uppsala",
    location: "Uppsala, Sweden",
    country: "Sweden",
    remote: "onsite",
    employmentType: "full-time",
    seniority: "mid",
    skills: ["Patient Care", "EHR Systems", "Communication"],
    category: "healthcare",
    url: "https://example.com/health-2",
  }),
  normalizeJob({
    id: "health-3",
    source: "test",
    title: "Medical Coordinator",
    company: "Health Service Provider",
    location: "Remote",
    country: "Sweden",
    remote: "remote",
    employmentType: "full-time",
    seniority: "mid",
    skills: ["Administrative", "Patient Communication", "Scheduling"],
    category: "healthcare",
    description: "Coordinate medical scheduling and patient services",
    url: "https://example.com/health-3",
  }),
]

const healthcareInputs = healthcareJobs.map((job) => {
  const matching = matchProfile(healthcareCandidate, job)
  const scoring = scoreMatch(matching)
  const gaps = analyzeSkillGaps(healthcareCandidate, job, matching)
  return { job, matchingResult: matching, scoringResult: scoring, skillGapResult: gaps }
})
const healthcareRanked = rankJobs(healthcareInputs, healthcareCandidate)
const healthcareSummary = getRankingSummary(healthcareRanked)

console.log(`Candidate: ${healthcareCandidate.headline}`)
console.log(`Ranked ${healthcareSummary.totalJobs} positions\n`)

for (const rankedJob of healthcareRanked) {
  console.log(formatRankedJob(rankedJob))
  console.log("")
}

// Example 3: Logistics/Operations Professional
console.log("\n--- SCENARIO 3: Logistics/Operations ---\n")

const logisticsCandidate = normalizeCandidateProfile({
  headline: "Supply Chain Manager with 6 years warehouse experience",
  targetRoles: ["Operations Manager", "Supply Chain Coordinator"],
  skills: {
    technical: ["Supply Chain Management", "Inventory Systems", "Excel", "SAP", "Warehouse Management"],
    soft: ["Leadership", "Problem solving", "Organization", "Attention to detail"],
  },
  workExperience: [
    {
      title: "Warehouse Manager",
      company: "Distribution Center Nordic",
      location: "Jönköping",
      summary: "Managed 50+ staff and daily warehouse operations",
    },
  ],
  education: [
    {
      degree: "Bachelor's degree",
      field: "Business Administration",
      institution: "University",
    },
  ],
  languages: [
    { name: "Swedish", level: "Native" },
    { name: "English", level: "Professional working proficiency" },
  ],
  yearsOfExperience: 6,
  locationPreferences: ["Jönköping", "Stockholm"],
  workMode: "onsite",
})

const logisticsJobs = [
  normalizeJob({
    id: "log-1",
    source: "test",
    title: "Operations Manager",
    company: "Logistics Nordic",
    location: "Jönköping, Sweden",
    country: "Sweden",
    remote: "onsite",
    employmentType: "full-time",
    seniority: "senior",
    skills: ["Operations Management", "Team Leadership", "Process Optimization", "SAP"],
    category: "logistics",
    description: "Lead warehouse operations team with focus on efficiency and safety",
    url: "https://example.com/log-1",
  }),
  normalizeJob({
    id: "log-2",
    source: "test",
    title: "Supply Chain Coordinator",
    company: "Transport Solutions",
    location: "Stockholm, Sweden",
    country: "Sweden",
    remote: "hybrid",
    employmentType: "full-time",
    seniority: "mid",
    skills: ["Supply Chain", "Inventory Management", "Excel", "Communication"],
    category: "logistics",
    url: "https://example.com/log-2",
  }),
  normalizeJob({
    id: "log-3",
    source: "test",
    title: "Warehouse Coordinator",
    company: "E-commerce Fulfillment",
    location: "Stockholm, Sweden",
    country: "Sweden",
    remote: "onsite",
    employmentType: "full-time",
    seniority: "junior",
    skills: ["Warehouse Management", "Inventory", "Systems"],
    category: "logistics",
    description: "Support warehouse operations and inventory management",
    url: "https://example.com/log-3",
  }),
]

const logisticsInputs = logisticsJobs.map((job) => {
  const matching = matchProfile(logisticsCandidate, job)
  const scoring = scoreMatch(matching)
  const gaps = analyzeSkillGaps(logisticsCandidate, job, matching)
  return { job, matchingResult: matching, scoringResult: scoring, skillGapResult: gaps }
})
const logisticsRanked = rankJobs(logisticsInputs, logisticsCandidate)
const logisticsSummary = getRankingSummary(logisticsRanked)

console.log(`Candidate: ${logisticsCandidate.headline}`)
console.log(`Ranked ${logisticsSummary.totalJobs} positions\n`)

for (const rankedJob of logisticsRanked) {
  console.log(formatRankedJob(rankedJob))
  console.log("")
}

// Summary statistics
console.log("\n=== RANKING STATISTICS ===\n")
console.log("IT Candidate:")
console.log(`  Total jobs: ${itSummary.totalJobs}`)
console.log(`  Average score: ${itSummary.averageScore}`)
console.log(`  Top score: ${itSummary.topScores[0] || "N/A"}`)

console.log("\nHealthcare Candidate:")
console.log(`  Total jobs: ${healthcareSummary.totalJobs}`)
console.log(`  Average score: ${healthcareSummary.averageScore}`)
console.log(`  Top score: ${healthcareSummary.topScores[0] || "N/A"}`)

console.log("\nLogistics Candidate:")
console.log(`  Total jobs: ${logisticsSummary.totalJobs}`)
console.log(`  Average score: ${logisticsSummary.averageScore}`)
console.log(`  Top score: ${logisticsSummary.topScores[0] || "N/A"}`)

console.log("\n=== RANKING COMPLETE ===\n")
