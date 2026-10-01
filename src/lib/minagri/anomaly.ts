import { CHANNEL_LABEL } from "./catalog";
import { nextIssueId } from "./standardize";
import { robustStats, robustZ } from "./stats";
import type { DataRecord, Issue } from "./types";

const MIN_GROUP = 5;

/** "about 6.3 times" / "62% above" / "only about 10% of" / "35% below", to read before "the usual … price". */
function comparedToUsual(price: number, median: number): string {
  const ratio = price / median;
  if (ratio >= 2) return `about ${ratio.toFixed(1)} times`;
  if (ratio > 1) return `${Math.round((ratio - 1) * 100)}% above`;
  if (ratio <= 0.5) return `only about ${Math.round(ratio * 100)}% of`;
  return `${Math.round((1 - ratio) * 100)}% below`;
}

function likelyCause(price: number, median: number): string {
  const ratio = price / median;
  if (ratio >= 7) return "This looks like an extra zero or a price entered for a larger unit.";
  if (ratio <= 1 / 7)
    return "This looks like a missing zero or a price entered for a smaller unit.";
  return ratio > 1
    ? "It may be a typing error, a different unit, or a real local price rise."
    : "It may be a typing error, a different unit, or a real local price drop.";
}

/**
 * Layer 2 + 3: statistical and contextual anomaly detection.
 * Prices are compared within (commodity, price channel) peer groups across markets,
 * using a robust modified z-score (median / MAD) plus an IQR fence.
 */
export function detectPriceAnomalies(records: DataRecord[]): Issue[] {
  const issues: Issue[] = [];
  const groups = new Map<string, DataRecord[]>();

  for (const r of records) {
    if (r.price === null || r.price <= 0 || !r.commodity || !r.channel) continue;
    const k = `${r.commodity}|${r.channel}`;
    const list = groups.get(k) ?? [];
    list.push(r);
    groups.set(k, list);
  }

  groups.forEach((group, key) => {
    if (group.length < MIN_GROUP) return;
    const [commodity, channel] = key.split("|");
    const values = group.map((r) => r.price!);
    const stats = robustStats(values);
    if (!Number.isFinite(stats.median)) return;

    for (const r of group) {
      const price = r.price!;
      const z = robustZ(price, stats);
      const outsideFence = price < stats.lowerFence || price > stats.upperFence;
      if (Math.abs(z) < 3.5 && !outsideFence) continue;

      const confidence = Math.min(
        0.99,
        0.6 + Math.min(Math.abs(z), 12) / 20 + (outsideFence ? 0.08 : 0),
      );
      const high = price > stats.median;

      issues.push({
        id: nextIssueId(),
        recordId: r.id,
        type: "PRICE_ANOMALY",
        category: "anomaly",
        severity: Math.abs(z) > 8 ? "critical" : Math.abs(z) > 5 ? "high" : "medium",
        confidence,
        title: `${commodity}: ${(CHANNEL_LABEL[channel] ?? channel).toLowerCase()} price is unusually ${high ? "high" : "low"}`,
        explanation: `At ${r.market || "this market"}, ${commodity} is priced ${price.toLocaleString()} RWF/${r.unit || "kg"}, ${comparedToUsual(
          price,
          stats.median,
        )} the usual ${(CHANNEL_LABEL[channel] ?? channel).toLowerCase()} price in other markets (${Math.round(
          stats.median,
        ).toLocaleString()} RWF, from ${stats.n} prices). ${likelyCause(price, stats.median)}`,
        evidence: [
          { label: "Observed", value: `${price.toLocaleString()} RWF/${r.unit || "kg"}` },
          {
            label: "Expected range",
            value: `${Math.max(0, Math.round(stats.lowerFence)).toLocaleString()} – ${Math.round(
              stats.upperFence,
            ).toLocaleString()} RWF`,
          },
          {
            label: "Peer median",
            value: `${Math.round(stats.median).toLocaleString()} RWF (n=${stats.n})`,
          },
          { label: "Robust z-score", value: z.toFixed(2) },
        ],
        recommendation: `Check the price with the market reporter and correct it if it is wrong. The usual price (${Math.round(
          stats.median,
        ).toLocaleString()} RWF) is suggested.`,
        method: "Modified z-score (median/MAD) + IQR fence within commodity × price channel",
        suggestion: { field: "price", value: Math.round(stats.median) },
        status: "open",
      });
    }
  });

  return issues;
}

/** Farm gate ≤ wholesale ≤ retail pricing-ladder validation. */
export function detectLadderViolations(records: DataRecord[]): Issue[] {
  const issues: Issue[] = [];
  const groups = new Map<string, Record<string, DataRecord>>();

  for (const r of records) {
    if (r.price === null || r.price <= 0 || !r.channel || !r.commodity || !r.market) continue;
    const k = `${r.date}|${r.market}|${r.commodity}`;
    const g = groups.get(k) ?? {};
    g[r.channel] = r;
    groups.set(k, g);
  }

  groups.forEach((g) => {
    const farm = g.farmgate;
    const wholesale = g.wholesale;
    const retail = g.retail;

    const check = (
      low: DataRecord | undefined,
      high: DataRecord | undefined,
      lowLabel: string,
      highLabel: string,
    ) => {
      if (!low || !high || low.price === null || high.price === null) return;
      if (low.price <= high.price) return;
      const gap = ((low.price - high.price) / high.price) * 100;
      const retailBelowFarm = low.channel === "farmgate" && high.channel === "retail";
      issues.push({
        id: nextIssueId(),
        recordId: high.id,
        type: "LADDER_VIOLATION",
        category: "conflict",
        severity: retailBelowFarm ? "critical" : gap > 30 ? "high" : "medium",
        confidence: Math.min(0.97, 0.75 + gap / 200),
        title: retailBelowFarm
          ? "Retail price is lower than farm-gate price"
          : `${lowLabel} price is higher than ${highLabel.toLowerCase()} price`,
        explanation: `For ${high.commodity} at ${high.market}, the ${lowLabel.toLowerCase()} price (${low.price.toLocaleString()} RWF) is higher than the ${highLabel.toLowerCase()} price (${high.price.toLocaleString()} RWF). Prices normally rise from farm gate to wholesale to retail, so one of these two prices is probably wrong.`,
        evidence: [
          { label: lowLabel, value: `${low.price.toLocaleString()} RWF (row #${low.rowNumber})` },
          {
            label: highLabel,
            value: `${high.price.toLocaleString()} RWF (row #${high.rowNumber})`,
          },
          { label: "Inversion", value: `${gap.toFixed(1)}%` },
        ],
        recommendation: retailBelowFarm
          ? "Check both prices with the market reporter and correct the wrong one. Retail can never be lower than the farm-gate price."
          : "Check both prices with the market reporter and correct the one that was entered wrongly.",
        method: "Contextual rule — farm gate ≤ wholesale ≤ retail (Layer 3)",
        status: "open",
      });
    };

    check(farm, wholesale, "Farm gate", "Wholesale");
    check(wholesale, retail, "Wholesale", "Retail");
    check(farm, retail, "Farm gate", "Retail");

    // unusually large markup farm → retail
    if (farm && retail && farm.price && retail.price) {
      const ratio = retail.price / farm.price;
      if (ratio > 3) {
        issues.push({
          id: nextIssueId(),
          recordId: retail.id,
          type: "PRICE_ANOMALY",
          category: "anomaly",
          severity: "high",
          confidence: Math.min(0.96, 0.7 + (ratio - 3) / 10),
          title: `${retail.commodity}: retail price is ${ratio.toFixed(1)}× the farm-gate price`,
          explanation: `At ${retail.market}, ${retail.commodity} sells for ${retail.price.toLocaleString()} RWF at retail but ${farm.price.toLocaleString()} RWF at farm gate, ${ratio.toFixed(1)} times more. Markups above 3 times are rare and usually mean one of the prices was entered for a different unit or quantity.`,
          evidence: [
            { label: "Farm gate", value: `${farm.price.toLocaleString()} RWF` },
            { label: "Retail", value: `${retail.price.toLocaleString()} RWF` },
            { label: "Markup", value: `${Math.round((ratio - 1) * 100)}%` },
          ],
          recommendation:
            "Check whether the retail price was entered for a different unit or quantity.",
          method: "Contextual channel-ratio analysis (Layer 3)",
          status: "open",
        });
      }
    }
  });

  return issues;
}
