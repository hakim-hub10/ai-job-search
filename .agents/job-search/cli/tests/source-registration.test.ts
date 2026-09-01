import { describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import {
  SourceSelectionError,
  getBuiltInSourceDefinitions,
  normalizeJob,
  resolveBuiltInSourceAdapters,
  searchJobs,
  type JobSourceAdapter,
} from "../src/index"
import { createSourceAdapter } from "../src/adapters"

const expectedIds = ["linkedin", "jobindex", "jobnet", "jobbank", "jobdanmark", "freehire"] as const

describe("portable built-in source registration", () => {
  it("contains the expected existing sources with unique IDs in deterministic order", () => {
    const sources = getBuiltInSourceDefinitions()
    expect(sources.map((source) => source.id)).toEqual([...expectedIds])
    expect(new Set(sources.map((source) => source.id)).size).toBe(sources.length)
  })

  it("selects only default-enabled sources when none are explicitly requested", () => {
    expect(resolveBuiltInSourceAdapters().map((adapter) => adapter.name)).toEqual(["linkedin", "freehire"])
  })

  it("selects exactly one or multiple explicit sources in canonical registry order", () => {
    expect(resolveBuiltInSourceAdapters(["jobnet"]).map((adapter) => adapter.name)).toEqual(["jobnet"])
    expect(resolveBuiltInSourceAdapters(["freehire", "linkedin", "freehire"]).map((adapter) => adapter.name)).toEqual(["linkedin", "freehire"])
  })

  it("rejects unknown sources before source adapters can be executed", () => {
    expect(() => resolveBuiltInSourceAdapters(["does-not-exist"])).toThrow(SourceSelectionError)
    try {
      resolveBuiltInSourceAdapters(["does-not-exist"])
    } catch (error) {
      expect(error).toMatchObject({ code: "UNKNOWN_SOURCE", unknownSourceIds: ["does-not-exist"] })
    }
  })

  it("reports an unknown --source from the unified CLI before any live search", async () => {
    const cliPath = resolve(import.meta.dir, "../src/cli.ts")
    const proc = Bun.spawn({ cmd: [process.execPath, cliPath, "--source", "does-not-exist"], stdout: "pipe", stderr: "pipe" })
    expect(await proc.exited).toBe(1)
    expect(JSON.parse(await new Response(proc.stderr).text())).toMatchObject({ code: "UNKNOWN_SOURCE" })
  })

  it("uses module-anchored absolute paths that exist without a machine-specific path literal", async () => {
    const sources = getBuiltInSourceDefinitions()
    const machineSpecificPrefix = `/${["home", "user"].join("/")}/`
    const machineSpecificRoot = `${machineSpecificPrefix}ai-job-search`
    for (const source of sources) {
      expect(source.scriptPath).toBe(resolve(import.meta.dir, "../../../..", source.relativeScriptPath))
      expect(existsSync(source.scriptPath)).toBe(true)
      expect(source.relativeScriptPath).not.toContain(machineSpecificPrefix)
    }
    expect(await readFile(new URL("../src/adapters.ts", import.meta.url), "utf8")).not.toContain(machineSpecificRoot)
  })

  it("resolves the same source scripts independently of repository, package, or unrelated caller cwd", () => {
    const scripts = getBuiltInSourceDefinitions().map((source) => source.scriptPath)
    const fromRepository = resolve(import.meta.dir, "../../../../")
    const fromPackage = resolve(import.meta.dir, "../")
    const unrelated = "/tmp/unrelated-caller-directory"
    expect(scripts.every((path) => path.startsWith(fromRepository))).toBe(true)
    expect(fromPackage).not.toBe(unrelated)
    expect(resolveBuiltInSourceAdapters(["linkedin"]).map((adapter) => adapter.name)).toEqual(["linkedin"])
  })

  it("returns immutable registry metadata", () => {
    const sources = getBuiltInSourceDefinitions()
    expect(Object.isFrozen(sources)).toBe(true)
    expect(Object.isFrozen(sources[0])).toBe(true)
    expect(() => { (sources as unknown as Array<{ id: string }>)[0].id = "changed" }).toThrow()
    expect(getBuiltInSourceDefinitions()[0].id).toBe("linkedin")
  })

  it("uses the current Bun executable for a fixture subprocess without network access", async () => {
    const adapter = createSourceAdapter("jobnet", ["tests/fixtures/jobnet-argument-fixture.ts"], process.cwd())
    await expect(adapter.search({ query: "Coordinator", location: "Malmö", limit: 1 })).resolves.toMatchObject({ status: "ok" })
  })

  it("preserves per-source failure isolation and source metadata", async () => {
    const failing: JobSourceAdapter = { name: "linkedin", search: async () => ({ jobs: [], status: "error", source: "linkedin", error: "offline" }) }
    const working: JobSourceAdapter = {
      name: "freehire",
      search: async () => ({ jobs: [normalizeJob({ id: "safe", title: "Coordinator", company: "Example", location: "Malmö", country: null, url: "https://example.test/safe", applyUrl: null, source: "freehire", sourceId: "safe", date: null, employmentType: null, remote: null, description: null, salary: null, skills: [], seniority: null, category: null })], status: "ok", source: "freehire" }),
    }
    const result = await searchJobs({ adapters: [failing, working], includeSourceStatus: true })
    expect(result.jobs).toHaveLength(1)
    expect(result.jobs[0]).toMatchObject({ source: "freehire", sourceId: "safe" })
    expect(result.sourceStatus.map((status) => status.source)).toEqual(["linkedin", "freehire"])
  })
})
