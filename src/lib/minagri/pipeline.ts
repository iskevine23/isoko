import { detectLadderViolations, detectPriceAnomalies } from "./anomaly";
import { AMBIGUOUS_LOCAL_NAMES, COMMODITIES, MARKETS } from "./catalog";
import { parseCsv, toCsv } from "./csv";
import snapshotData from "./data/esoko-snapshot.json";
import { detectDuplicates } from "./dedupe";
import { esokoToTable, isEsokoExport, type EsokoSnapshot } from "./esoko";
import { runIsolationForest } from "./ml/price-model";
import { buildCoverage, buildProfile } from "./profile";
import { detectColumns, standardize } from "./standardize";
import { mulberry32 } from "./stats";
import type { AnalysisResult, DatasetSource } from "./types";

export const PIPELINE_STAGES = [
  "Reading dataset",
  "Detecting columns",
  "Profiling data",
  "Checking duplicates",
  "Matching entities (TF-IDF model)",
  "Scoring prices (Isolation Forest)",
  "Preparing review",
];

/** Rows cleaned so far and the current stage; `percent` is null when progress cannot be measured. */
export interface AnalysisProgress {
  stage: string;
  done: number;
  total: number;
  percent: number | null;
}
export type ProgressFn = (p: AnalysisProgress) => void;

/** Share of the progress bar reached when each stage starts, from timings on a 167k-row upload. */
const STAGE_START = { rows: 0, duplicates: 20, peers: 27, forest: 31, review: 66 } as const;

const snapshot = snapshotData as EsokoSnapshot;
export const SNAPSHOT_NAME = `e-Soko market prices — ${snapshot.date}`;

export const SOURCE_LABEL: Record<DatasetSource, string> = {
  "esoko-snapshot": "e-Soko export (bundled snapshot)",
  upload: "Uploaded file",
  "synthetic-test": "Test file with injected errors",
};

export interface Table {
  headers: string[];
  rows: Record<string, string>[];
  errors: string[];
}

/** Reads one uploaded file: CSV/TSV, a raw e-Soko JSON export, or a flat JSON array. */
export function readTable(text: string, fileName: string): Table {
  const looksJson = /\.json$/i.test(fileName) || /^\s*[[{]/.test(text);
  if (!looksJson) return parseCsv(text);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `${fileName}: not valid JSON (${e instanceof Error ? e.message : "parse error"}).`,
    );
  }
  return { ...jsonToTable(value), errors: [] };
}

/** Stacks tables from several files (e.g. the e-Soko farm gate, wholesale and retail exports). */
export function mergeTables(tables: Table[]): Table {
  const headers = [...new Set(tables.flatMap((t) => t.headers))];
  return {
    headers,
    rows: tables.flatMap((t) =>
      t.rows.map((row) => Object.fromEntries(headers.map((h) => [h, row[h] ?? ""]))),
    ),
    errors: tables.flatMap((t) => t.errors),
  };
}

export function snapshotTable(): { headers: string[]; rows: Record<string, string>[] } {
  return {
    headers: snapshot.headers,
    rows: snapshot.rows.map((cells) =>
      Object.fromEntries(snapshot.headers.map((h, i) => [h, cells[i] ?? ""])),
    ),
  };
}

export function analyzeTable(
  headers: string[],
  rows: Record<string, string>[],
  datasetName: string,
  source: DatasetSource,
  parseErrors: string[] = [],
  onProgress?: ProgressFn,
): AnalysisResult {
  const total = rows.length;
  const report = (stage: string, done: number, percent: number) =>
    onProgress?.({ stage, done, total, percent });
  const analyzedAt = new Date().toISOString();
  const columns = detectColumns(headers);
  report("Cleaning and matching rows", 0, STAGE_START.rows);
  const std = standardize(rows, columns, analyzedAt, (done) =>
    report(
      "Cleaning and matching rows",
      done,
      STAGE_START.rows + (done / Math.max(total, 1)) * (STAGE_START.duplicates - STAGE_START.rows),
    ),
  );
  report("Checking duplicates", total, STAGE_START.duplicates);
  const duplicates = detectDuplicates(std.records);
  report("Comparing prices with peer markets", total, STAGE_START.peers);
  const statistical = detectPriceAnomalies(std.records);
  const ladder = detectLadderViolations(std.records);
  report("Scoring prices (Isolation Forest)", total, STAGE_START.forest);
  const forest = runIsolationForest(std.records, statistical);
  report("Preparing review", total, STAGE_START.review);
  const issues = [...std.issues, ...duplicates, ...statistical, ...ladder, ...forest.issues];
  return {
    datasetName,
    analyzedAt,
    source,
    engine: "browser",
    isDemo: source === "synthetic-test",
    records: std.records,
    issues,
    profile: buildProfile(rows, headers, std.records),
    coverage: buildCoverage(std.records),
    lineage: std.lineage,
    parseErrors,
    ml: {
      isolationForest: forest.report,
      entityEmbeddings: {
        rowsCompared: std.embeddingRows,
        note:
          std.embeddingRows > 0
            ? `The TF-IDF character model compared ${std.embeddingRows.toLocaleString()} commodity or market names that exact and fuzzy matching could not settle.`
            : "Every commodity and market name matched the e-Soko catalog exactly or by fuzzy match, so the TF-IDF model was not needed.",
      },
    },
  };
}

export function analyzeCsv(
  text: string,
  datasetName: string,
  source: DatasetSource = "upload",
): AnalysisResult {
  const parsed = parseCsv(text);
  return analyzeTable(parsed.headers, parsed.rows, datasetName, source, parsed.errors);
}

export function analyzeEsokoSnapshot(): AnalysisResult {
  const table = snapshotTable();
  return analyzeTable(table.headers, table.rows, SNAPSHOT_NAME, "esoko-snapshot");
}

/**
 * Reads uploaded JSON: raw e-Soko price exports (farm gate, wholesale or retail
 * endpoints) or a plain array of flat records.
 */
export function jsonToTable(value: unknown): { headers: string[]; rows: Record<string, string>[] } {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { data?: unknown }).data)
      ? (value as { data: unknown[] }).data
      : null;
  if (!list) throw new Error("The JSON file must contain an array of price records.");
  if (isEsokoExport(list))
    return esokoToTable(list, { ambiguousLocalNames: AMBIGUOUS_LOCAL_NAMES });

  const headers = [
    ...new Set(list.flatMap((row) => (row && typeof row === "object" ? Object.keys(row) : []))),
  ];
  const rows = list.map((row) =>
    Object.fromEntries(
      headers.map((h) => {
        const v = (row as Record<string, unknown>)[h];
        return [h, v === null || v === undefined || typeof v === "object" ? "" : String(v)];
      }),
    ),
  );
  return { headers, rows };
}

/**
 * Synthetic test file on the real e-Soko catalog with deliberately injected
 * errors: typos, local names, extra zeros, missing prices, ladder inversions, duplicates.
 */
export function generateTestCsv(): string {
  const rand = mulberry32(42);
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)]!;
  const markets = MARKETS.filter((m) => !m.name.includes("("));
  const commodities = COMMODITIES.filter((c) => c.base > 0);
  const headers = [
    "Itariki",
    "Province",
    "District",
    "Market_Name",
    "Product",
    "Price_Type",
    "Unit",
    "Price_RWF",
  ];
  const rows: (string | number | null)[][] = [];
  const typos: Record<string, string> = {
    Nyabugogo: "Nyabugogo Mkt",
    Karenge: "Karenje",
    Nyagatare: "nyagatre",
  };
  for (let d = 0; d < 7; d++) {
    const date = new Date(Date.UTC(2026, 8, 22 + d));
    const iso = date.toISOString().slice(0, 10);
    for (let k = 0; k < 30; k++) {
      const m = pick(markets);
      const c = pick(commodities);
      const base = c.base * (0.9 + rand() * 0.2);
      const ladder: [string, number][] = [
        ["farmgate", base],
        ["wholesale", base * 1.08],
        ["retail", base * 1.2],
      ];
      for (const [ch, p] of ladder) {
        let price = String(Math.round(p / 10) * 10);
        let dateStr = iso;
        let market = m.name;
        let commodity = rand() < 0.4 ? c.local : c.name;
        const r = rand();
        if (r < 0.015) price = String(Math.round(p * 10));
        else if (r < 0.025) price = "";
        else if (r < 0.03) price = "n/a";
        if (rand() < 0.2) dateStr = `${String(date.getUTCDate()).padStart(2, "0")}/09/2026`;
        if (typos[market] && rand() < 0.5) market = typos[market]!;
        if (rand() < 0.05) commodity = commodity.toUpperCase();
        if (ch === "retail" && rand() < 0.02) price = String(Math.round(base * 0.7));
        rows.push([dateStr, m.province, m.district, market, commodity, ch, c.unit, price]);
        if (rand() < 0.02)
          rows.push([dateStr, m.province, m.district, market, commodity, ch, c.unit, price]);
      }
    }
  }
  return toCsv(headers, rows);
}
