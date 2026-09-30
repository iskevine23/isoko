import { Sprout } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { QualityScore } from "@/lib/minagri/types";

export const STORY_STEPS = [
  { label: "Upload", tone: "done" },
  { label: "Standardize", tone: "done" },
  { label: "Validate", tone: "done" },
  { label: "Deduplicate", tone: "done" },
  { label: "AI analysis", tone: "ai" },
  { label: "Review", tone: "review" },
  { label: "Trusted data", tone: "done" },
] as const;

export function qualityLabel(score: number) {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 60) return "Fair";
  return "Needs attention";
}

/** Where the loaded dataset sits. Analysis has already run; review is current while issues stay open. */
export function storyCursor(openIssues: number) {
  return openIssues === 0 ? 6 : 5;
}

export function StoryPipeline({ openIssues, critical }: { openIssues: number; critical: number }) {
  const current = storyCursor(openIssues);
  return (
    <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
      {STORY_STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        const ai = step.tone === "ai" && done;
        const attention = active && step.tone === "review" && critical > 0;
        const state = done ? "Complete" : active ? "Current" : "Upcoming";
        return (
          <li
            key={step.label}
            className={`rounded-lg border px-3 py-3 ${
              attention
                ? "border-warning bg-warning/15"
                : ai
                  ? "border-info/30 bg-info/10"
                  : done || (active && !attention)
                    ? "border-agri/30 bg-soft"
                    : "border-border bg-card"
            }`}
          >
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {i + 1} · {state}
            </div>
            <div className="mt-1 text-sm font-semibold">{step.label}</div>
          </li>
        );
      })}
    </ol>
  );
}

export function QualityCard({ score }: { score: QualityScore }) {
  const [open, setOpen] = useState(false);
  const dims = [
    ["Completeness", score.completeness],
    ["Consistency", score.consistency],
    ["Uniqueness", score.uniqueness],
    ["Validity", score.validity],
  ] as const;
  const label = qualityLabel(score.total);

  return (
    <>
      <button
        type="button"
        id="quality"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-border bg-card p-5 text-left shadow-sm transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Data quality</div>
            <div className="mt-2 flex items-end gap-2">
              <span className="text-4xl font-bold tracking-tight">{score.total}</span>
              <span className="mb-1 text-sm text-muted-foreground">/ 100</span>
            </div>
            <div className="mt-1 text-sm font-semibold text-primary">{label}</div>
          </div>
          <div
            className="grid h-24 w-24 shrink-0 place-items-center rounded-full"
            style={{ background: `conic-gradient(#4F9D52 ${score.total * 3.6}deg, #E8FBE6 0deg)` }}
            aria-hidden
          >
            <div className="h-[4.5rem] w-[4.5rem] rounded-full bg-card" />
          </div>
        </div>
        <div className="mt-5 space-y-3">
          {dims.map(([name, value]) => (
            <div key={name}>
              <div className="flex justify-between text-sm">
                <span>{name}</span>
                <span className="font-medium">{value}%</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
                <div className="bar-grow h-2 rounded-full bg-agri" style={{ width: `${value}%` }} />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs font-medium text-primary">See how this score is calculated</p>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>How the quality score is calculated</DialogTitle>
            <DialogDescription>
              {score.total}/100 · {label}. Resolved issues stop reducing the score.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">{score.formula}</p>
          <ul className="space-y-3">
            {score.details.map((d) => (
              <li key={d.label} className="rounded-lg bg-secondary px-3 py-2">
                <div className="text-sm font-semibold">{d.label}</div>
                <p className="mt-1 text-sm text-muted-foreground">{d.value}</p>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card px-6 py-14 text-center shadow-sm">
      <Sprout className="mx-auto h-8 w-8 text-agri" aria-hidden />
      <h3 className="mt-3 text-lg font-semibold">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function AiMark({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-info">
      <span aria-hidden>✦</span>
      {children}
    </span>
  );
}
