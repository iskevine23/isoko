import { bestMatches, type MatchCandidate } from "../text";
import { CharNgramTfidf, cosine } from "./embeddings";

/** At or above this, a commodity name is mapped without review. */
export const COMMODITY_AUTO_ACCEPT = 0.9;
/** At or above this, a market name is mapped without review. */
export const MARKET_AUTO_ACCEPT = 0.88;
/**
 * Below these, a name is reported as unknown instead of suggested. Chosen on
 * the training evaluation: no out-of-catalog test name reaches them.
 */
export const COMMODITY_REVIEW_MIN = 0.55;
export const MARKET_REVIEW_MIN = 0.5;
/** Fuzzy score that skips the TF-IDF model entirely. */
const FUZZY_CONFIDENT = 0.92;
/** Candidates this close to the best score make the match ambiguous. */
export const TIE_MARGIN = 0.02;

type Candidates = { canonical: string; aliases: string[] }[];

export interface RankedMatch {
  matches: MatchCandidate[];
  /** True when the TF-IDF character model was consulted. */
  usedEmbedding: boolean;
  /** Whether the TF-IDF model picked the same entity as fuzzy matching (null when not consulted). */
  modelAgrees: boolean | null;
  /** Another catalog entry scored within TIE_MARGIN of the best one. */
  ambiguous: boolean;
}

const models = new WeakMap<Candidates, CharNgramTfidf>();

function modelFor(candidates: Candidates): CharNgramTfidf {
  let model = models.get(candidates);
  if (!model) {
    model = new CharNgramTfidf(candidates.flatMap((c) => [c.canonical, ...c.aliases]));
    models.set(candidates, model);
  }
  return model;
}

function isAmbiguous(matches: MatchCandidate[]): boolean {
  return (
    matches.length > 1 &&
    matches[0]!.score - matches[1]!.score < TIE_MARGIN &&
    matches[0]!.score >= 0.5
  );
}

/**
 * Two-model entity match. Fuzzy matching (edit distance, token overlap,
 * aliases) ranks candidates; it ranked misspellings best in evaluation.
 * A TF-IDF character n-gram model fitted on the catalog then gives an
 * independent second opinion: agreement raises confidence, disagreement
 * caps it below auto-accept so a person decides.
 */
export function rankEntityMatches(
  input: string,
  candidates: Candidates,
  limit = 3,
  autoAccept = COMMODITY_AUTO_ACCEPT,
): RankedMatch {
  const fuzzy = bestMatches(input, candidates, candidates.length);
  const top = fuzzy[0];
  if (!input.trim() || !top || top.score >= FUZZY_CONFIDENT) {
    const matches = fuzzy.slice(0, limit);
    return { matches, usedEmbedding: false, modelAgrees: null, ambiguous: isAmbiguous(matches) };
  }

  const model = modelFor(candidates);
  const query = model.transform(input);
  let tfidfBest = { value: "", score: -1, via: "" };
  for (const c of candidates) {
    let score = cosine(query, model.transform(c.canonical));
    let via = c.canonical;
    for (const alias of c.aliases) {
      const s = cosine(query, model.transform(alias));
      if (s > score) {
        score = s;
        via = alias;
      }
    }
    if (score > tfidfBest.score) tfidfBest = { value: c.canonical, score, via };
  }

  const matches = fuzzy.slice(0, limit).map((m) => ({ ...m }));
  const ambiguous = isAmbiguous(matches);
  const agrees = tfidfBest.value === top.value;
  const lead = matches[0]!;
  if (agrees) {
    lead.score = Math.max(lead.score, 0.5 * lead.score + 0.5 * tfidfBest.score);
    lead.reason = `${lead.reason} · TF-IDF model agrees (${Math.round(tfidfBest.score * 100)}%)`;
  } else {
    lead.score = Math.min(lead.score, autoAccept - 0.01);
    lead.reason = `${lead.reason} · TF-IDF model prefers "${tfidfBest.value}"`;
    if (!matches.some((m) => m.value === tfidfBest.value)) {
      const fz = fuzzy.find((m) => m.value === tfidfBest.value)?.score ?? 0;
      matches.push({
        value: tfidfBest.value,
        score: Math.min(lead.score, 0.5 * fz + 0.5 * tfidfBest.score),
        reason: `TF-IDF character model (${Math.round(tfidfBest.score * 100)}%, via "${tfidfBest.via}")`,
      });
    }
  }
  matches.sort((a, b) => b.score - a.score);
  return { matches, usedEmbedding: true, modelAgrees: agrees, ambiguous };
}
