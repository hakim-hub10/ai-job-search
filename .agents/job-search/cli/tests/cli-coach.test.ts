import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { coachCommand, coachHelp } from "../src/cli-coach"
import { CliInputError, CliUsageError } from "../src/cli-errors"

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })
async function fixture() { const directory = await mkdtemp(join(tmpdir(), "coach-cli-")); directories.push(directory); return directory }

describe("Phase 7.3 coach CLI", () => {
  it("provides help and candidate create/list/show dispatch", async () => {
    expect(coachHelp()).toBe(0)
    const directory = await fixture()
    expect(await coachCommand(["candidates", "create", "--coach-dir", directory, "--candidate-id", "candidate-a", "--name", "Alex", "--created-at", "2026-01-01T00:00:00.000Z"])).toBe(0)
    expect(await coachCommand(["candidates", "list", "--coach-dir", directory])).toBe(0)
    expect(await coachCommand(["candidates", "show", "--coach-dir", directory, "--candidate-id", "candidate-a"])).toBe(0)
  })

  it("rejects unknown nested commands, unknown options, and duplicate options", async () => {
    const directory = await fixture()
    await expect(coachCommand(["unknown"])).rejects.toBeInstanceOf(CliUsageError)
    await expect(coachCommand(["notes", "list", "--coach-dir", directory, "--unknown", "x"])).rejects.toBeInstanceOf(CliUsageError)
    await expect(coachCommand(["candidates", "list", "--coach-dir", directory, "--coach-dir", directory])).rejects.toThrow("may only be provided once")
  })

  it("requires explicit file or stdin for sensitive note text and never stores application data", async () => {
    const directory = await fixture(); const notePath = join(directory, "note.txt")
    await expect(coachCommand(["notes", "create", "--coach-dir", directory, "--candidate-id", "candidate-a", "--note", "secret", "--note-id", "note-1", "--created-at", "2026-01-01T00:00:00.000Z"])).rejects.toBeInstanceOf(CliUsageError)
    await expect(coachCommand(["notes", "create", "--coach-dir", directory, "--candidate-id", "candidate-a", "--note-file", notePath, "--note-stdin", "--note-id", "note-1", "--created-at", "2026-01-01T00:00:00.000Z"])).rejects.toBeInstanceOf(CliInputError)
    await expect(readFile(join(directory, "operations.json"), "utf8")).rejects.toBeDefined()
  })
})