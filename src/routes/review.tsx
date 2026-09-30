import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell, SeverityBadge, Stat } from "@/components/AppShell";
import { AiMark, EmptyState } from "@/components/minagri/visuals";
import { Button } from "@/components/ui/button";
import { issueCounts } from "@/lib/minagri/scoring";
import { resolveIssue, useAnalysis } from "@/lib/minagri/store";
import type { Issue } from "@/lib/minagri/types";

const CATS = ["all", "anomaly", "conflict", "duplicate", "match", "completeness"] as const;
type Cat = (typeof CATS)[number];
const RANK = { critical: 0, high: 1, medium: 2, low: 3 };

export const Route = createFileRoute("/review")({
  validateSearch: (search: Record<string, unknown>): { cat?: Exclude<Cat, "all">; focus?: "critical" } => {
    const cat = typeof search.cat === "string" && (CATS as readonly string[]).includes(search.cat) && search.cat !== "all"
      ? (search.cat as Exclude<Cat, "all">)
      : undefined;
    const focus = search.focus === "critical" ? "critical" : undefined;
    return { cat, focus };
  },
  head: () => ({
    meta: [
      { title: "Review Center — MINAGRI Data Intelligence" },
      { name: "description", content: "An inbox for agricultural data quality problems." },
      { property: "og:title", content: "Review Center — MINAGRI Data Intelligence" },
      { property: "og:description", content: "An inbox for agricultural data quality problems." },
    ],
  }),
  component: Review,
});

const TITLES: Record<Cat, string> = {
  all: "Review Center",
  anomaly: "Anomalies",
  conflict: "Pricing conflicts",
  duplicate: "Duplicates",
  match: "Name matching",
  completeness: "Missing values",
};

function Review() {
  const { result } = useAnalysis();
  const search = Route.useSearch();
  const nav = useNavigate();
  const cat: Cat = search.cat ?? "all";
  const [showDone, setShowDone] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const counts = issueCounts(result.issues);

  const list = useMemo(
    () =>
      result.issues
        .filter((i) => (showDone || i.status === "open") && (cat === "all" || i.category === cat) && (!search.focus || i.severity === "critical"))
        .sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.confidence - a.confidence),
    [result.issues, cat, showDone, search.focus],
  );
  const current = list.find((i) => i.id === sel) ?? list[0];
  const rec = current && result.records.find((r) => r.id === current.recordId);

  const setCat = (next: Cat) => {
    setSel(null);
    void nav({ to: "/review", search: next === "all" ? {} : { cat: next } });
  };

  const act = (status: "accepted" | "corrected" | "ignored", override?: { field: "commodity" | "market" | "price"; value: string | number }) => {
    if (!current) return;
    resolveIssue(current.id, status, undefined, override);
    toast.success(status === "corrected" ? "Correction saved" : status === "accepted" ? "Kept as valid" : "Issue ignored");
    setSel(null);
  };

  return (
    <AppShell
      kicker="Human confirmation"
      title={TITLES[cat]}
      subtitle="An inbox for data quality problems. AI explains the finding. You accept, correct, or ignore it."
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Critical"
          value={counts.critical}
          hint="Open, highest severity"
          onClick={() => {
            setSel(null);
            void nav({ to: "/review", search: { focus: "critical" } });
          }}
        />
        <Stat label="Conflicts" value={counts.conflicts} hint="Price ladder and units" onClick={() => setCat("conflict")} />
        <Stat label="Duplicates" value={counts.duplicates} hint="Repeated observations" onClick={() => setCat("duplicate")} />
        <Stat label="Name matches" value={counts.matches} hint="Need a person to confirm" onClick={() => setCat("match")} />
      </div>

      {search.focus === "critical" && (
        <p className="mb-4 text-sm font-medium text-red-700">Showing critical issues only.</p>
      )}

      <div className="mb-4 mt-5 flex flex-wrap items-center gap-2">
        {CATS.map((c) => (
          <Button key={c} size="sm" variant={cat === c && !search.focus ? "default" : "outline"} onClick={() => setCat(c)} className="capitalize">
            {c === "all" ? "All open" : c}
          </Button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          Show resolved
        </label>
      </div>

      {cat === "match" && (
        <p className="mb-4 text-sm text-muted-foreground">
          High-confidence names were standardised automatically. These matches are uncertain, so they are not forced.
        </p>
      )}

      {list.length === 0 ? (
        <EmptyState
          title={showDone ? "Nothing in this view" : "No open issues in this view"}
          body="Upload an agricultural dataset to begin analysis, or clear the filter to see the rest of the inbox."
          action={
            <Button variant="outline" onClick={() => setCat("all")}>
              Show all issues
            </Button>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)]">
          <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1" role="listbox" aria-label="Issues">
            {list.slice(0, 200).map((issue) => (
              <button
                key={issue.id}
                type="button"
                role="option"
                aria-selected={current?.id === issue.id}
                onClick={() => setSel(issue.id)}
                className={`w-full rounded-lg border p-3 text-left transition ${
                  current?.id === issue.id ? "border-primary bg-soft" : "border-border bg-card hover:border-agri"
                }`}
              >
                <div className="flex items-center gap-2">
                  <SeverityBadge s={issue.severity} />
                  <span className="text-xs text-muted-foreground">
                    {Math.round(issue.confidence * 100)}% · {issue.status}
                  </span>
                </div>
                <div className="mt-1 text-sm font-semibold">{issue.title}</div>
              </button>
            ))}
          </div>
          {current && <IssueDetail issue={current} record={rec} onAct={act} />}
        </div>
      )}
    </AppShell>
  );
}

function IssueDetail({
  issue,
  record,
  onAct,
}: {
  issue: Issue;
  record: ReturnType<typeof useAnalysis>["result"]["records"][number] | undefined;
  onAct: (status: "accepted" | "corrected" | "ignored", override?: { field: "commodity" | "market" | "price"; value: string | number }) => void;
}) {
  const field: "commodity" | "market" | "price" | undefined =
    issue.suggestion?.field === "commodity" || issue.suggestion?.field === "market" || issue.suggestion?.field === "price"
      ? issue.suggestion.field
      : issue.type === "UNKNOWN_ENTITY" && /commodity/i.test(issue.title)
        ? "commodity"
        : issue.type === "UNKNOWN_ENTITY" && /market/i.test(issue.title)
          ? "market"
          : undefined;
  const original = field && field !== "price" ? record?.trace[field]?.original : record?.trace.commodity?.original;
  const alternatives =
    (field === "commodity" || field === "market") && issue.category === "match"
      ? issue.evidence.filter((e) => e.label !== String(issue.suggestion?.value)).slice(0, 3)
      : [];

  return (
    <article className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <AiMark>AI detection</AiMark>
        <SeverityBadge s={issue.severity} />
        <span className="text-xs uppercase text-muted-foreground">{issue.category}</span>
      </div>
      <h2 className="mt-2 text-xl font-semibold">{issue.title}</h2>
      {record && (
        <p className="mt-2 text-sm text-muted-foreground">
          Row {record.rowNumber} · {record.market || "Unknown market"} · {record.district || "Unknown district"} · {record.commodity || "Unknown commodity"}
        </p>
      )}

      {issue.category === "match" && original && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-secondary p-3">
            <div className="text-xs font-medium text-muted-foreground">Input</div>
            <div className="mt-1 font-semibold">{original}</div>
          </div>
          <div className="rounded-lg bg-info/10 p-3">
            <div className="text-xs font-medium text-info">Suggested match</div>
            <div className="mt-1 font-semibold">{String(issue.suggestion?.value ?? "Needs a choice")}</div>
          </div>
        </div>
      )}

      <dl className="mt-4 grid gap-2 sm:grid-cols-2">
        {issue.evidence.map((e) => (
          <div key={`${e.label}-${e.value}`} className="rounded-lg bg-secondary p-3">
            <dt className="text-xs text-muted-foreground">{e.label}</dt>
            <dd className="mt-1 text-sm font-medium">{e.value}</dd>
          </div>
        ))}
        <div className="rounded-lg bg-secondary p-3">
          <dt className="text-xs text-muted-foreground">Confidence</dt>
          <dd className="mt-1 text-sm font-medium">{Math.round(issue.confidence * 100)}%</dd>
        </div>
      </dl>

      <h3 className="mt-4 text-sm font-semibold">Why this was flagged</h3>
      <p className="mt-1 text-sm">{issue.explanation}</p>
      <h3 className="mt-4 text-sm font-semibold">Recommended action</h3>
      <p className="text-sm">{issue.recommendation}</p>
      <p className="mt-2 text-xs text-muted-foreground">Method: {issue.method}</p>

      {issue.status === "open" ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {issue.suggestion && (field === "commodity" || field === "market" || field === "price") && (
            <Button onClick={() => onAct("corrected")}>
              {issue.category === "match" ? `Confirm “${issue.suggestion.value}”` : `Correct to ${issue.suggestion.value}`}
            </Button>
          )}
          {alternatives.map((alt) =>
            field === "commodity" || field === "market" ? (
              <Button key={alt.label} variant="outline" onClick={() => onAct("corrected", { field, value: alt.label })}>
                Choose {alt.label}
              </Button>
            ) : null,
          )}
          <Button variant="outline" onClick={() => onAct("accepted")}>
            Accept
          </Button>
          <Button variant="ghost" onClick={() => onAct("ignored")}>
            Ignore
          </Button>
        </div>
      ) : (
        <p className="mt-5 text-sm font-medium text-primary">Resolved: {issue.status}</p>
      )}
    </article>
  );
}
