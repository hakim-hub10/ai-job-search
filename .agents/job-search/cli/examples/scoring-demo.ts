import {
  createDefaultCandidateProfile,
  matchProfile,
  normalizeJob,
  scoreMatch,
  describeScoreBreakdown,
} from "../src/index"

// Create a candidate profile
const candidate = createDefaultCandidateProfile()

// Example 1: Strong Match job (from Phase 2.2)
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

// Example 2: Weak Match job (from Phase 2.2)
const weakMatchJob = normalizeJob({
  id: "job-weak-1",
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

// Score both matches
const strongMatching = matchProfile(candidate, strongMatchJob)
const strongScoring = scoreMatch(strongMatching)

const weakMatching = matchProfile(candidate, weakMatchJob)
const weakScoring = scoreMatch(weakMatching)

// Display results
console.log("\n=== PHASE 2.3 MATCH SCORING EXAMPLES ===\n")

console.log("CANDIDATE PROFILE:")
console.log(`  Headline: ${candidate.headline}`)
console.log(`  Target Roles: ${candidate.targetRoles.join(", ")}`)
console.log(`  Years of Experience: ${candidate.yearsOfExperience}`)
console.log()

// Display strong match scoring
console.log("=" + "=".repeat(70))
console.log("EXAMPLE 1: STRONG MATCH — Platform Engineer at TechCorp AB")
console.log("=" + "=".repeat(70))
console.log()
console.log(`MATCHING RESULT:`)
console.log(`  Matched: ${strongMatching.totalMatched}`)
console.log(`  Missing: ${strongMatching.totalMissing}`)
console.log(`  Conflicting: ${strongMatching.totalConflicting}`)
console.log(`  Unknown: ${strongMatching.totalUnknown}`)
console.log()
console.log(`SCORE RESULT:`)
console.log(`  Score: ${strongScoring.score}/100`)
console.log(`  Summary: ${strongScoring.summary}`)
console.log()
console.log(`BREAKDOWN:`)
console.log(`  Known dimensions: ${strongScoring.breakdown.knownDimensions}/10`)
console.log(`  Unknown dimensions: ${strongScoring.breakdown.unknownDimensions}`)
console.log(`  Total possible points: ${strongScoring.breakdown.totalPoints.toFixed(1)}`)
console.log(`  Points achieved: ${strongScoring.breakdown.pointsAchieved.toFixed(2)}`)
console.log()
displayDimensions(strongScoring)
console.log()

// Display weak match scoring
console.log("=" + "=".repeat(70))
console.log("EXAMPLE 2: WEAK MATCH — Senior DevOps Engineer at CloudOps Inc")
console.log("=" + "=".repeat(70))
console.log()
console.log(`MATCHING RESULT:`)
console.log(`  Matched: ${weakMatching.totalMatched}`)
console.log(`  Missing: ${weakMatching.totalMissing}`)
console.log(`  Conflicting: ${weakMatching.totalConflicting}`)
console.log(`  Unknown: ${weakMatching.totalUnknown}`)
console.log()
console.log(`SCORE RESULT:`)
console.log(`  Score: ${weakScoring.score}/100`)
console.log(`  Summary: ${weakScoring.summary}`)
console.log()
console.log(`BREAKDOWN:`)
console.log(`  Known dimensions: ${weakScoring.breakdown.knownDimensions}/10`)
console.log(`  Unknown dimensions: ${weakScoring.breakdown.unknownDimensions}`)
console.log(`  Total possible points: ${weakScoring.breakdown.totalPoints.toFixed(1)}`)
console.log(`  Points achieved: ${weakScoring.breakdown.pointsAchieved.toFixed(2)}`)
console.log()
displayDimensions(weakScoring)
console.log()

// Display detailed breakdown
console.log("=" + "=".repeat(70))
console.log("DETAILED BREAKDOWN")
console.log("=" + "=".repeat(70))
console.log(describeScoreBreakdown(strongScoring))
console.log(describeScoreBreakdown(weakScoring))

function displayDimensions(result: typeof strongScoring) {
  for (const dim of result.breakdown.dimensions) {
    const icon =
      dim.status === "matched" ? "✓" : dim.status === "missing" ? "✗" : dim.status === "conflicting" ? "⚠" : "?"
    const weight = `(w: ${dim.weight.toFixed(1)})`
    const points = dim.status === "unknown" ? "(excluded)" : `${dim.pointsAchieved.toFixed(2)}/${dim.pointsPossible.toFixed(1)}`

    console.log(`  ${icon} ${dim.dimension.padEnd(20)} ${dim.status.padEnd(11)} ${points.padEnd(10)} ${weight}`)
  }
}
