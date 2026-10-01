import { useSyncExternalStore } from "react";
import { detectLadderViolations } from "./anomaly";
import { idbDelete, idbGet, idbSet } from "./idb";
import { analyzeTable } from "./pipeline";
import { buildCoverage, buildProfile } from "./profile";
import { standardize } from "./standardize";
import { setResult } from "./store";
import type {
  AnalysisResult,
  DataRecord,
  DatasetSource,
  Issue,
  IssueStatus,
  IssueType,
  LineageEntry,
} from "./types";

export type EditableField = "date" | "market" | "commodity" | "channel" | "unit" | "price";

export const EDITABLE_FIELDS: { key: EditableField; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "market", label: "Market" },
  { key: "commodity", label: "Commodity" },
  { key: "channel", label: "Price type" },
  { key: "unit", label: "Unit" },
  { key: "price", label: "Price (RWF)" },
];

const RAW_KEY: Record<EditableField, string> = {
  date: "date",
  market: "market",
  commodity: "commodity",
  channel: "price_type",
  unit: "unit",
  price: "price",
};

const HEADERS = [
  "date",
  "province",
  "district",
  "market",
  "commodity",
  "price_type",
  "unit",
  "price",
  "currency",
];

/** Columns that hold at least one value, so fields the file never had do not count as missing cells. */
const usedHeaders = (rows: DraftRow[]) => HEADERS.filter((h) => rows.some((r) => r.raw[h]));
const COLUMNS = {
  date: "date",
  province: "province",
  district: "district",
  market: "market",
  commodity: "commodity",
  channel: "price_type",
  unit: "unit",
  price: "price",
  currency: "currency",
};

/** Issues produced by checking a single row; everything else depends on the rest of the dataset. */
const ROW_TYPES: IssueType[] = [
  "MISSING_VALUE",
  "INVALID_PRICE",
  "INVALID_DATE",
  "UNKNOWN_ENTITY",
  "ENTITY_MATCH",
  "UNIT_INCONSISTENCY",
];
const DUPLICATES: IssueType[] = ["EXACT_DUPLICATE", "PROBABLE_DUPLICATE", "POSSIBLE_DUPLICATE"];
/** Dataset-level findings that a person's edit to the field settles. */
const SETTLED_BY: Record<EditableField, IssueType[]> = {
  price: ["PRICE_ANOMALY"],
  channel: DUPLICATES,
  unit: ["PRICE_ANOMALY"],
  date: DUPLICATES,
  market: ["PRICE_ANOMALY", ...DUPLICATES],
  commodity: ["PRICE_ANOMALY", ...DUPLICATES],
};

export interface DraftRow {
  id: string;
  /** Values as they will be re-checked: the upload, with any confirmed or typed corrections applied. */
  raw: Record<string, string>;
  record: DataRecord;
  edited: boolean;
}

export interface DraftEdit {
  rowId: string;
  field: string;
  before: string;
  after: string;
  via: "ai" | "manual" | "delete";
  confidence: number;
  at: string;
}

export interface Draft {
  id: string;
  name: string;
  source: DatasetSource;
  engine: AnalysisResult["engine"];
  isDemo: boolean;
  createdAt: string;
  savedAt: string | null;
  dirty: boolean;
  rows: DraftRow[];
  issues: Issue[];
  edits: DraftEdit[];
  deleted: number;
  lineage: LineageEntry[];
  parseErrors: string[];
  ml: AnalysisResult["ml"];
}

export type RowState = "error" | "warning" | "valid";

const STORAGE_KEY = "minagri:validation-draft:v1";
let draft: Draft | null = null;
let hydrated = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function commit(next: Draft | null) {
  draft = next;
  emit();
}

export const getDraft = () => draft;

export function useDraft() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => draft,
    () => null,
  );
}

/** Loads a saved draft from this browser once, after the first client render. */
export function hydrateDraft() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  if (draft) return;
  void loadSaved().then((saved) => {
    if (saved && !draft) commit({ ...saved, dirty: false });
  });
}

async function loadSaved(): Promise<Draft | undefined> {
  try {
    const legacy = window.localStorage.getItem(STORAGE_KEY);
    if (legacy) {
      window.localStorage.removeItem(STORAGE_KEY);
      const parsed = JSON.parse(legacy) as Draft;
      await idbSet(STORAGE_KEY, parsed);
      return parsed;
    }
    return await idbGet<Draft>(STORAGE_KEY);
  } catch {
    return undefined;
  }
}

function rawFromRecord(record: DataRecord): Record<string, string> {
  const t = record.trace;
  return {
    date: t.date?.original ?? record.date,
    province: t.province?.original ?? record.province,
    district: t.district?.original ?? record.district,
    market: t.market?.original ?? record.market,
    commodity: t.commodity?.original ?? record.commodity,
    price_type: t.channel?.original ?? record.channel,
    unit: t.unit?.original ?? record.unit,
    price: t.price?.original ?? (record.price == null ? "" : String(record.price)),
    currency: record.currency,
  };
}

export const rawValue = (row: DraftRow, field: EditableField) => row.raw[RAW_KEY[field]] ?? "";

/** What the reviewer sees: the cleaned value, or the uploaded value while an AI match still awaits confirmation. */
export function displayValue(row: DraftRow, field: EditableField, issues: Issue[] = []): string {
  if (field === "price")
    return row.record.price == null ? rawValue(row, field) : String(row.record.price);
  const awaiting = issues.some((i) => i.suggestion?.field === field && i.type === "ENTITY_MATCH");
  if (awaiting) return rawValue(row, field);
  return String(row.record[field] ?? "") || rawValue(row, field);
}

export function startDraft(result: AnalysisResult) {
  hydrated = true;
  commit({
    id: `draft-${Date.now()}`,
    name: result.datasetName,
    source: result.source,
    engine: result.engine,
    isDemo: result.isDemo,
    createdAt: new Date().toISOString(),
    savedAt: null,
    dirty: true,
    rows: result.records.map((record) => ({
      id: record.id,
      raw: rawFromRecord(record),
      record,
      edited: false,
    })),
    issues: result.issues,
    edits: [],
    deleted: 0,
    lineage: result.lineage,
    parseErrors: result.parseErrors,
    ml: result.ml,
  });
}

export function issueFields(issue: Issue): EditableField[] {
  switch (issue.type) {
    case "MISSING_VALUE": {
      const missing = issue.evidence.find((e) => e.label === "Missing")?.value ?? "";
      return missing
        .split(",")
        .map((s) => s.trim())
        .map((s) => (s === "price type" ? "channel" : s))
        .filter((s): s is EditableField => EDITABLE_FIELDS.some((f) => f.key === s));
    }
    case "INVALID_PRICE":
    case "PRICE_ANOMALY":
      return ["price"];
    case "LADDER_VIOLATION":
      return ["price", "channel"];
    case "INVALID_DATE":
      return ["date"];
    case "UNIT_INCONSISTENCY":
      return ["unit"];
    case "UNKNOWN_ENTITY":
    case "ENTITY_MATCH":
      return [entityField(issue)];
    default:
      return [];
  }
}

/**
 * Whether a name finding is about the market or the product. Titles put a fixed label before the quoted
 * input ("Not a known market: \"…\""), so only that label is read; the input itself may contain "market".
 */
export function entityField(issue: Issue): "market" | "commodity" {
  const f = issue.suggestion?.field;
  if (f === "market" || f === "commodity") return f;
  return /market/i.test(issue.title.split('"')[0] ?? "") ? "market" : "commodity";
}

export const isBlocking = (issue: Issue) =>
  issue.severity === "critical" || issue.severity === "high";

/** Missing or impossible values (including retail below farm gate) must be fixed or deleted; other findings can be kept with a reason. */
export const canKeep = (issue: Issue) =>
  !(
    issue.severity === "critical" &&
    (issue.type === "MISSING_VALUE" ||
      issue.type === "INVALID_PRICE" ||
      issue.type === "LADDER_VIOLATION")
  ) && issue.type !== "INVALID_DATE";

export function openIssuesByRow(d: Draft) {
  const map = new Map<string, Issue[]>();
  for (const issue of d.issues) {
    if (issue.status !== "open") continue;
    const list = map.get(issue.recordId) ?? [];
    list.push(issue);
    map.set(issue.recordId, list);
  }
  return map;
}

export function rowState(issues: Issue[] | undefined): RowState {
  if (!issues?.length) return "valid";
  return issues.some(isBlocking) ? "error" : "warning";
}

function recheckRow(
  d: Draft,
  row: DraftRow,
  field: EditableField,
  now: string,
): { row: DraftRow; issues: Issue[] } {
  const out = standardize([row.raw], COLUMNS, now);
  const record: DataRecord = {
    ...out.records[0],
    id: row.id,
    rowNumber: row.record.rowNumber,
    corrected: true,
  };
  const fresh = out.issues.map((i) => ({ ...i, recordId: row.id }));
  const settled = SETTLED_BY[field];
  const issues: Issue[] = [];
  for (const issue of d.issues) {
    if (issue.recordId !== row.id) {
      issues.push(issue);
      continue;
    }
    if (issue.status !== "open") {
      issues.push(issue);
      continue;
    }
    if (ROW_TYPES.includes(issue.type)) {
      const reproduced = fresh.findIndex((f) => f.type === issue.type && f.title === issue.title);
      if (reproduced >= 0) {
        issues.push(issue);
        fresh.splice(reproduced, 1);
      } else {
        issues.push({
          ...issue,
          status: "corrected",
          resolvedAt: now,
          resolutionNote: "Fixed in the validation table",
        });
      }
    } else if (settled.includes(issue.type)) {
      issues.push({
        ...issue,
        status: "corrected",
        resolvedAt: now,
        resolutionNote: `Settled by editing ${field}`,
      });
    } else {
      issues.push(issue);
    }
  }
  return { row: { ...row, record, edited: true }, issues: [...issues, ...fresh] };
}

function applyEdit(
  d: Draft,
  rowId: string,
  field: EditableField,
  value: string,
  via: DraftEdit["via"],
  confidence: number,
): Draft {
  const row = d.rows.find((r) => r.id === rowId);
  if (!row) return d;
  const key = RAW_KEY[field];
  const before = row.raw[key] ?? "";
  if (before === value) return d;
  const now = new Date().toISOString();
  const { row: next, issues } = recheckRow(
    d,
    { ...row, raw: { ...row.raw, [key]: value } },
    field,
    now,
  );
  const rows = d.rows.map((r) => (r.id === rowId ? next : r));
  return {
    ...d,
    dirty: true,
    rows,
    issues: recheckLadder(rows, issues, [ladderKey(row.record), ladderKey(next.record)], now),
    edits: [...d.edits, { rowId, field, before, after: value, via, confidence, at: now }],
  };
}

const ladderKey = (r: DataRecord) => `${r.date}|${r.market}|${r.commodity}`;

/** Re-runs the farm gate ≤ wholesale ≤ retail rule for the price groups an edit touched. */
function recheckLadder(rows: DraftRow[], issues: Issue[], keys: string[], now: string): Issue[] {
  const touched = new Set(keys);
  const records = rows.map((r) => r.record).filter((r) => touched.has(ladderKey(r)));
  const ids = new Set(records.map((r) => r.id));
  const fresh = detectLadderViolations(records).filter((i) => i.type === "LADDER_VIOLATION");
  const out = issues.map((issue) => {
    if (issue.type !== "LADDER_VIOLATION" || issue.status !== "open" || !ids.has(issue.recordId))
      return issue;
    const same = fresh.findIndex((f) => f.recordId === issue.recordId && f.title === issue.title);
    if (same >= 0) {
      fresh.splice(same, 1);
      return issue;
    }
    return {
      ...issue,
      status: "corrected" as IssueStatus,
      resolvedAt: now,
      resolutionNote: "Price ladder is consistent after the edit",
    };
  });
  return [...out, ...fresh];
}

function update(fn: (d: Draft) => Draft) {
  if (draft) commit(fn(draft));
}

export function editCell(rowId: string, field: EditableField, value: string) {
  update((d) => applyEdit(d, rowId, field, value.trim(), "manual", 1));
}

/** Applies one value to several observations, e.g. the market shared by a row's farm-gate, wholesale, and retail prices. */
export function editCells(rowIds: string[], field: EditableField, value: string) {
  update((d) =>
    rowIds.reduce((acc, id) => applyEdit(acc, id, field, value.trim(), "manual", 1), d),
  );
}

export function confirmSuggestions(issueIds: string[]) {
  update((d) => issueIds.reduce((acc, id) => confirmOne(acc, id), d));
}

export function keepIssues(issueIds: string[]) {
  const ids = new Set(issueIds);
  update((d) => {
    const now = new Date().toISOString();
    return {
      ...d,
      dirty: true,
      issues: d.issues.map((i) =>
        ids.has(i.id) && canKeep(i)
          ? {
              ...i,
              status: "accepted" as IssueStatus,
              resolvedAt: now,
              resolutionNote: "Kept as reported in the validation table",
            }
          : i,
      ),
    };
  });
}

function confirmOne(d: Draft, issueId: string): Draft {
  const issue = d.issues.find((i) => i.id === issueId);
  if (!issue?.suggestion) return d;
  const field = issue.suggestion.field as EditableField;
  if (!RAW_KEY[field]) return d;
  const next = applyEdit(
    d,
    issue.recordId,
    field,
    String(issue.suggestion.value),
    "ai",
    issue.confidence,
  );
  const now = new Date().toISOString();
  return {
    ...next,
    issues: next.issues.map((i) =>
      i.id === issueId
        ? { ...i, status: "corrected", resolvedAt: now, resolutionNote: "AI suggestion confirmed" }
        : i,
    ),
  };
}

export function confirmSuggestion(issueId: string) {
  update((d) => confirmOne(d, issueId));
}

export function confirmAllSuggestions(minConfidence: number) {
  update((d) =>
    d.issues
      .filter((i) => i.status === "open" && i.suggestion && i.confidence >= minConfidence)
      .reduce((acc, i) => confirmOne(acc, i.id), d),
  );
}

export function keepIssue(issueId: string) {
  update((d) => {
    const now = new Date().toISOString();
    return {
      ...d,
      dirty: true,
      issues: d.issues.map((i) =>
        i.id === issueId && canKeep(i)
          ? {
              ...i,
              status: "accepted" as IssueStatus,
              resolvedAt: now,
              resolutionNote: "Kept as reported in the validation table",
            }
          : i,
      ),
    };
  });
}

export function deleteRows(rowIds: string[]) {
  const ids = new Set(rowIds);
  update((d) => {
    const now = new Date().toISOString();
    const removed = d.rows.filter((r) => ids.has(r.id));
    const rows = d.rows.filter((r) => !ids.has(r.id));
    return {
      ...d,
      dirty: true,
      rows,
      issues: recheckLadder(
        rows,
        d.issues.filter((i) => !ids.has(i.recordId)),
        removed.map((r) => ladderKey(r.record)),
        now,
      ),
      deleted: d.deleted + removed.length,
      edits: [
        ...d.edits,
        ...removed.map((r) => ({
          rowId: r.id,
          field: "row",
          before: `Row ${r.record.rowNumber}: ${r.record.market} · ${r.record.commodity} · ${r.record.price ?? "no price"}`,
          after: "Deleted",
          via: "delete" as const,
          confidence: 1,
          at: now,
        })),
      ],
    };
  });
}

/** The current rows as a table, for re-running the models outside the store. */
export function draftTable(d: Draft) {
  return { headers: usedHeaders(d.rows), rows: d.rows.map((r) => r.raw) };
}

/**
 * Re-runs every check, including duplicates, peer-price statistics, and the Isolation Forest, on the
 * current rows. Decisions already taken on a row carry over to the same kind of finding.
 */
export function recheckAll(precomputed?: AnalysisResult) {
  update((d) => {
    const result =
      precomputed ??
      analyzeTable(
        usedHeaders(d.rows),
        d.rows.map((r) => r.raw),
        d.name,
        d.source,
        d.parseErrors,
      );
    const byIndex = new Map(result.records.map((rec, i) => [rec.id, d.rows[i]]));
    const decided = new Map(
      d.issues
        .filter((i) => i.status !== "open")
        .map((i) => [`${i.recordId}|${i.type}`, i] as const),
    );
    const rows = d.rows.map((row, i) => ({
      ...row,
      record: {
        ...result.records[i],
        id: row.id,
        rowNumber: row.record.rowNumber,
        corrected: row.edited || undefined,
      },
    }));
    const issues = result.issues.map((issue) => {
      const recordId = byIndex.get(issue.recordId)?.id ?? issue.recordId;
      const prior = decided.get(`${recordId}|${issue.type}`);
      return prior && prior.status === "accepted"
        ? {
            ...issue,
            recordId,
            status: prior.status,
            resolvedAt: prior.resolvedAt,
            resolutionNote: prior.resolutionNote,
          }
        : { ...issue, recordId };
    });
    const history = d.issues.filter((i) => i.status === "corrected");
    return {
      ...d,
      dirty: true,
      rows,
      issues: [...history, ...issues],
      ml: result.ml,
      engine: result.engine,
    };
  });
}

export async function saveDraft(): Promise<boolean> {
  if (!draft || typeof window === "undefined") return false;
  const current = draft;
  const savedAt = new Date().toISOString();
  try {
    await idbSet(STORAGE_KEY, {
      ...current,
      savedAt,
      dirty: false,
      rows: current.rows.map((r) => ({ ...r, record: { ...r.record, raw: {} } })),
    });
  } catch {
    return false;
  }
  // Edits made while writing keep the draft dirty.
  commit(
    draft === current ? { ...current, savedAt, dirty: false } : draft && { ...draft, savedAt },
  );
  return true;
}

export function discardDraft() {
  if (typeof window !== "undefined") void idbDelete(STORAGE_KEY).catch(() => undefined);
  commit(null);
}

export function draftSummary(d: Draft) {
  const byRow = openIssuesByRow(d);
  let errors = 0;
  let warnings = 0;
  for (const row of d.rows) {
    const state = rowState(byRow.get(row.id));
    if (state === "error") errors += 1;
    else if (state === "warning") warnings += 1;
  }
  const suggestions = d.issues.filter((i) => i.status === "open" && i.suggestion).length;
  return {
    rows: d.rows.length,
    errors,
    warnings,
    valid: d.rows.length - errors - warnings,
    suggestions,
    byRow,
  };
}

/** Publishes the validated rows as the trusted dataset used by the dashboard and exports. */
export function publishDraft(): AnalysisResult | null {
  if (!draft) return null;
  const d = draft;
  const now = new Date().toISOString();
  const rowIds = new Set(d.rows.map((r) => r.id));
  const records = d.rows.map((r) => ({ ...r.record, corrected: r.edited || undefined }));
  const reviewLineage: LineageEntry[] = d.edits
    .filter((e) => e.via !== "delete" && rowIds.has(e.rowId))
    .map((e, i) => ({
      id: `val-${i}-${e.rowId}`,
      stage: "Human review",
      recordId: e.rowId,
      field: e.field,
      before: e.before || "(empty)",
      after: e.after || "(empty)",
      rule:
        e.via === "ai"
          ? "AI suggestion confirmed in validation table"
          : "Edited in validation table",
      confidence: e.confidence,
      timestamp: e.at,
      actor: "reviewer",
    }));
  const result: AnalysisResult = {
    datasetName: d.name,
    analyzedAt: now,
    source: d.source,
    engine: d.engine ?? "browser",
    isDemo: d.isDemo,
    records,
    issues: d.issues.filter((i) => rowIds.has(i.recordId)),
    profile: buildProfile(
      d.rows.map((r) => r.raw),
      usedHeaders(d.rows),
      records,
    ),
    coverage: buildCoverage(records),
    lineage: [...d.lineage.filter((l) => rowIds.has(l.recordId)), ...reviewLineage],
    parseErrors: d.parseErrors,
    ml: d.ml,
  };
  setResult(result);
  discardDraft();
  return result;
}
