import { CHANNEL_LABEL } from "../catalog";
import { nextIssueId } from "../standardize";
import type { DataRecord, Issue, MlModelReport } from "../types";
import { FEATURE_SET, FEATURES, MIN_PEERS, buildPriceFeatures, type PricedPoint } from "./features";
import { fitIsolationForest, scoreIsolationForest, type IsolationForestModel } from "./isolation-forest";

export interface TrainedPriceModel {
  kind: "isolation-forest";
  featureSet: string;
  features: string[];
  trainedAt: string;
  trainingData: { source: string; date: string; rows: number };
  /** Share of training rows expected to be anomalous; sets the threshold. */
  contamination: number;
  threshold: number;
  forest: IsolationForestModel;
}

export const TREES = 100;
export const SUBSAMPLE = 256;
export const CONTAMINATION = 0.025;
/** A flag must have at least one feature this far (log scale) from typical, about 50%. */
export const MIN_SIGNAL = 0.4;
const MAX_NEW_SHARE = 0.05;

export interface IsolationForestRun {
  report: MlModelReport;
  /** Issues the forest found that the statistical layer had not already flagged. */
  issues: Issue[];
  scores: number[];
  points: PricedPoint[];
  /** Every record that passed the review line, whether new or corroborating. */
  flaggedIds: string[];
}

function strongest(signal: number[]): number {
  let best = 0;
  for (let i = 1; i < signal.length; i++) if (signal[i]! > signal[best]!) best = i;
  return best;
}

export function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo]! + (pos - lo) * ((s[lo + 1] ?? s[lo]!) - s[lo]!);
}

/** Fits the price model. Used by the training script and as a fallback for incompatible saved models. */
export function trainPriceModel(
  records: DataRecord[],
  trainingData: TrainedPriceModel["trainingData"],
  seed = 42,
): TrainedPriceModel {
  const X = buildPriceFeatures(records).map((p) => p.values);
  const forest = fitIsolationForest(X, { trees: TREES, subsampleSize: SUBSAMPLE, seed });
  const scores = scoreIsolationForest(forest, X);
  return {
    kind: "isolation-forest",
    featureSet: FEATURE_SET,
    features: [...FEATURES],
    trainedAt: new Date().toISOString(),
    trainingData,
    contamination: CONTAMINATION,
    threshold: Math.round(quantile(scores, 1 - CONTAMINATION) * 1e4) / 1e4,
    forest,
  };
}

export function isCompatible(model: TrainedPriceModel | null | undefined): model is TrainedPriceModel {
  return Boolean(model && model.featureSet === FEATURE_SET && model.forest?.nFeatures === FEATURES.length);
}

/**
 * Layer 4. Scores priced rows with a trained Isolation Forest and explains
 * each flag from the feature that is furthest from typical. Rows the robust
 * z-score already flagged are corroborated instead of duplicated.
 */
export function detectWithForest(
  records: DataRecord[],
  statisticalIssues: Issue[],
  model: TrainedPriceModel,
  origin: MlModelReport["origin"],
): IsolationForestRun {
  const points = buildPriceFeatures(records);
  const scores = scoreIsolationForest(model.forest, points.map((p) => p.values));
  const threshold = model.threshold;
  const trees = model.forest.trees.length;
  const trainedOn = `${model.trainingData.rows.toLocaleString()} rows from ${model.trainingData.source} (${model.trainingData.date})`;

  const statByRecord = new Map(
    statisticalIssues.filter((i) => i.type === "PRICE_ANOMALY").map((i) => [i.recordId, i] as const),
  );
  const ranked = scores.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score);
  const cap = Math.max(1, Math.round(points.length * MAX_NEW_SHARE));

  const issues: Issue[] = [];
  const flaggedIds: string[] = [];
  let flagged = 0;
  let corroborated = 0;

  for (const hit of ranked) {
    if (hit.score < threshold) break;
    const point = points[hit.index]!;
    const feature = strongest(point.signal);
    if ((point.signal[feature] ?? 0) < MIN_SIGNAL) continue;
    flagged += 1;
    flaggedIds.push(point.record.id);

    const label = FEATURES[feature] ?? "Price pattern";
    const reading = point.display[feature] ?? "";
    // The z-score reading is not plain language; the peer comparison says the same thing.
    const plainReading = (feature === 1 ? point.display[0] : reading) ?? reading;
    const record = point.record;
    const channel = CHANNEL_LABEL[record.channel] ?? record.channel;
    const scoreText = hit.score.toFixed(3);
    const confidence = Math.min(0.97, 0.7 + (hit.score - threshold) * 2);

    const existing = statByRecord.get(record.id);
    if (existing) {
      corroborated += 1;
      if (!existing.evidence.some((e) => e.label === "Isolation Forest")) {
        existing.evidence.push(
          { label: "Isolation Forest", value: `${scoreText} (review line ${threshold.toFixed(3)})` },
          { label: "Model signal", value: `${label}: ${reading}` },
        );
        existing.method = `${existing.method}. Confirmed by Isolation Forest`;
        existing.confidence = Math.min(0.99, Math.max(existing.confidence, confidence));
      }
      continue;
    }
    if (issues.length >= cap) continue;

    const canSuggest = point.peerCount >= MIN_PEERS;
    issues.push({
      id: nextIssueId(),
      recordId: record.id,
      type: "PRICE_ANOMALY",
      category: "anomaly",
      severity: hit.score >= threshold + 0.06 ? "high" : "medium",
      confidence,
      title: `${record.commodity || "Product"}: ${channel.toLowerCase()} price looks unusual`,
      explanation: `The AI model compared this ${channel.toLowerCase()} price at ${record.market || "this market"} with the same product in other markets, this market's and province's usual price levels, and the farm gate → wholesale → retail order. It is among the ${(model.contamination * 100).toFixed(1)}% most unusual prices. What stands out most: ${plainReading}.`,
      evidence: [
        { label: "Observed", value: `${record.price!.toLocaleString()} RWF/${record.unit || "kg"}` },
        { label: "Isolation Forest", value: `${scoreText} (review line ${threshold.toFixed(3)})` },
        { label: "Strongest feature", value: `${label}: ${reading}` },
        { label: "Commodity peers", value: point.display[0] ?? "" },
        { label: "Model", value: `${trees} trees trained on ${trainedOn}` },
      ],
      recommendation: canSuggest
        ? "Compare with the same product in other markets and check it with the market reporter. Correct it if the unit or price type was entered wrongly."
        : "Too few markets priced this product to suggest a value. Check the price with the market reporter.",
      method: `Isolation Forest on relative price features (Layer 4, ${origin === "trained" ? "saved model" : "fitted on this file"})`,
      suggestion: canSuggest ? { field: "price", value: Math.round(point.peerMedian) } : undefined,
      status: "open",
    });
  }

  return {
    issues,
    scores,
    points,
    flaggedIds,
    report: {
      applied: true,
      origin,
      trainedOn,
      trainedAt: model.trainedAt,
      recordsScored: points.length,
      trees,
      subsample: model.forest.subsampleSize,
      threshold,
      flagged,
      corroborated,
      newIssues: issues.length,
      note: `Scored ${points.length.toLocaleString()} priced rows with ${trees} trees (${origin === "trained" ? `saved model trained on ${trainedOn}` : "fitted on this file"}). ${flagged} passed the review line: ${corroborated} confirm a robust z-score flag and ${issues.length} are new.`,
    },
  };
}
