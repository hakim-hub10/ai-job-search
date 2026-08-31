import {
  createDefaultCandidateProfile,
  normalizeJob,
  matchProfile,
  analyzeSkillGaps,
  normalizeCandidateProfile,
  describeScoreBreakdown,
  scoreMatch,
} from "../src/index"

const candidate = normalizeCandidateProfile({
  headline: "Mid-level Full-Stack Developer",
  targetRoles: ["Full-Stack Engineer", "Backend Engineer"],
  skills: {
    technical: ["TypeScript", "React", "Node.js", "PostgreSQL", "Git"],
    soft: ["Communication", "Problem solving"],
  },
  workExperience: [
    {
      title: "Full-Stack Developer",
      company: "TechCorp",
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
})

// Job 1: Good fit (matches well)
const goodFitJob = normalizeJob({
  id: "job-good-fit",
  source: "test",
  title: "Senior Full-Stack Engineer",
  company: "StartupXYZ",
  location: "Stockholm, Sweden",
  country: "Sweden",
  remote: "hybrid",
  employmentType: "full-time",
  seniority: "senior",
  skills: ["TypeScript", "React", "Node.js", "PostgreSQL", "Docker"],
  description:
    "We're looking for a senior full-stack engineer with strong communication skills and ability to mentor junior developers. Bachelor's degree required.",
  category: "technology",
  url: "https://example.com/job1",
})

// Job 2: Partial fit (some gaps)
const partialFitJob = normalizeJob({
  id: "job-partial-fit",
  source: "test",
  title: "DevOps Engineer",
  company: "CloudCorp",
  location: "Copenhagen, Denmark",
  country: "Denmark",
  remote: "onsite",
  employmentType: "full-time",
  seniority: "mid",
  skills: ["Kubernetes", "Terraform", "AWS", "Docker", "Python"],
  description:
    "Seeking a DevOps engineer with infrastructure expertise. AWS certification highly valued. Swedish language skills required. Master's degree preferred.",
  category: "technology",
  url: "https://example.com/job2",
})

// Analyze good fit
console.log("\n=== JOB 1: Good Fit ===\n")
console.log(`Position: ${goodFitJob.title} at ${goodFitJob.company}`)

const matching1 = matchProfile(candidate, goodFitJob)
const score1 = scoreMatch(matching1)
const gaps1 = analyzeSkillGaps(candidate, goodFitJob, matching1)

console.log(`\nScore: ${score1.score}/100`)
console.log(describeScoreBreakdown(score1))

console.log(`\nSummary: ${gaps1.summary}`)
console.log(`Strengths: ${gaps1.strengths.length}`)
for (const strength of gaps1.strengths.slice(0, 3)) {
  console.log(`  ✓ ${strength.title}`)
}

if (gaps1.gaps.length > 0) {
  console.log(`\nGaps: ${gaps1.gaps.length}`)
  for (const gap of gaps1.gaps) {
    console.log(`  ✗ ${gap.title} (${gap.severity})`)
  }
}

// Analyze partial fit
console.log("\n\n=== JOB 2: Partial Fit ===\n")
console.log(`Position: ${partialFitJob.title} at ${partialFitJob.company}`)

const matching2 = matchProfile(candidate, partialFitJob)
const score2 = scoreMatch(matching2)
const gaps2 = analyzeSkillGaps(candidate, partialFitJob, matching2)

console.log(`\nScore: ${score2.score}/100`)
console.log(describeScoreBreakdown(score2))

console.log(`\nSummary: ${gaps2.summary}`)
console.log(`Strengths: ${gaps2.strengths.length}`)
for (const strength of gaps2.strengths.slice(0, 3)) {
  console.log(`  ✓ ${strength.title}`)
}

if (gaps2.gaps.length > 0) {
  console.log(`\nGaps: ${gaps2.gaps.length}`)
  for (const gap of gaps2.gaps) {
    console.log(`  ✗ ${gap.title} (${gap.severity})`)
    if (gap.candidateHas) {
      console.log(`    → Has: ${gap.candidateHas}`)
    }
  }
}

if (gaps2.recommendations.length > 0) {
  console.log(`\nRecommendations: ${gaps2.recommendations.length}`)
  for (const rec of gaps2.recommendations.slice(0, 2)) {
    console.log(`  → ${rec.title}`)
    console.log(`    Effort: ${rec.estimatedEffort || "Unknown"}`)
  }
}

console.log("\n=== ANALYSIS COMPLETE ===\n")
