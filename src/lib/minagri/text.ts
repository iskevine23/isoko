/** Text normalisation + fuzzy similarity helpers used by the matching engine. */

export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

export function editSimilarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

export function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((t) => {
    if (tb.has(t)) inter++;
  });
  return inter / new Set([...ta, ...tb]).size;
}

/** Hybrid similarity: edit distance + token overlap + prefix bonus. */
export function similarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const edit = editSimilarity(na, nb);
  const token = tokenSimilarity(na, nb);
  const contains = na.includes(nb) || nb.includes(na) ? 0.12 : 0;
  return Math.min(1, 0.55 * edit + 0.33 * token + contains + (token > 0 ? 0.08 : 0));
}

export interface MatchCandidate {
  value: string;
  score: number;
  reason: string;
}

export function bestMatches(
  input: string,
  candidates: { canonical: string; aliases: string[] }[],
  limit = 3,
): MatchCandidate[] {
  const scored: MatchCandidate[] = candidates.map((c) => {
    let best = similarity(input, c.canonical);
    let reason = "Name similarity";
    for (const alias of c.aliases) {
      const s = similarity(input, alias) * 0.99;
      if (s > best) {
        best = Math.min(1, s + 0.05);
        reason = `Catalog alias "${alias}"`;
      }
    }
    return { value: c.canonical, score: best, reason };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
