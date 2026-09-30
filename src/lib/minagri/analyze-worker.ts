import { analyzeTable, type AnalysisProgress, type ProgressFn } from "./pipeline";
import type { AnalysisResult, DatasetSource } from "./types";

export interface AnalyzeRequest {
  id: number;
  headers: string[];
  rows: Record<string, string>[];
  datasetName: string;
  source: DatasetSource;
  parseErrors: string[];
}

export type AnalyzeResponse =
  | { id: number; progress: AnalysisProgress; result?: undefined; error?: undefined }
  | { id: number; result: AnalysisResult; progress?: undefined; error?: undefined }
  | { id: number; error: string; progress?: undefined; result?: undefined };

let worker: Worker | null = null;
let seq = 0;

function getWorker(): Worker | null {
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;
  if (!worker) {
    try {
      worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });
    } catch {
      return null;
    }
  }
  return worker;
}

/**
 * Runs the in-browser models in a Web Worker so the page stays responsive on large uploads, reporting
 * rows processed as it goes. Falls back to the main thread where workers are unavailable.
 */
export function analyzeInBackground(
  headers: string[],
  rows: Record<string, string>[],
  datasetName: string,
  source: DatasetSource,
  parseErrors: string[] = [],
  onProgress?: ProgressFn,
): Promise<AnalysisResult> {
  const onMain = () => analyzeTable(headers, rows, datasetName, source, parseErrors, onProgress);
  const w = getWorker();
  if (!w) return Promise.resolve(onMain());
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<AnalyzeResponse>) => {
      if (e.data.id !== id) return;
      if (e.data.progress) {
        onProgress?.(e.data.progress);
        return;
      }
      cleanup();
      if (e.data.result) resolve(e.data.result);
      else reject(new Error(e.data.error));
    };
    const onError = (e: ErrorEvent) => {
      cleanup();
      worker?.terminate();
      worker = null;
      try {
        resolve(onMain());
      } catch (err) {
        reject(err instanceof Error ? err : new Error(e.message));
      }
    };
    const cleanup = () => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
    };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    w.postMessage({ id, headers, rows, datasetName, source, parseErrors } satisfies AnalyzeRequest);
  });
}
