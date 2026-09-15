import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import SubmitButton, { submitButtonState } from "./submit-button";

describe("submitButtonState (the pure idle/pending decision SubmitButton renders from)", () => {
  it("shows the children label and is not disabled when idle", () => {
    expect(submitButtonState(false, "Skapar anpassat CV med AI…", "Skapa anpassat CV")).toEqual({ label: "Skapa anpassat CV", disabled: false });
  });
  it("shows the pending label and is disabled while pending", () => {
    expect(submitButtonState(true, "Skapar anpassat CV med AI…", "Skapa anpassat CV")).toEqual({ label: "Skapar anpassat CV med AI…", disabled: true });
  });
});

describe("SubmitButton (real useFormStatus wiring, outside an active form submission)", () => {
  it("renders the idle label, not disabled, when not inside a submitting form", () => {
    const html = renderToStaticMarkup(<SubmitButton pendingLabel="Skapar anpassat CV med AI…">Skapa anpassat CV</SubmitButton>);
    expect(html).toContain("Skapa anpassat CV");
    expect(html).not.toContain("Skapar anpassat CV med AI…");
    expect(html).not.toContain("disabled");
  });
  it("renders as a real submit button, preserving normal form submission behavior", () => {
    const html = renderToStaticMarkup(<SubmitButton pendingLabel="Skapar personligt brev med AI…">Skapa personligt brev</SubmitButton>);
    expect(html).toContain('type="submit"');
  });
});
