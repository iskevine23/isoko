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
          {
            label: "Key",
            value: `${dup.date} · ${dup.market} · ${dup.commodity} · ${dup.channel}`,
          },
          { label: "Original row", value: `#${first.rowNumber} — ${first.price ?? "n/a"} RWF` },
          { label: "Duplicate row", value: `#${dup.rowNumber} — ${dup.price ?? "n/a"} RWF` },
        ],
        recommendation: samePrice
          ? "Remove the repeated row."
          : "Confirm which price is authoritative.",
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

  const commodityNear = neighbours(records.map((r) => r.commodity));
  const marketNear = neighbours(records.map((r) => r.market));
  const pairKey = (commodity: string, market: string) => `${commodity}\u0000${market}`;

  byDayChannel.forEach((group) => {
    const firstIndex = new Map<string, number>();
    group.forEach((b, j) => {
      const own = pairKey(b.commodity, b.market);
      let best: { i: number; cs: number; ms: number } | null = null;
      for (const c of commodityNear.get(b.commodity) ?? []) {
        for (const m of marketNear.get(b.market) ?? []) {
          if (c.value === b.commodity && m.value === b.market) continue;
          const i = firstIndex.get(pairKey(c.value, m.value));
          if (i !== undefined && (!best || i < best.i)) best = { i, cs: c.score, ms: m.score };
        }
      }
      if (!firstIndex.has(own)) firstIndex.set(own, j);
      if (!best || flagged.has(b.id)) return;
      const a = group[best.i];
      const { cs, ms } = best;
      const score = (cs + ms) / 2;
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
        recommendation:
          "Confirm whether these are the same observation before merging. Nothing was deleted automatically.",
        method: "Fuzzy blocking on date + price type, then hybrid name similarity",
        status: "open",
      });
    });
  });

  return issues;
}

const NEAR = 0.82;

/** For each distinct name, the distinct names (itself included) at least NEAR similar to it. */
function neighbours(names: string[]): Map<string, { value: string; score: number }[]> {
  const distinct = [...new Set(names)];
  const out = new Map(distinct.map((n) => [n, [] as { value: string; score: number }[]]));
  for (let i = 0; i < distinct.length; i++) {
    const a = distinct[i];
    const self = similarity(a, a);
    if (self >= NEAR) out.get(a)!.push({ value: a, score: self });
    for (let j = i + 1; j < distinct.length; j++) {
      const b = distinct[j];
      const score = similarity(a, b);
      if (score < NEAR) continue;
      out.get(a)!.push({ value: b, score });
      out.get(b)!.push({ value: a, score });
    }
  }
  return out;
}
