import { Link } from "@tanstack/react-router";
import { ClipboardCheck } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { draftSummary, hydrateDraft, useDraft } from "@/lib/minagri/draft";
import { cn } from "@/lib/utils";

/** Shows the dataset waiting in the validation table, if any, with a one-click way back to it. */
export function DraftBanner({ className, note }: { className?: string; note?: string }) {
  const draft = useDraft();
  useEffect(() => hydrateDraft(), []);
  const summary = useMemo(() => (draft ? draftSummary(draft) : null), [draft]);
  if (!draft || !summary) return null;

  const saved = draft.savedAt
    ? `Saved ${new Date(draft.savedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
    : "Not saved yet";

  return (
    <section
      className={cn(
        "flex flex-wrap items-center gap-4 rounded-lg border border-info/30 bg-info/5 p-4",
        className,
      )}
      aria-label="Draft in validation"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[7px] bg-info/10 text-info">
        <ClipboardCheck className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Draft in validation: {draft.name}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {summary.rows.toLocaleString()} rows ·{" "}
          <span className="text-destructive">{summary.errors.toLocaleString()} errors</span> ·{" "}
          <span className="text-amber-700">{summary.warnings.toLocaleString()} warnings</span> ·{" "}
          {summary.valid.toLocaleString()} valid · {draft.dirty ? "Unsaved changes" : saved}
          {note ? ` · ${note}` : ""}
        </p>
      </div>
      <Button asChild>
        <Link to="/validate">Continue validation</Link>
      </Button>
    </section>
  );
}
