import type { RankedJob } from "../../../.agents/job-search/cli/src/ranking";
import { presentMatch } from "@/lib/match-confidence";

export function MatchConfidenceSummary({ ranked }: { ranked: RankedJob }) {
  const confidence = presentMatch(ranked);
  return <div aria-label="Matchpoäng och underlag">
    <p>Matchningsgrad: <strong>{confidence.scoreLabel}</strong></p>
    <p>Underlagets täckning: {confidence.coverage}% · Tillförlitlighet: {confidence.confidenceLabel}</p>
    <p>{confidence.explanation}</p>
  </div>;
}
