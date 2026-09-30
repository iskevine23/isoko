import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { pageTitle } from "@/lib/brand";
import { EmptyState, StoryPipeline } from "@/components/minagri/visuals";
import { Button } from "@/components/ui/button";
import { issueCounts } from "@/lib/minagri/scoring";
import { useAnalysis } from "@/lib/minagri/store";

export const Route = createFileRoute("/lineage")({
  head: () => ({
    meta: [
      { title: pageTitle("Data Lineage") },
      { name: "description", content: "What changed between the raw file and the trusted dataset." },
      { property: "og:title", content: pageTitle("Data Lineage") },
      { property: "og:description", content: "What changed between the raw file and the trusted dataset." },
    ],
  }),
  component: Lineage,
});

function Lineage() {
  const { result } = useAnalysis();
  const [actor, setActor] = useState<"all" | "system" | "reviewer">("all");
  const counts = issueCounts(result.issues);
  const rows = [...result.lineage].reverse().filter((l) => actor === "all" || l.actor === actor);

  return (
    <AppShell
      kicker="Trust"
      title="Data lineage"
      subtitle="Every changed value keeps its original, the rule that changed it, and who made the decision."
    >
      <StoryPipeline openIssues={counts.open} critical={counts.critical} />
      <div className="mb-4 mt-6 flex flex-wrap gap-2">
        {(["all", "system", "reviewer"] as const).map((a) => (
          <Button key={a} size="sm" variant={actor === a ? "default" : "outline"} onClick={() => setActor(a)} className="capitalize">
            {a === "all" ? `All (${result.lineage.length})` : a}
          </Button>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No transformations recorded yet" body="Upload an agricultural dataset to see how each value was standardised." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-secondary text-left">
              <tr>
                {["When", "Stage", "Record", "Field", "Original", "Transformed", "Rule", "Decision"].map((h) => (
                  <th key={h} className="p-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 300).map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="p-3 whitespace-nowrap text-xs text-muted-foreground">{new Date(l.timestamp).toLocaleString()}</td>
                  <td className="p-3">{l.stage}</td>
                  <td className="p-3">{l.recordId}</td>
                  <td className="p-3">{l.field}</td>
                  <td className="p-3 text-muted-foreground line-through">{l.before}</td>
                  <td className="p-3 font-medium">{l.after}</td>
                  <td className="p-3 text-xs">{l.rule}</td>
                  <td className="p-3 capitalize">{l.actor === "reviewer" ? "Person" : "System"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 300 && <p className="mt-2 text-xs text-muted-foreground">Showing the latest 300 of {rows.length} changes.</p>}
    </AppShell>
  );
}
