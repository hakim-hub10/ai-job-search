import {
  createDefaultCandidateProfile,
  normalizeCandidateProfile,
  matchProfile,
  normalizeJob,
  type MatchingResult,
} from "../src/index"

// Create a real-world example: candidate profile and two jobs
const candidate = createDefaultCandidateProfile()

// Example 1: A strong match job
const strongMatchJob = normalizeJob({
  id: "job-strong-1",
  source: "linkedin",
  sourceId: "linkedin-job-12345",
  title: "Platform Engineer",
  company: "TechCorp AB",
  location: "Jönköping, Sweden",
  country: "Sweden",
  url: "https://linkedin.com/jobs/view/12345",
  applyUrl: "https://linkedin.com/jobs/view/12345/apply",
  date: "2026-08-29",
  employmentType: "full-time",
  remote: "hybrid",
  description: `
    We're looking for a Platform Engineer to join our growing team. You will:
    - Build and maintain robust platform infrastructure using TypeScript and modern tools
    - Collaborate with product and engineering teams to design scalable solutions
    - Take ownership of critical systems and drive improvements end-to-end
    - Communicate effectively with cross-functional stakeholders
    
    Required: TypeScript, API design, problem-solving mindset, strong communication skills.
    Nice-to-have: Bun runtime experience, SQL, Linux.
  `,
  salary: "600,000 - 700,000 SEK",
  skills: ["TypeScript", "APIs", "Problem Solving", "Communication"],
  seniority: "mid",
  category: "technology",
})

// Example 2: A job with skill gaps
const skillGapJob = normalizeJob({
  id: "job-gap-1",
  source: "jobindex",
  sourceId: "jobindex-job-99999",
  title: "Senior DevOps Engineer",
  company: "CloudOps Inc",
  location: "Stockholm, Sweden",
  country: "Sweden",
  url: "https://jobindex.dk/jobs/99999",
  applyUrl: "https://jobindex.dk/jobs/99999/apply",
  date: "2026-08-28",
  employmentType: "full-time",
  remote: "onsite",
  description: `
    Senior DevOps Engineer with 7+ years of experience managing large-scale infrastructure.
    Expertise in Kubernetes, Terraform, AWS, and container orchestration required.
    Must have leadership experience mentoring junior team members.
  `,
  salary: null,
  skills: ["Kubernetes", "Terraform", "AWS", "Docker", "CI/CD"],
  seniority: "senior",
  category: "infrastructure",
})

// Perform matching
const strongMatchResult = matchProfile(candidate, strongMatchJob)
const skillGapResult = matchProfile(candidate, skillGapJob)

// Display results
console.log("\n=== PHASE 2.2 MATCHING ENGINE EXAMPLE ===\n")

console.log("CANDIDATE PROFILE:")
console.log(`  Headline: ${candidate.headline}`)
console.log(`  Target Roles: ${candidate.targetRoles.join(", ")}`)
console.log(`  Location: ${candidate.locationPreferences.join(", ")}`)
console.log(`  Technical Skills: ${candidate.skills.technical.join(", ")}`)
console.log(`  Years of Experience: ${candidate.yearsOfExperience}`)
console.log()

// Display strong match
displayMatchResult("EXAMPLE 1: Strong Match", strongMatchResult)

// Display skill gap
displayMatchResult("EXAMPLE 2: Skill Gap", skillGapResult)

function displayMatchResult(title: string, result: MatchingResult) {
  console.log(`${title}`)
  console.log(`Job: "${result.jobTitle}" at ${result.jobId}`)
  console.log(``)

  console.log(`SUMMARY:`)
  console.log(`  Matched: ${result.totalMatched} | Missing: ${result.totalMissing} | Conflicting: ${result.totalConflicting} | Unknown: ${result.totalUnknown}`)
  console.log()

  if (result.matched.length > 0) {
    console.log("✓ MATCHED CRITERIA:")
    result.matched.forEach((m) => {
      console.log(`  • ${m.dimension}: ${m.detail}`)
    })
    console.log()
  }

  if (result.missing.length > 0) {
    console.log("✗ MISSING CRITERIA:")
    result.missing.forEach((m) => {
      console.log(`  • ${m.dimension}: ${m.detail}`)
    })
    console.log()
  }

  if (result.conflicting.length > 0) {
    console.log("⚠ CONFLICTING CRITERIA:")
    result.conflicting.forEach((c) => {
      console.log(`  • ${c.dimension}: ${c.detail}`)
    })
    console.log()
  }

  if (result.unknown.length > 0) {
    console.log("? UNKNOWN/NOT AVAILABLE:")
    result.unknown.forEach((u) => {
      console.log(`  • ${u.dimension}: ${u.detail}`)
    })
    console.log()
  }

  console.log("---\n")
}
