import { clamp } from "./stats";
import type { AnalysisResult, Issue, QualityScore } from "./types";

const OPEN = (i: Issue) => i.status === "open";

/**
 * Data quality score. Every dimension is a simple, inspectable ratio so the
 * calculation can be shown to the user. Resolved issues stop penalising the
 * dataset, which is why the score improves as the review queue is cleared.
 */
export function computeScore(result: AnalysisResult): QualityScore {
  const rows = Math.max(1, result.records.length);
  const totalCells = Math.max(1, rows * Math.max(1, result.profile.columns));
  const issues = result.issues;

  const missingIssues = issues.filter((i) => i.type === "MISSING_VALUE" && OPEN(i)).length;
  const completeness = clamp(1 - result.profile.missingCells / totalCells - missingIssues / rows / 4, 0, 1);

  const consistencyIssues = issues.filter(
    (i) => OPEN(i) && ["LADDER_VIOLATION", "UNIT_INCONSISTENCY", "INVALID_DATE"].includes(i.type),
  ).length;
  const consistency = clamp(1 - consistencyIssues / rows, 0, 1);

  const dupIssues = issues.filter(
    (i) => OPEN(i) && ["EXACT_DUPLICATE", "PROBABLE_DUPLICATE", "POSSIBLE_DUPLICATE"].includes(i.type),
  ).length;
  const uniqueness = clamp(1 - dupIssues / rows, 0, 1);

  const validityIssues = issues.filter(
    (i) => OPEN(i) && ["INVALID_PRICE", "PRICE_ANOMALY", "UNKNOWN_ENTITY"].includes(i.type),
  ).length;
  const validity = clamp(1 - (validityIssues * 1.2) / rows, 0, 1);

  const matchIssues = issues.filter((i) => i.type === "ENTITY_MATCH");
  const openMatch = matchIssues.filter(OPEN);
  const aiConfidence = clamp(
    matchIssues.length === 0
      ? 0.95
      : 0.95 - (openMatch.length / rows) * 2 + (matchIssues.length - openMatch.length) / rows,
    0,
    1,
  );

  const total =
    completeness * 30 + consistency * 20 + uniqueness * 20 + validity * 20 + aiConfidence * 10;

  return {
    total: Math.round(total),
    completeness: Math.round(completeness * 100),
    consistency: Math.round(consistency * 100),
    uniqueness: Math.round(uniqueness * 100),
    validity: Math.round(validity * 100),
    aiConfidence: Math.round(aiConfidence * 100),
    formula:
      "Score = 30% Completeness + 20% Consistency + 20% Uniqueness + 20% Validity + 10% AI confidence",
    details: [
      {
        label: "Completeness",
        value: `${result.profile.missingCells} empty cells out of ${totalCells.toLocaleString()} and ${missingIssues} records with missing required fields`,
      },
      {
        label: "Consistency",
        value: `${consistencyIssues} open pricing-ladder, unit or date conflicts across ${rows.toLocaleString()} records`,
      },
      { label: "Uniqueness", value: `${dupIssues} open duplicate candidates across ${rows.toLocaleString()} records` },
      { label: "Validity", value: `${validityIssues} open invalid prices, statistical anomalies or unknown entities` },
      {
        label: "AI confidence",
        value: `${matchIssues.length - openMatch.length} of ${matchIssues.length} entity matches confirmed by a reviewer`,
      },
    ],
  };
}

export function issueCounts(issues: Issue[]) {
  const open = issues.filter(OPEN);
  return {
    total: issues.length,
    open: open.length,
    resolved: issues.length - open.length,
    critical: open.filter((i) => i.severity === "critical").length,
    anomalies: open.filter((i) => i.category === "anomaly").length,
    conflicts: open.filter((i) => i.category === "conflict").length,
    duplicates: open.filter((i) => i.category === "duplicate").length,
    matches: open.filter((i) => i.category === "match").length,
  };
}
