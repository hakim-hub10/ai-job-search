import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import PersonalNavigation from "./personal-navigation";
import StructuredProfileFields from "./structured-profile-fields";

describe("personal profile navigation and editor", () => {
  it("exposes only personal analytics and reports", () => {
    const html = renderToStaticMarkup(<PersonalNavigation candidateId="candidate-a" active="profile" />);
    for (const path of ["/", "/jobs", "/applications", "/candidates/candidate-a", "/analytics/candidate-a", "/reports/candidate-a"]) expect(html).toContain(`href="${path}"`);
    expect(html).not.toContain('href="/coach"');
    expect(html).not.toContain('href="/analytics"');
    expect(html).not.toContain('href="/reports"');
  });
  it("renders structured history controls and requires a user headline", () => {
    const html = renderToStaticMarkup(<StructuredProfileFields profile={{ headline: "Job seeker", workExperience: [{ title: "Support", company: "Synthetic", location: "Stockholm" }], education: [{ degree: "YH", field: "IT", institution: "School" }] }} includePresentation />);
    for (const label of ["Arbetsgivare", "Roll / titel", "Skola / lärosäte", "Startdatum", "Pågående anställning", "Lägg till anställning", "Ta bort utbildning", "Din yrkesrubrik"]) expect(html).toContain(label);
    expect(html).not.toContain('value="Job seeker"');
  });
});
