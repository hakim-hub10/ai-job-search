import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CareerActionList } from "./career-actions";
const action = { id: "verify-unknown:skill:docker", kind: "verifyUnknownRequirement" as const, title: "Komplettera information", description: "Överväg att verifiera eller komplettera information om Docker.", evidence: "Informationen var okänd i 2 sparade analyser.", applicationsRepresented: 2, requirementId: "skill:docker" };
describe("career action presentation", () => {
  it("renders advisory Swedish action and factual evidence", () => {
    const html = renderToStaticMarkup(<CareerActionList actions={[action]} />);
    expect(html).toContain("Komplettera information"); expect(html).toContain("Överväg att verifiera"); expect(html).toContain("Informationen var okänd i 2 sparade analyser"); expect(html).not.toMatch(/sannolikhet|anställningsbar|måste|hiring|score/i);
  });
  it("renders a factual empty state", () => expect(renderToStaticMarkup(<CareerActionList actions={[]} />)).toContain("Inga särskilda förslag"));
});
