import { describe, expect, it } from "bun:test"
import { resolve } from "node:path"

const cliPath = resolve(import.meta.dir, "../src/cli.ts")
async function invoke(args: string[]) {
  const proc = Bun.spawn({ cmd: [process.execPath, cliPath, ...args], stdout: "pipe", stderr: "pipe" })
  return { code: await proc.exited, stdout: await new Response(proc.stdout).text(), stderr: await new Response(proc.stderr).text() }
}

describe("MVP CLI command boundary", () => {
  it("keeps legacy and explicit search source selection behavior", async () => {
    const legacy = await invoke(["--source", "does-not-exist"])
    const explicit = await invoke(["search", "--source", "does-not-exist"])
    expect(legacy.code).toBe(1)
    expect(explicit.code).toBe(1)
    expect(JSON.parse(legacy.stderr)).toMatchObject({ code: "UNKNOWN_SOURCE" })
    expect(JSON.parse(explicit.stderr)).toMatchObject({ code: "UNKNOWN_SOURCE" })
  })

  it("requires explicit profile, evidence, repository, query, and selection before any search", async () => {
    await expect(invoke(["run"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("--profile is required") })
    await expect(invoke(["run", "--profile", "missing.json"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("--evidence is required") })
    await expect(invoke(["run", "--profile", "missing.json", "--evidence", "missing.json"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("--repository is required") })
  })

  it("requires explicit generator selection, consent, and credentials without network access", async () => {
    await expect(invoke(["run", "--profile", "x", "--evidence", "x", "--repository", "x", "--query", "x", "--select", "0", "--generator", "openai"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("requires --allow-remote-generation") })
    await expect(invoke(["run", "--profile", "x", "--evidence", "x", "--repository", "x", "--query", "x", "--select", "0", "--generator", "other"])).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("Unsupported generator") })
  })
})
