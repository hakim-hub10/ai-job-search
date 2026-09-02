import { describe, expect, it } from "bun:test"
import { assessSearchRelevance, normalizeJob, selectSearchRelevantJobs, type NormalizedJob } from "../src/index"

function job(id: string, title: string, overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return normalizeJob({ id, source: "fixture", sourceId: id, title, company: "Example", location: "Anywhere", description: null, ...overrides })
}

describe("H6 deterministic search relevance", () => {
  it("classifies exact and contained multi-word titles as strong", () => {
    expect(assessSearchRelevance(job("exact", "IT Support"), { query: "IT Support" })).toMatchObject({ tier: "strong", reasons: ["EXACT_TITLE_PHRASE"] })
    expect(assessSearchRelevance(job("technician", "IT Support Technician"), { query: "it support" })).toMatchObject({ tier: "strong" })
    expect(assessSearchRelevance(job("specialist", "Senior IT-Support Specialist"), { query: "IT Support" })).toMatchObject({ tier: "strong" })
  })

  it("normalizes punctuation, case, Unicode compatibility forms, and bounded compounds", () => {
    expect(assessSearchRelevance(job("case", "OPERATIONS / COORDINATOR"), { query: "operations coordinator" }).tier).toBe("strong")
    expect(assessSearchRelevance(job("unicode", "Ｆｉｎａｎｃｉａｌ Analyst"), { query: "financial analyst" }).tier).toBe("strong")
    expect(assessSearchRelevance(job("helpdesk", "Helpdesk Analyst"), { query: "IT Support" })).toMatchObject({ tier: "related", reasons: ["RELATED_ROLE_TERMS"] })
    expect(assessSearchRelevance(job("servicedesk", "ServiceDesk Technician"), { query: "IT Support" })).toMatchObject({ tier: "related", reasons: ["RELATED_ROLE_TERMS"] })
  })

  it("recognizes conservative suffix variants and rejects clearly unrelated titles", () => {
    expect(assessSearchRelevance(job("related", "Operational Coordination Specialist"), { query: "Operations Coordinator" }).tier).toBe("related")
    expect(assessSearchRelevance(job("sales", "Sales Director"), { query: "Operations Coordinator" }).tier).toBe("irrelevant")
    expect(assessSearchRelevance(job("product", "Staff Product Manager, Machine Learning"), { query: "IT Support" }).tier).toBe("irrelevant")
  })

  it("keeps description-only evidence uncertain and missing-description noise irrelevant", () => {
    expect(assessSearchRelevance(job("description", "Project Manager", { description: "Leads the IT support function." }), { query: "IT Support" })).toMatchObject({ tier: "uncertain", reasons: ["DESCRIPTION_ONLY_SUPPORT"] })
    expect(assessSearchRelevance(job("missing", "Project Manager"), { query: "IT Support" }).tier).toBe("irrelevant")
  })

  it("preserves legacy eligibility for an empty or meaningless query", () => {
    const selection = selectSearchRelevantJobs([job("one", "Nurse"), job("two", "Engineer")], { query: " -- " })
    expect(selection.eligibleJobs.map((item) => item.id)).toEqual(["one", "two"])
    expect(selection.results.every((item) => item.reasons[0] === "EMPTY_QUERY")).toBe(true)
  })

  it("handles a broad generic query through exact title tokens", () => {
    expect(assessSearchRelevance(job("manager", "Retail Store Manager"), { query: "manager" }).tier).toBe("strong")
    expect(assessSearchRelevance(job("nurse", "Registered Nurse"), { query: "manager" }).tier).toBe("irrelevant")
  })

  it("uses only query-compatible target roles as supplementary intent", () => {
    expect(assessSearchRelevance(job("ops", "Operations Coordinator"), { query: "Operations", targetRoles: ["Operations Coordinator"] }).tier).toBe("strong")
    expect(assessSearchRelevance(job("profile-only", "Operations Coordinator"), { query: "IT Support", targetRoles: ["Operations Coordinator"] }).tier).toBe("irrelevant")
  })

  it("supports domain-neutral title evidence", () => {
    for (const [query, title] of [
      ["Registered Nurse", "Registered Nurse ICU"],
      ["Warehouse Coordinator", "Warehouse Coordinator"],
      ["Financial Analyst", "Senior Financial Analyst"],
      ["Administrative Assistant", "Administrative Assistant"],
      ["Retail Manager", "Retail Manager"],
      ["Sales Representative", "Sales Representative"],
    ]) expect(assessSearchRelevance(job(title, title), { query }).tier).toBe("strong")
  })

  it("is source-independent, stable, deterministic, and immutable", () => {
    const jobs = [job("a", "IT Support Specialist", { source: "freehire" }), job("b", "Sales Director", { source: "linkedin" }), job("c", "Service Desk Technician", { source: "jobnet" })]
    const before = structuredClone(jobs)
    const first = selectSearchRelevantJobs(jobs, { query: "IT Support", targetRoles: ["IT Support"] })
    const second = selectSearchRelevantJobs(jobs, { query: "IT Support", targetRoles: ["IT Support"] })
    expect(first).toEqual(second)
    expect(first.eligibleJobs.map((item) => item.id)).toEqual(["a", "c"])
    expect(first.excludedJobs.map((item) => item.job.id)).toEqual(["b"])
    expect(jobs).toEqual(before)
    first.eligibleJobs[0].title = "mutated"
    expect(jobs).toEqual(before)
  })

  it("classifies equivalent records identically across sources", () => {
    const a = assessSearchRelevance(job("same", "Help Desk Analyst", { source: "freehire" }), { query: "IT Support" })
    const b = assessSearchRelevance(job("same", "Help Desk Analyst", { source: "jobbank" }), { query: "IT Support" })
    expect(a).toEqual(b)
  })
})
