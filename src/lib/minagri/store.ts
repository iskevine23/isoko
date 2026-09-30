import { useSyncExternalStore } from "react";
import { analyzeEsokoSnapshot } from "./pipeline";
import { computeScore } from "./scoring";
import type { AnalysisResult, DataRecord, IssueStatus } from "./types";

let state: AnalysisResult | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function ensure(): AnalysisResult {
  if (!state) state = analyzeEsokoSnapshot();
  return state;
}

export function setResult(r: AnalysisResult) {
  state = r;
  emit();
}

export function useAnalysis() {
  const r = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    ensure,
    ensure,
  );
  return { result: r, score: computeScore(r) };
}

export function reloadSnapshot() {
  setResult(analyzeEsokoSnapshot());
}

export function resolveIssue(
  id: string,
  status: IssueStatus,
  note?: string,
  override?: { field: keyof DataRecord; value: string | number },
) {
  const r = ensure();
  const issue = r.issues.find((i) => i.id === id);
  if (!issue) return;
  const now = new Date().toISOString();
  const issues = r.issues.map((i) => (i.id === id ? { ...i, status, resolvedAt: now, resolutionNote: note } : i));
  let records = r.records;
  const lineage = [...r.lineage];
  const suggestion = override ?? issue.suggestion;
  if (status === "corrected" && suggestion) {
    const { field, value } = suggestion;
    records = records.map((rec) => {
      if (rec.id !== issue.recordId) return rec;
      lineage.push({
        id: `rev-${id}`,
        stage: "Human review",
        recordId: rec.id,
        field: String(field),
        before: String(rec[field] ?? ""),
        after: String(value),
        rule: issue.title,
        confidence: issue.confidence,
        timestamp: now,
        actor: "reviewer",
      });
      return { ...rec, [field]: value, corrected: true };
    });
  }
  setResult({ ...r, issues, records, lineage });
}
