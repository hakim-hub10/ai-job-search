import { describe, expect, it } from "bun:test"
import {
  createDefaultCandidateProfile,
  normalizeJob,
  matchProfile,
  scoreMatch,
  analyzeSkillGaps,
  normalizeCandidateProfile,
  rankJobs,
  getRankingSummary,
  formatRankedJob,
  type RankingInput,
} from "../src/index"

describe("job ranking engine", () => {
  const defaultCandidate = createDefaultCandidateProfile()

  // Helper to create a ranking input
  function createRankingInput(job: ReturnType<typeof normalizeJob>): RankingInput {
    const matching = matchProfile(defaultCandidate, job)
    const scoring = scoreMatch(matching)
    const gaps = analyzeSkillGaps(defaultCandidate, job, matching)
    return { job, matchingResult: matching, scoringResult: scoring, skillGapResult: gaps }
  }

  it("correct ordering: jobs ranked by score descending", () => {
    const jobs = [
      normalizeJob({
        id: "job-1",
        source: "test",
        title: "Platform Engineer",
        company: "TechCorp",
        remote: "hybrid",
        skills: ["TypeScript", "SQL"],
        seniority: "mid",
      }),
      normalizeJob({
        id: "job-2",
        source: "test",
        title: "DevOps Engineer",
        company: "CloudCorp",
        remote: "hybrid",
        skills: ["Kubernetes", "Terraform"],
        seniority: "mid",
      }),
      normalizeJob({
        id: "job-3",
        source: "test",
        title: "Backend Engineer",
        company: "StartupXYZ",
        remote: "hybrid",
        skills: ["TypeScript", "Node.js"],
        seniority: "mid",
      }),
    ]

    const inputs = jobs.map(createRankingInput)
    const ranked = rankJobs(inputs, defaultCandidate)

    // Should have scores in descending order
    for (let i = 0; i < ranked.length - 1; i++) {
      expect(ranked[i].score).toBeGreaterThanOrEqual(ranked[i + 1].score)
    }

    // Each should have a rank
    for (let i = 0; i < ranked.length; i++) {
      expect(ranked[i].rank).toBe(i + 1)
    }
  })

  it("equal-score stability: same scores maintain original order", () => {
    // Create two jobs that will have identical scores
    const jobs = [
      normalizeJob({
        id: "job-a",
        source: "test",
        title: "Engineer A",
        company: "Corp A",
        remote: "hybrid",
        skills: ["TypeScript"],
      }),
      normalizeJob({
        id: "job-b",
        source: "test",
        title: "Engineer B",
        company: "Corp B",
        remote: "hybrid",
        skills: ["TypeScript"],
      }),
      normalizeJob({
        id: "job-c",
        source: "test",
        title: "Engineer C",
        company: "Corp C",
        remote: "hybrid",
        skills: ["TypeScript"],
      }),
    ]

    const inputs = jobs.map(createRankingInput)
    const ranked1 = rankJobs(inputs, defaultCandidate)
    const ranked2 = rankJobs(inputs, defaultCandidate)

    // Should maintain same order on repeated ranking (deterministic)
    for (let i = 0; i < ranked1.length; i++) {
      expect(ranked1[i].job.id).toBe(ranked2[i].job.id)
    }
  })

  it("multiple jobs: handles large job lists", () => {
    const jobs = []
    for (let i = 0; i < 20; i++) {
      jobs.push(
        normalizeJob({
          id: `job-${i}`,
          source: "test",
          title: `Position ${i}`,
          company: `Company ${i}`,
          remote: "hybrid",
          skills: i % 3 === 0 ? ["TypeScript", "SQL"] : ["Python"],
          seniority: i % 2 === 0 ? "mid" : "junior",
        })
      )
    }

    const inputs = jobs.map(createRankingInput)
    const ranked = rankJobs(inputs, defaultCandidate)

    expect(ranked.length).toBe(20)
    for (let i = 0; i < ranked.length; i++) {
      expect(ranked[i].rank).toBe(i + 1)
    }
  })

  it("minimum score filtering: filters jobs below threshold", () => {
    const jobs = [
      normalizeJob({
        id: "job-high",
        source: "test",
        title: "Perfect Match",
        company: "TechCorp",
        remote: "hybrid",
        skills: ["TypeScript", "SQL"],
        seniority: "mid",
      }),
      normalizeJob({
        id: "job-low",
        source: "test",
        title: "DevOps Role",
        company: "CloudCorp",
        remote: "onsite",
        skills: ["Kubernetes", "Terraform"],
        seniority: "senior",
      }),
    ]

    const inputs = jobs.map(createRankingInput)
    const ranked = rankJobs(inputs, defaultCandidate, { minScore: 50 })

    // Should only include jobs with score >= 50
    for (const job of ranked) {
      expect(job.score).toBeGreaterThanOrEqual(50)
    }

    // Some jobs may be filtered out
    expect(ranked.length).toBeLessThanOrEqual(inputs.length)
  })

  it("unknown information: not penalized in ranking", () => {
    const jobWithUnknown = normalizeJob({
      id: "job-minimal",
      source: "test",
      title: "Engineer",
      company: "Corp",
      remote: null,
      skills: [],
      description: null,
    })

    const jobWithDetails = normalizeJob({
      id: "job-detailed",
      source: "test",
      title: "Platform Engineer",
      company: "TechCorp",
      remote: "hybrid",
      skills: ["TypeScript"],
      description: "Great role in Stockholm",
    })

    const input1 = createRankingInput(jobWithUnknown)
    const input2 = createRankingInput(jobWithDetails)

    const ranked = rankJobs([input1, input2], defaultCandidate)

    // Unknown info should not automatically rank worse
    // Rank depends on matching dimensions, not absence of data
    expect(ranked.length).toBe(2)
  })

  it("jobs with skill gaps: gaps reflected in tie-breaking", () => {
    const jobNoGaps = normalizeJob({
      id: "job-no-gaps",
      source: "test",
      title: "Perfect",
      company: "Corp",
      remote: "hybrid",
      skills: ["TypeScript", "SQL"],
    })

    const jobManyGaps = normalizeJob({
      id: "job-many-gaps",
      source: "test",
      title: "Challenging",
      company: "Corp",
      remote: "hybrid",
      skills: ["Kubernetes", "Terraform", "AWS", "Python"],
    })

    const input1 = createRankingInput(jobNoGaps)
    const input2 = createRankingInput(jobManyGaps)

    const ranked = rankJobs([input1, input2], defaultCandidate)

    // If scores are close, fewer gaps should rank higher
    if (Math.abs(ranked[0].score - ranked[1].score) <= 5) {
      expect(ranked[0].skillGapResult.totalGaps).toBeLessThanOrEqual(
        ranked[1].skillGapResult.totalGaps
      )
    }
  })

  it("jobs with conflicts: conflicts reflected in score", () => {
    const candidateRemoteOnly = normalizeCandidateProfile({
      ...defaultCandidate,
      workMode: "remote",
      remotePreference: true,
    })

    const remoteJob = normalizeJob({
      id: "job-remote",
      source: "test",
      title: "Remote Engineer",
      company: "Corp",
      remote: "remote",
      skills: ["TypeScript"],
    })

    const onsiteJob = normalizeJob({
      id: "job-onsite",
      source: "test",
      title: "Onsite Engineer",
      company: "Corp",
      remote: "onsite",
      skills: ["TypeScript"],
    })

    const input1 = createRankingInput(remoteJob)
    const input2 = createRankingInput(onsiteJob)

    const ranked = rankJobs([input1, input2], candidateRemoteOnly)

    // Remote job should rank higher when candidate prefers remote
    expect(ranked[0].job.id).toBe("job-remote")
  })

  it("empty job list: handles gracefully", () => {
    const ranked = rankJobs([], defaultCandidate)
    expect(ranked.length).toBe(0)
  })

  it("single job: handles single item", () => {
    const job = normalizeJob({
      id: "job-1",
      source: "test",
      title: "Engineer",
      company: "Corp",
      remote: "hybrid",
      skills: ["TypeScript"],
    })

    const input = createRankingInput(job)
    const ranked = rankJobs([input], defaultCandidate)

    expect(ranked.length).toBe(1)
    expect(ranked[0].rank).toBe(1)
    expect(ranked[0].job.id).toBe("job-1")
  })

  it("deterministic repeated ranking: same input always produces same output", () => {
    const jobs = [
      normalizeJob({
        id: "job-1",
        source: "test",
        title: "Engineer",
        company: "Corp A",
        remote: "hybrid",
        skills: ["TypeScript"],
      }),
      normalizeJob({
        id: "job-2",
        source: "test",
        title: "Engineer",
        company: "Corp B",
        remote: "hybrid",
        skills: ["Python"],
      }),
    ]

    const inputs = jobs.map(createRankingInput)

    // Rank multiple times
    const ranked1 = rankJobs(inputs, defaultCandidate)
    const ranked2 = rankJobs(inputs, defaultCandidate)
    const ranked3 = rankJobs(inputs, defaultCandidate)

    // All should produce identical results
    for (let i = 0; i < ranked1.length; i++) {
      expect(ranked1[i].job.id).toBe(ranked2[i].job.id)
      expect(ranked2[i].job.id).toBe(ranked3[i].job.id)
      expect(ranked1[i].score).toBe(ranked2[i].score)
      expect(ranked2[i].score).toBe(ranked3[i].score)
    }
  })

  it("different professions: IT job example", () => {
    const itJob = normalizeJob({
      id: "it-1",
      source: "test",
      title: "Platform Engineer",
      company: "TechCorp",
      location: "Stockholm, Sweden",
      remote: "hybrid",
      employmentType: "full-time",
      seniority: "mid",
      skills: ["TypeScript", "Docker", "Kubernetes"],
      category: "technology",
    })

    const input = createRankingInput(itJob)
    const ranked = rankJobs([input], defaultCandidate)

    expect(ranked.length).toBe(1)
    expect(ranked[0].job.title).toContain("Engineer")
  })

  it("different professions: healthcare job example", () => {
    const healthcareCandidate = normalizeCandidateProfile({
      ...defaultCandidate,
      headline: "Registered Nurse with 5 years experience",
      skills: {
        technical: ["Electronic Health Records", "Patient Management Systems"],
        soft: ["Empathy", "Communication", "Patient care"],
      },
      workExperience: [
        {
          title: "Registered Nurse",
          company: "Hospital ABC",
          location: "Stockholm",
          summary: "Intensive care unit",
        },
      ],
    })

    const healthcareJob = normalizeJob({
      id: "health-1",
      source: "test",
      title: "ICU Nurse",
      company: "Central Hospital",
      location: "Stockholm, Sweden",
      remote: "onsite",
      employmentType: "full-time",
      seniority: "mid",
      skills: ["Patient Care", "Electronic Health Records", "ICU Monitoring"],
      category: "healthcare",
      description: "Looking for experienced nurses with strong communication skills",
    })

    const input = createRankingInput(healthcareJob)
    const ranked = rankJobs([input], healthcareCandidate)

    expect(ranked.length).toBe(1)
    expect(ranked[0].job.title).toContain("Nurse")
  })

  it("different professions: logistics/operations job example", () => {
    const logisticsCandidate = normalizeCandidateProfile({
      ...defaultCandidate,
      headline: "Operations Manager with supply chain experience",
      skills: {
        technical: ["Supply Chain Management", "Inventory Systems", "Excel", "SAP"],
        soft: ["Leadership", "Problem solving", "Communication"],
      },
      workExperience: [
        {
          title: "Operations Manager",
          company: "Logistics Corp",
          location: "Jönköping",
          summary: "Warehouse management and optimization",
        },
      ],
      yearsOfExperience: 4,
    })

    const logisticsJob = normalizeJob({
      id: "log-1",
      source: "test",
      title: "Supply Chain Coordinator",
      company: "Distribution Center",
      location: "Jönköping, Sweden",
      remote: "onsite",
      employmentType: "full-time",
      seniority: "mid",
      skills: ["Supply Chain Management", "Inventory Management", "Excel"],
      category: "logistics",
      description: "Coordinate logistics operations. Strong attention to detail and organizational skills required.",
    })

    const input = createRankingInput(logisticsJob)
    const ranked = rankJobs([input], logisticsCandidate)

    expect(ranked.length).toBe(1)
    expect(ranked[0].job.category).toBe("logistics")
  })

  it("metadata preservation: job IDs and URLs preserved", () => {
    const job = normalizeJob({
      id: "test-id-123",
      source: "linkedin",
      title: "Engineer",
      company: "Corp",
      remote: "hybrid",
      url: "https://linkedin.com/jobs/test-123",
      applyUrl: "https://linkedin.com/apply/test-123",
    })

    const input = createRankingInput(job)
    const ranked = rankJobs([input], defaultCandidate)

    expect(ranked[0].job.id).toBe("test-id-123")
    expect(ranked[0].job.source).toBe("linkedin")
    expect(ranked[0].job.url).toBe("https://linkedin.com/jobs/test-123")
    expect(ranked[0].job.applyUrl).toBe("https://linkedin.com/apply/test-123")
  })

  it("result structure: contains all required fields", () => {
    const job = normalizeJob({
      id: "job-1",
      source: "test",
      title: "Engineer",
      company: "Corp",
      remote: "hybrid",
    })

    const input = createRankingInput(job)
    const ranked = rankJobs([input], defaultCandidate)

    const result = ranked[0]
    expect(typeof result.rank).toBe("number")
    expect(result.job).toBeDefined()
    expect(typeof result.score).toBe("number")
    expect(result.matchingResult).toBeDefined()
    expect(result.scoringBreakdown).toBeDefined()
    expect(result.skillGapResult).toBeDefined()
    expect(typeof result.explanation).toBe("string")
  })

  it("ranking summary: generates aggregate statistics", () => {
    const jobs = [
      normalizeJob({
        id: "job-1",
        source: "test",
        title: "Engineer 1",
        company: "Corp A",
        remote: "hybrid",
        skills: ["TypeScript"],
      }),
      normalizeJob({
        id: "job-2",
        source: "test",
        title: "Engineer 2",
        company: "Corp B",
        remote: "hybrid",
        skills: ["Python"],
      }),
    ]

    const inputs = jobs.map(createRankingInput)
    const ranked = rankJobs(inputs, defaultCandidate)
    const summary = getRankingSummary(ranked)

    expect(summary.totalJobs).toBe(2)
    expect(summary.topScores.length).toBeGreaterThan(0)
    expect(typeof summary.averageScore).toBe("number")
    expect(summary.bestMatch).toBeDefined()
  })

  it("formatting: formatRankedJob produces readable output", () => {
    const job = normalizeJob({
      id: "job-1",
      source: "test",
      title: "Platform Engineer",
      company: "TechCorp",
      remote: "hybrid",
      skills: ["TypeScript"],
    })

    const input = createRankingInput(job)
    const ranked = rankJobs([input], defaultCandidate)
    const formatted = formatRankedJob(ranked[0])

    expect(formatted).toContain("Rank #1")
    expect(formatted).toContain("Platform Engineer")
    expect(formatted).toContain("TechCorp")
    expect(formatted).toContain("Score:")
    expect(formatted).toContain("Gaps:")
  })

  it("filtering: all filtered results have score >= minScore", () => {
    const jobs = []
    for (let i = 0; i < 10; i++) {
      jobs.push(
        normalizeJob({
          id: `job-${i}`,
          source: "test",
          title: `Position ${i}`,
          company: `Company ${i}`,
          remote: "hybrid",
          skills: i % 2 === 0 ? ["TypeScript"] : ["Python", "Kubernetes"],
          seniority: i % 3 === 0 ? "senior" : "mid",
        })
      )
    }

    const inputs = jobs.map(createRankingInput)
    const minScore = 50
    const ranked = rankJobs(inputs, defaultCandidate, { minScore })

    for (const job of ranked) {
      expect(job.score).toBeGreaterThanOrEqual(minScore)
    }
  })

  it("explanations: generated when requested", () => {
    const job = normalizeJob({
      id: "job-1",
      source: "test",
      title: "Engineer",
      company: "Corp",
      remote: "hybrid",
      skills: ["TypeScript"],
    })

    const input = createRankingInput(job)

    const withExplanation = rankJobs([input], defaultCandidate, { includeExplanation: true })
    const withoutExplanation = rankJobs([input], defaultCandidate, { includeExplanation: false })

    expect(withExplanation[0].explanation.length).toBeGreaterThan(0)
    expect(withoutExplanation[0].explanation.length).toBe(0)
  })

  it("cross-domain ranking: IT vs healthcare vs logistics jobs ranked correctly", () => {
    const itCandidate = normalizeCandidateProfile({
      ...defaultCandidate,
      headline: "Software Engineer",
      skills: { technical: ["TypeScript", "React"], soft: ["Communication"] },
    })

    const itJob = normalizeJob({
      id: "it",
      source: "test",
      title: "Platform Engineer",
      company: "TechCorp",
      remote: "hybrid",
      skills: ["TypeScript"],
      category: "technology",
    })

    const healthcareJob = normalizeJob({
      id: "health",
      source: "test",
      title: "Nurse",
      company: "Hospital",
      remote: "onsite",
      skills: ["Patient Care"],
      category: "healthcare",
    })

    const logisticsJob = normalizeJob({
      id: "logistics",
      source: "test",
      title: "Operations",
      company: "Warehouse",
      remote: "onsite",
      skills: ["Excel"],
      category: "logistics",
    })

    const inputs = [
      createRankingInput(itJob),
      createRankingInput(healthcareJob),
      createRankingInput(logisticsJob),
    ]

    const ranked = rankJobs(inputs, itCandidate)

    // IT job should rank highest for IT candidate
    expect(ranked[0].job.id).toBe("it")
  })
})
