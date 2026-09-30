import { nextIssueId } from "./standardize";
import { similarity } from "./text";
import type { DataRecord, Issue } from "./types";

/**
 * Multi-level duplicate detection.
 * Level 1 — exact key match (date + market + commodity + channel)
 * Level 2 — near key match (fuzzy market / commodity on same date + channel)
 */
export function detectDuplicates(records: DataRecord[]): Issue[] {
  const issues: Issue[] = [];
  const exact = new Map<string, DataRecord[]>();

  for (const r of records) {
    const key = [r.date, r.market, r.commodity, r.channel].join("|").toLowerCase();
    const list = exact.get(key) ?? [];
    list.push(r);
    exact.set(key, list);
  }

  const flagged = new Set<string>();

  exact.forEach((group) => {
    if (group.length < 2) return;
    const [first, ...rest] = group;
    rest.forEach((dup) => {
      flagged.add(dup.id);
      const samePrice = dup.price === first.price;
      issues.push({
        id: nextIssueId(),
        recordId: dup.id,
        type: samePrice ? "EXACT_DUPLICATE" : "PROBABLE_DUPLICATE",
        category: "duplicate",
        severity: samePrice ? "high" : "critical",
        confidence: samePrice ? 0.99 : 0.9,
        title: samePrice
          ? "Exact duplicate observation"
          : "Conflicting duplicate — same key, different price",
        explanation: samePrice
          ? `Row #${dup.rowNumber} repeats row #${first.rowNumber}: identical date, market, commodity and price type.`
          : `Row #${dup.rowNumber} has the same date, market, commodity and price type as row #${first.rowNumber}, but a different price (${first.price} vs ${dup.price} RWF). Only one can be correct.`,
        evidence: [
          { label: "Key", value: `${dup.date} · ${dup.market} · ${dup.commodity} · ${dup.channel}` },
          { label: "Original row", value: `#${first.rowNumber} — ${first.price ?? "n/a"} RWF` },
          { label: "Duplicate row", value: `#${dup.rowNumber} — ${dup.price ?? "n/a"} RWF` },
        ],
        recommendation: samePrice ? "Remove the repeated row." : "Confirm which price is authoritative.",
        method: "Deterministic key matching (date + market + commodity + price type)",
        status: "open",
      });
    });
  });

  // near duplicates
  const byDayChannel = new Map<string, DataRecord[]>();
  for (const r of records) {
    if (flagged.has(r.id)) continue;
    const k = `${r.date}|${r.channel}`;
    const list = byDayChannel.get(k) ?? [];
    list.push(r);
    byDayChannel.set(k, list);
  }

  byDayChannel.forEach((group) => {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (a.commodity === b.commodity && a.market === b.market) continue;
        const cs = similarity(a.commodity, b.commodity);
        const ms = similarity(a.market, b.market);
        if (cs < 0.82 || ms < 0.82) continue;
        const score = (cs + ms) / 2;
        if (flagged.has(b.id)) continue;
        flagged.add(b.id);
        issues.push({
          id: nextIssueId(),
          recordId: b.id,
          type: score >= 0.92 ? "PROBABLE_DUPLICATE" : "POSSIBLE_DUPLICATE",
          category: "duplicate",
          severity: score >= 0.92 ? "medium" : "low",
          confidence: score,
          title: `${score >= 0.92 ? "Probable" : "Possible"} duplicate of row #${a.rowNumber}`,
          explanation: `Rows #${a.rowNumber} and #${b.rowNumber} describe nearly the same observation: "${a.market} / ${a.commodity}" vs "${b.market} / ${b.commodity}" on the same date and price type.`,
          evidence: [
            { label: "Market similarity", value: `${Math.round(ms * 100)}%` },
            { label: "Commodity similarity", value: `${Math.round(cs * 100)}%` },
            { label: "Prices", value: `${a.price ?? "n/a"} vs ${b.price ?? "n/a"} RWF` },
          ],
          recommendation: "Confirm whether these are the same observation before merging. Nothing was deleted automatically.",
          method: "Fuzzy blocking on date + price type, then hybrid name similarity",
          status: "open",
        });
      }
    }
  });

  return issues;
}
