/// <reference lib="webworker" />
import { analyzeTable, type AnalysisProgress } from "./pipeline";
import type { AnalyzeRequest, AnalyzeResponse } from "./analyze-worker";

const scope = self as unknown as DedicatedWorkerGlobalScope;

self.onmessage = (e: MessageEvent<AnalyzeRequest>) => {
  const { id, headers, rows, datasetName, source, parseErrors } = e.data;
  let lastStage = "";
  let lastAt = 0;
  const onProgress = (progress: AnalysisProgress) => {
    const now = performance.now();
    if (progress.stage === lastStage && now - lastAt < 80) return;
    lastStage = progress.stage;
    lastAt = now;
    scope.postMessage({ id, progress } satisfies AnalyzeResponse);
  };
  let reply: AnalyzeResponse;
  try {
    reply = {
      id,
      result: analyzeTable(headers, rows, datasetName, source, parseErrors, onProgress),
    };
  } catch (err) {
    reply = { id, error: err instanceof Error ? err.message : String(err) };
  }
  scope.postMessage(reply);
};
