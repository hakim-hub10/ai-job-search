import { describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("@/lib/authorization", () => ({
  configuredAuthorizationDependencies: () => ({ ok: false, error: { code: "UNAUTHENTICATED", message: "synthetic" } }),
  requireOwnedApplication: async () => ({ ok: false, error: { code: "UNAUTHENTICATED", message: "synthetic" } }),
  requireOwnedCandidate: async () => ({ ok: false, error: { code: "UNAUTHENTICATED", message: "synthetic" } }),
}));

const { documentLanguage } = await import("./actions");

function formData(value?: string): FormData {
  const data = new FormData();
  if (value !== undefined) data.set("documentLanguage", value);
  return data;
}

describe("documentLanguage", () => {
  it("resolves an explicit Swedish selection", () => {
    expect(documentLanguage(formData("sv"))).toBe("sv");
  });

  it("resolves an explicit English selection", () => {
    expect(documentLanguage(formData("en"))).toBe("en");
  });

  it("treats the auto option as no explicit selection", () => {
    expect(documentLanguage(formData("auto"))).toBeUndefined();
  });

  it("treats a missing field as no explicit selection", () => {
    expect(documentLanguage(formData())).toBeUndefined();
  });

  it("rejects any value other than sv, en, or auto", () => {
    expect(() => documentLanguage(formData("fr"))).toThrow("Dokumentspråket kunde inte användas.");
  });
});
