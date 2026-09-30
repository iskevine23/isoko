/**
 * Trains the price anomaly model on the real e-Soko snapshot, evaluates both
 * models, and writes the model files the app loads.
 * Run: npm run ml:train   (after npm run data:build)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectLadderViolations, detectPriceAnomalies } from "../src/lib/minagri/anomaly";
import { COMMODITIES, MARKETS } from "../src/lib/minagri/catalog";
import type { EsokoSnapshot } from "../src/lib/minagri/esoko";
import {
  CONTAMINATION,
  SUBSAMPLE,
  TREES,
  detectWithForest,
  quantile,
  trainPriceModel,
} from "../src/lib/minagri/ml/anomaly-model";
import {
  COMMODITY_AUTO_ACCEPT,
  COMMODITY_REVIEW_MIN,
  MARKET_AUTO_ACCEPT,
  MARKET_REVIEW_MIN,
  rankEntityMatches,
  TIE_MARGIN,
} from "../src/lib/minagri/ml/entity-match";
import { FEATURES, ladderKey } from "../src/lib/minagri/ml/features";
import { scoreIsolationForest } from "../src/lib/minagri/ml/isolation-forest";
import { buildPriceFeatures } from "../src/lib/minagri/ml/features";
import {
  commodityCandidates,
  detectColumns,
  marketCandidates,
  rankMarketName,
  standardize,
} from "../src/lib/minagri/standardize";
import { mulberry32 } from "../src/lib/minagri/stats";
import { bestMatches } from "../src/lib/minagri/text";
import type { DataRecord, Issue } from "../src/lib/minagri/types";

const root = join(import.meta.dir, "..");
const snapshot = JSON.parse(
  readFileSync(join(root, "src/lib/minagri/data/esoko-snapshot.json"), "utf8"),
) as EsokoSnapshot;
const rows = snapshot.rows.map((cells) =>
  Object.fromEntries(snapshot.headers.map((h, i) => [h, cells[i] ?? ""])),
);
const { records } = standardize(rows, detectColumns(snapshot.headers), new Date().toISOString());
const priced = records.filter((r) => r.price !== null && r.price > 0 && r.channel);

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

// ---------------------------------------------------------------- train
console.log(`Training Isolation Forest on ${priced.length} priced e-Soko rows (${snapshot.date})…`);
const model = trainPriceModel(records, {
  source: "Rwanda e-Soko",
  date: snapshot.date,
  rows: priced.length,
});
const trainScores = scoreIsolationForest(
  model.forest,
  buildPriceFeatures(records).map((p) => p.values),
);

const baseline = (() => {
  const stat = detectPriceAnomalies(records);
  const ladder = detectLadderViolations(records);
  const forest = detectWithForest(records, stat, model, "trained");
  return {
    rows: priced.length,
    forestFlags: forest.flaggedIds.length,
    forestNew: forest.issues.length,
    statisticalFlags: stat.length,
    ladderFlags: ladder.length,
  };
})();

// ---------------------------------------------------------------- price evaluation
type ErrorType =
  "Extra zero (×10)" | "Missing zero (÷10)" | "Price spike (+60%)" | "Ladder inversion";
const ERROR_TYPES: ErrorType[] = [
  "Extra zero (×10)",
  "Missing zero (÷10)",
  "Price spike (+60%)",
  "Ladder inversion",
];
const ROUNDS = 8;
const PER_ROUND = 40;

const tally = new Map<
  ErrorType,
  { injected: number; forest: number; statistical: number; ladder: number; hybrid: number }
>();
ERROR_TYPES.forEach((t) =>
  tally.set(t, { injected: 0, forest: 0, statistical: 0, ladder: 0, hybrid: 0 }),
);
let untouched = 0;
let untouchedForest = 0;
let untouchedHybrid = 0;

const byGroup = new Map<string, DataRecord[]>();
for (const r of priced) {
  const list = byGroup.get(ladderKey(r)) ?? [];
  list.push(r);
  byGroup.set(ladderKey(r), list);
}

for (let round = 0; round < ROUNDS; round++) {
  const rng = mulberry32(1000 + round);
  const clone = records.map((r) => ({ ...r }));
  const index = new Map(clone.map((r) => [r.id, r]));
  const groups = [...byGroup.keys()].sort(() => rng() - 0.5).slice(0, PER_ROUND);
  const injected: { id: string; group: string; type: ErrorType }[] = [];

  groups.forEach((group, i) => {
    const members = byGroup.get(group)!;
    let type = ERROR_TYPES[i % ERROR_TYPES.length]!;
    const farm = members.find((m) => m.channel === "farmgate");
    const upper = members.filter((m) => m.channel !== "farmgate");
    if (type === "Ladder inversion" && (!farm || !upper.length)) type = "Extra zero (×10)";
    const target =
      type === "Ladder inversion"
        ? upper[Math.floor(rng() * upper.length)]!
        : members[Math.floor(rng() * members.length)]!;
    const row = index.get(target.id)!;
    if (type === "Extra zero (×10)") row.price = row.price! * 10;
    if (type === "Missing zero (÷10)") row.price = Math.max(1, Math.round(row.price! / 10));
    if (type === "Price spike (+60%)") row.price = Math.round(row.price! * 1.6);
    if (type === "Ladder inversion") row.price = Math.round(farm!.price! * 0.7);
    injected.push({ id: row.id, group, type });
  });

  const stat = detectPriceAnomalies(clone);
  const ladder = detectLadderViolations(clone);
  const forest = detectWithForest(
    clone,
    stat.map((s) => ({ ...s, evidence: [...s.evidence] })),
    model,
    "trained",
  );
  const groupsOf = (ids: string[]) => new Set(ids.map((id) => ladderKey(index.get(id)!)));
  const ids = (issues: Issue[]) => issues.map((i) => i.recordId);
  const forestGroups = groupsOf(forest.flaggedIds);
  const statGroups = groupsOf(ids(stat));
  const ladderGroups = groupsOf(ids(ladder));

  for (const inj of injected) {
    const t = tally.get(inj.type)!;
    t.injected += 1;
    const f = forestGroups.has(inj.group);
    const s = statGroups.has(inj.group);
    const l = ladderGroups.has(inj.group);
    if (f) t.forest += 1;
    if (s) t.statistical += 1;
    if (l) t.ladder += 1;
    if (f || s || l) t.hybrid += 1;
  }

  const injectedGroups = new Set(injected.map((i) => i.group));
  for (const r of clone) {
    if (r.price === null || !r.channel || injectedGroups.has(ladderKey(r))) continue;
    untouched += 1;
    const g = ladderKey(r);
    if (forest.flaggedIds.includes(r.id)) untouchedForest += 1;
    if (
      forest.flaggedIds.includes(r.id) ||
      stat.some((s) => s.recordId === r.id) ||
      ladder.some((l) => l.recordId === r.id) ||
      false
    )
      untouchedHybrid += 1;
    void g;
  }
}

const byType = ERROR_TYPES.map((type) => {
  const t = tally.get(type)!;
  return {
    type,
    injected: t.injected,
    forestRecall: pct(t.forest, t.injected),
    statisticalRecall: pct(t.statistical, t.injected),
    ladderRuleRecall: pct(t.ladder, t.injected),
    hybridRecall: pct(t.hybrid, t.injected),
  };
});
const totals = [...tally.values()].reduce(
  (a, t) => ({
    injected: a.injected + t.injected,
    forest: a.forest + t.forest,
    statistical: a.statistical + t.statistical,
    hybrid: a.hybrid + t.hybrid,
  }),
  { injected: 0, forest: 0, statistical: 0, hybrid: 0 },
);

// ---------------------------------------------------------------- entity evaluation
const rng = mulberry32(7);
const vowels = "aeiou";
const perturb: [string, (s: string) => string][] = [
  [
    "drop a letter",
    (s) => {
      const i = 1 + Math.floor(rng() * Math.max(1, s.length - 2));
      return s.slice(0, i) + s.slice(i + 1);
    },
  ],
  [
    "swap two letters",
    (s) => {
      const i = 1 + Math.floor(rng() * Math.max(1, s.length - 3));
      return s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2);
    },
  ],
  [
    "wrong vowel",
    (s) => {
      const idx = [...s]
        .map((c, i) => (vowels.includes(c.toLowerCase()) ? i : -1))
        .filter((i) => i > 0);
      if (!idx.length) return s + "a";
      const i = idx[Math.floor(rng() * idx.length)]!;
      return s.slice(0, i) + vowels[(vowels.indexOf(s[i]!.toLowerCase()) + 1) % 5] + s.slice(i + 1);
    },
  ],
  ["case and spacing", (s) => `  ${s.toUpperCase().replace(/ /g, "  ")} `],
];

/** Names that are not in either registry; they must never get a suggestion. */
const OUT_OF_CATALOG = [
  "Laptop",
  "Cement",
  "Diesel fuel",
  "Mobile phone",
  "Toothpaste",
  "Bicycle",
  "Petrol",
  "Roofing sheets",
  "School fees",
  "Airtime",
  "Paracetamol",
  "Printer paper",
  "Motorbike",
  "Solar panel",
  "Detergent",
];

function evaluateEntities(kind: "commodity" | "market") {
  const candidates = kind === "commodity" ? commodityCandidates : marketCandidates;
  const autoAccept = kind === "commodity" ? COMMODITY_AUTO_ACCEPT : MARKET_AUTO_ACCEPT;
  const reviewMin = kind === "commodity" ? COMMODITY_REVIEW_MIN : MARKET_REVIEW_MIN;
  const clean = (s: string) => (kind === "market" ? s.replace(/\bmarket\b/gi, " ") : s);
  const cases: { input: string; accepted: string[] }[] = [];
  if (kind === "commodity") {
    for (const c of COMMODITIES) {
      for (const name of [c.name, c.local].filter(Boolean)) {
        cases.push({ input: name, accepted: [c.name] });
        for (const [, fn] of perturb) cases.push({ input: fn(name), accepted: [c.name] });
      }
    }
  } else {
    for (const m of MARKETS) {
      const accepted = MARKETS.filter((x) => x.source.toLowerCase() === m.source.toLowerCase()).map(
        (x) => x.name,
      );
      cases.push({ input: m.source, accepted });
      for (const [, fn] of perturb) cases.push({ input: fn(m.source), accepted });
    }
  }

  const tally = () => ({
    auto: 0,
    autoCorrect: 0,
    review: 0,
    reviewCorrect: 0,
    unknown: 0,
    top1: 0,
  });
  const withModel = tally();
  const fuzzyOnly = tally();
  let usedModel = 0;
  let disagreements = 0;
  const route = (
    t: ReturnType<typeof tally>,
    score: number | undefined,
    correct: boolean,
    ambiguous: boolean,
  ) => {
    if (correct) t.top1 += 1;
    if (score === undefined || score < reviewMin) t.unknown += 1;
    else if (score >= autoAccept && !ambiguous) {
      t.auto += 1;
      if (correct) t.autoCorrect += 1;
    } else {
      t.review += 1;
      if (correct) t.reviewCorrect += 1;
    }
  };
  for (const c of cases) {
    const input = clean(c.input);
    const ranked =
      kind === "market"
        ? rankMarketName(c.input)
        : rankEntityMatches(input, candidates, 3, autoAccept);
    const top = ranked.matches[0];
    const tied = ranked.matches
      .filter((m) => top && top.score - m.score < TIE_MARGIN)
      .map((m) => m.value);
    const correct = top ? tied.some((t) => c.accepted.includes(t)) : false;
    if (ranked.usedEmbedding) usedModel += 1;
    if (ranked.modelAgrees === false) disagreements += 1;
    route(withModel, top?.score, correct, ranked.ambiguous);

    const fz = bestMatches(input, candidates, 3);
    const fzTied = fz.filter((m) => fz[0]!.score - m.score < TIE_MARGIN).map((m) => m.value);
    route(
      fuzzyOnly,
      fz[0]?.score,
      fzTied.some((t) => c.accepted.includes(t)),
      fz.length > 1 && fz[0]!.score - fz[1]!.score < TIE_MARGIN && fz[0]!.score >= 0.5,
    );
  }

  let negativesSuggested = 0;
  for (const name of OUT_OF_CATALOG) {
    const top = (
      kind === "market" ? rankMarketName(name) : rankEntityMatches(name, candidates, 3, autoAccept)
    ).matches[0];
    if (top && top.score >= reviewMin) negativesSuggested += 1;
  }

  const summary = (t: ReturnType<typeof tally>) => ({
    top1: pct(t.top1, cases.length),
    autoAccepted: pct(t.auto, cases.length),
    autoAcceptPrecision: pct(t.autoCorrect, t.auto),
    sentToReview: pct(t.review, cases.length),
    reviewSuggestionCorrect: pct(t.reviewCorrect, t.review),
    reportedUnknown: pct(t.unknown, cases.length),
  });
  return {
    cases: cases.length,
    usedTfidf: pct(usedModel, cases.length),
    modelsDisagreed: pct(disagreements, cases.length),
    withTfidfCheck: summary(withModel),
    fuzzyOnly: summary(fuzzyOnly),
    outOfCatalog: { names: OUT_OF_CATALOG.length, givenSuggestion: negativesSuggested },
  };
}

const entity = { commodity: evaluateEntities("commodity"), market: evaluateEntities("market") };

// ---------------------------------------------------------------- write
const modelDir = join(root, "src/lib/minagri/ml/models");
mkdirSync(modelDir, { recursive: true });
writeFileSync(join(modelDir, "price-iforest.json"), JSON.stringify(model));

const card = {
  generatedAt: model.trainedAt,
  data: {
    source: "Rwanda e-Soko export",
    date: snapshot.date,
    pricedRows: priced.length,
    commodities: COMMODITIES.length,
    markets: MARKETS.length,
  },
  priceModel: {
    algorithm: "Isolation Forest",
    trees: TREES,
    subsample: model.forest.subsampleSize,
    requestedSubsample: SUBSAMPLE,
    features: [...FEATURES],
    contamination: CONTAMINATION,
    threshold: model.threshold,
    trainingScores: {
      median: r4(quantile(trainScores, 0.5)),
      p90: r4(quantile(trainScores, 0.9)),
      p975: r4(quantile(trainScores, 0.975)),
      max: r4(Math.max(...trainScores)),
    },
    baseline,
    evaluation: {
      protocol: `${ROUNDS} rounds × ${PER_ROUND} errors injected into copies of the real snapshot, one per market-commodity price set. A detection counts when any row of that price set is sent to review.`,
      injected: totals.injected,
      byType,
      overall: {
        forestRecall: pct(totals.forest, totals.injected),
        statisticalRecall: pct(totals.statistical, totals.injected),
        hybridRecall: pct(totals.hybrid, totals.injected),
      },
      untouchedFlagRate: {
        forest: pct(untouchedForest, untouched),
        hybrid: pct(untouchedHybrid, untouched),
      },
    },
  },
  entityMatcher: {
    algorithm:
      "Exact and fuzzy match ranks candidates; TF-IDF over character 2–4-grams fitted on the e-Soko catalog confirms or vetoes auto-acceptance",
    thresholds: {
      commodityAutoAccept: COMMODITY_AUTO_ACCEPT,
      marketAutoAccept: MARKET_AUTO_ACCEPT,
      commodityReviewMin: COMMODITY_REVIEW_MIN,
      marketReviewMin: MARKET_REVIEW_MIN,
    },
    evaluation: {
      protocol:
        "Every catalog name (English and Kinyarwanda for commodities, e-Soko spelling for markets) plus four misspellings each, and 15 names that are in neither registry.",
      ...entity,
    },
  },
};
writeFileSync(join(modelDir, "model-card.json"), `${JSON.stringify(card, null, 2)}\n`);

console.log(`Threshold ${model.threshold} (top ${CONTAMINATION * 100}% of training scores)`);
console.log(
  `Baseline on real snapshot: forest ${baseline.forestFlags}, robust z ${baseline.statisticalFlags}, ladder ${baseline.ladderFlags}`,
);
console.table(byType);
console.log(
  "Overall",
  card.priceModel.evaluation.overall,
  "untouched flag rate",
  card.priceModel.evaluation.untouchedFlagRate,
);
console.log("Entity matcher", JSON.stringify(entity, null, 2));
