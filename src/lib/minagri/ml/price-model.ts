import type { DataRecord, Issue } from "../types";
import { detectWithForest, isCompatible, trainPriceModel, type IsolationForestRun, type TrainedPriceModel } from "./anomaly-model";
import modelCard from "./models/model-card.json";
import savedModel from "./models/price-iforest.json";

const MIN_ROWS_TO_REFIT = 60;
const saved = savedModel as unknown as TrainedPriceModel;

export const PRICE_MODEL: TrainedPriceModel | null = isCompatible(saved) ? saved : null;

/** Evaluation written by npm run ml:train alongside the saved model. */
export const MODEL_CARD = modelCard;

/** Scores with the saved model. Refits on the file only when the saved model no longer matches the feature set. */
export function runIsolationForest(records: DataRecord[], statisticalIssues: Issue[]): IsolationForestRun {
  if (PRICE_MODEL) return detectWithForest(records, statisticalIssues, PRICE_MODEL, "trained");

  const priced = records.filter((r) => r.price !== null && r.price > 0 && r.channel).length;
  if (priced < MIN_ROWS_TO_REFIT) {
    return {
      issues: [],
      scores: [],
      points: [],
      flaggedIds: [],
      report: {
        applied: false,
        origin: "none",
        trainedOn: "",
        trainedAt: "",
        recordsScored: 0,
        trees: 0,
        subsample: 0,
        threshold: 0,
        flagged: 0,
        corroborated: 0,
        newIssues: 0,
        note: `The saved price model does not match this build (run npm run ml:train), and this file has only ${priced} priced rows, too few to fit a new one. Only the statistical checks ran.`,
      },
    };
  }
  const model = trainPriceModel(records, { source: "this file", date: "fitted during analysis", rows: priced });
  return detectWithForest(records, statisticalIssues, model, "refit");
}
