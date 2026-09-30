import { detectDuplicates } from "./dedupe";
import { analyzeTable } from "./pipeline";
import { buildProfile } from "./profile";
import { detectColumns, standardize } from "./standardize";
import type {
  AnalysisResult,
  Coverage,
  DatasetSource,
  Issue,
  LineageEntry,
  MlModelReport,
} from "./types";

/** Base URL of the Flask AI API (ml-api/app.py). */
export const AI_API_URL =
  (import.meta.env.VITE_AI_API_URL as string | undefined)?.replace(/\/$/, "") ??
  "http://127.0.0.1:5001";

/** Findings the Python engines own; the browser keeps completeness, date and duplicate checks. */
const PYTHON_OWNED = new Set<Issue["type"]>([
  "ENTITY_MATCH",
  "UNKNOWN_ENTITY",
  "PRICE_ANOMALY",
  "LADDER_VIOLATION",
  "INVALID_PRICE",
]);

export interface AiApiHealth {
  status: "ok" | "degraded";
  catalog: { source: string; commodities: number; markets: number };
  priceModel: {
    loaded: boolean;
    error: string | null;
    trainedAt: string | null;
    threshold: number | null;
    trees: number;
  };
  matching: { backend: string; sentenceTransformer?: boolean };
}

interface ApiRecord {
  id: string;
  province: string;
  district: string;
  market: string;
  commodity: string;
  match: {
    commodity: { input: string; status: string; method: string; score: number };
    market: { input: string; status: string; method: string; score: number };
  };
}

interface ApiResult {
  engine: string;
  elapsedMs: number;
  records: ApiRecord[];
  issues: Issue[];
  coverage: Coverage;
  ml: {
    isolationForest: MlModelReport;
    entityEmbeddings: { rowsCompared: number; backend: string; note: string };
  };
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${AI_API_URL}${path}`, { ...init, signal: controller.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error((body as { message?: string }).message ?? `AI API returned ${res.status}`);
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkAiApi(timeoutMs = 2500): Promise<AiApiHealth | null> {
  try {
    return await request<AiApiHealth>("/api/health", {}, timeoutMs);
  } catch {
    return null;
  }
}

/**
 * Runs the Python matching and anomaly engines on the table, then assembles the
 * result with the browser's lineage, profile and duplicate checks. Record ids
 * (rec-1, rec-2, …) follow row order on both sides.
 */
export async function analyzeWithAiApi(
  headers: string[],
  rows: Record<string, string>[],
  datasetName: string,
  source: DatasetSource,
  parseErrors: string[] = [],
): Promise<AnalysisResult> {
  const api = await request<ApiResult>("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ headers, rows, datasetName }),
  });

  const analyzedAt = new Date().toISOString();
  const std = standardize(rows, detectColumns(headers), analyzedAt);
  const byId = new Map(api.records.map((r) => [r.id, r]));
  const lineage: LineageEntry[] = [...std.lineage];

  for (const record of std.records) {
    const remote = byId.get(record.id);
    if (!remote) continue;
    for (const field of ["commodity", "market", "province", "district"] as const) {
      const next = remote[field];
      const match = field === "commodity" || field === "market" ? remote.match[field] : null;
      const mappedByModel = Boolean(match && !["exact", "empty"].includes(match.status));
      if (!next || (next === record[field] && !mappedByModel)) continue;
      const rule = match
        ? `Python AI API: ${match.method} (${Math.round(match.score * 100)}%, ${match.status})`
        : "Python AI API: district from the e-Soko market registry";
      record.trace[field] = {
        original: record.trace[field]?.original ?? record[field],
        normalized: next,
        rule,
      };
      if (next === record[field]) continue;
      lineage.push({
        id: `lin-py-${record.id}-${field}`,
        stage: "Python AI matching engine",
        recordId: record.id,
        field,
        before: record[field],
        after: next,
        rule,
        confidence: match?.score ?? 1,
        timestamp: analyzedAt,
        actor: "system",
      });
      record[field] = next;
    }
  }

  const issues = [
    ...std.issues.filter((i) => !PYTHON_OWNED.has(i.type)),
    ...detectDuplicates(std.records),
    ...api.issues,
  ];

  return {
    datasetName,
    analyzedAt,
    source,
    engine: "python-api",
    isDemo: source === "synthetic-test",
    records: std.records,
    issues,
    profile: buildProfile(rows, headers, std.records),
    coverage: api.coverage,
    lineage,
    parseErrors,
    ml: {
      isolationForest: api.ml.isolationForest,
      entityEmbeddings: {
        rowsCompared: api.ml.entityEmbeddings.rowsCompared,
        note: api.ml.entityEmbeddings.note,
      },
    },
  };
}

/**
 * Python AI API first; the in-browser models run when it is unreachable or fails.
 * `notice` explains a fallback so the UI can say which models ran.
 */
export async function analyzePreferApi(
  headers: string[],
  rows: Record<string, string>[],
  datasetName: string,
  source: DatasetSource,
  parseErrors: string[] = [],
): Promise<{ result: AnalysisResult; notice?: string }> {
  if (!(await checkAiApi())) {
    return {
      result: analyzeTable(headers, rows, datasetName, source, parseErrors),
      notice: `Python AI API not reachable at ${AI_API_URL}. The in-browser models were used.`,
    };
  }
  try {
    return { result: await analyzeWithAiApi(headers, rows, datasetName, source, parseErrors) };
  } catch (e) {
    return {
      result: analyzeTable(headers, rows, datasetName, source, parseErrors),
      notice: `The Python AI API failed (${e instanceof Error ? e.message : "unknown error"}). The in-browser models were used.`,
    };
  }
}
