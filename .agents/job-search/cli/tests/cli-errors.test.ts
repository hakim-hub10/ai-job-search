import { describe, expect, it } from "bun:test"
import {
  CliInputError,
  CliUsageError,
  formatCliError,
  parseSafeInteger,
  safeCliError,
  validateCommandArguments,
} from "../src/cli-errors"

describe("H5 CLI error and argument consistency", () => {
  it("formats deterministic safe usage and input envelopes without stacks or causes", () => {
    const usage = safeCliError(new CliUsageError("Unknown option: --extra.", "career-agent run ..."))
    expect(formatCliError(usage)).toBe('{"error":"Unknown option: --extra.","code":"CLI_USAGE_ERROR"}\nUsage: career-agent run ...')
    const input = new CliInputError("Safe input failure.")
    ;(input as Error & { cause?: unknown }).cause = new Error("private cause")
    const formatted = formatCliError(safeCliError(input))
    expect(formatted).toBe('{"error":"Safe input failure.","code":"CLI_INPUT_ERROR"}')
    expect(formatted).not.toContain("stack")
    expect(formatted).not.toContain("cause")
    expect(formatted).not.toContain("private")
  })

  it("fails closed for internal errors and preserves explicitly recognized authoritative errors", () => {
    const internal = formatCliError(safeCliError(new Error("private path and secret")))
    expect(internal).toBe('{"error":"An unexpected internal error occurred.","code":"CLI_INTERNAL_ERROR"}')
    const authoritative = safeCliError({ code: "NOT_FOUND" }, () => ({ error: "Application record was not found.", code: "NOT_FOUND" }))
    expect(formatCliError(authoritative)).toBe('{"error":"Application record was not found.","code":"NOT_FOUND"}')
  })

  it("rejects unknown, duplicate scalar, missing-value, and boolean-value argument shapes", () => {
    const spec = { allowed: ["language", "source", "allow"], repeatable: ["source"], boolean: ["allow"], usage: "command usage" }
    expect(() => validateCommandArguments(["--unknown", "x"], spec)).toThrow(CliUsageError)
    expect(() => validateCommandArguments(["--language", "en", "--language", "sv"], spec)).toThrow("may only be provided once")
    expect(() => validateCommandArguments(["--language"], spec)).toThrow("requires a value")
    expect(() => validateCommandArguments(["--allow", "true"], spec)).toThrow("Unexpected positional argument")
    expect(() => validateCommandArguments(["positional"], spec)).toThrow("Unexpected positional argument")
  })

  it("preserves intentional repeatable collection options", () => {
    expect(() => validateCommandArguments(["--source", "one", "--source", "two"], { allowed: ["source"], repeatable: ["source"] })).not.toThrow()
    expect(() => validateCommandArguments(["--cite-evidence", "one", "--cite-evidence", "two"], { allowed: ["cite-evidence"], repeatable: ["cite-evidence"] })).not.toThrow()
  })

  it("accepts only bounded safe integer syntax and minimums", () => {
    expect(parseSafeInteger("0", "select", 0)).toBe(0)
    expect(parseSafeInteger("1", "limit", 1)).toBe(1)
    for (const value of ["", "NaN", "Infinity", "1.5", "-1", "+1", "01", "9007199254740992"]) {
      expect(() => parseSafeInteger(value, "limit", 1)).toThrow(CliUsageError)
    }
    expect(() => parseSafeInteger("0", "limit", 1)).toThrow(CliUsageError)
  })
})
