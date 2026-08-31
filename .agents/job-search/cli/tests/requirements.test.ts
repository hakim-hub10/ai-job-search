import { describe, expect, it } from "bun:test"
import {
  createRequirementDescriptor,
  createRequirementIdentity,
  normalizeRequirementText,
  parseLegacyRequirement,
} from "../src/index"

describe("canonical requirement identity", () => {
  it("normalizes case, surrounding whitespace, and internal whitespace", () => {
    expect(normalizeRequirementText("  EXCEL   Reporting  ")).toBe("excel reporting")
    expect(createRequirementIdentity("skill", " Excel ").key).toBe("skill:excel")
  })

  it("uses NFC normalization while preserving the original source-facing text", () => {
    const original = "Cafe\u0301"
    const identity = createRequirementIdentity("skill", original)

    expect(identity.original).toBe(original)
    expect(identity.normalized).toBe("café")
    expect(identity.key).toBe("skill:café")
  })

  it("preserves punctuation, hyphens, slashes, and symbols", () => {
    expect(normalizeRequirementText("C++")).toBe("c++")
    expect(normalizeRequirementText("case-management")).toBe("case-management")
    expect(normalizeRequirementText("C#/.NET")).toBe("c#/.net")
  })

  it("keeps categories and semantic variants distinct", () => {
    expect(createRequirementIdentity("skill", "Excel").key).not.toBe(createRequirementIdentity("certification", "Excel").key)
    expect(createRequirementIdentity("skill", "Excel").key).not.toBe(createRequirementIdentity("skill", "Microsoft Excel").key)
    expect(createRequirementIdentity("certification", "Forklift licence").key).not.toBe(createRequirementIdentity("certification", "Truckkort").key)
  })

  it("creates stable identities and parses only explicit legacy importance", () => {
    const first = createRequirementDescriptor("skill", "Excel", "preferred")
    const second = createRequirementDescriptor("skill", "Excel", "preferred")

    expect(first).toEqual(second)
    expect(parseLegacyRequirement("Preferred: Excel")).toEqual({ original: "Excel", importance: "preferred" })
    expect(parseLegacyRequirement("Excel")).toEqual({ original: "Excel", importance: "unspecified" })
  })
})
