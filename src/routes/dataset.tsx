import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell, Stat } from "@/components/AppShell";
import { EmptyState, qualityLabel } from "@/components/minagri/visuals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downloadFile, toCsv } from "@/lib/minagri/csv";
import { useAnalysis } from "@/lib/minagri/store";

export const Route = createFileRoute("/dataset")({
  head: () => ({
    meta: [
      { title: "Trusted Dataset — MINAGRI Data Intelligence" },
      { name: "description", content: "Validated agricultural prices ready to export." },
      { property: "og:title", content: "Trusted Dataset — MINAGRI Data Intelligence" },
      { property: "og:description", content: "Validated agricultural prices ready to export." },
    ],
  }),
  component: Dataset,
});

function Dataset() {
  const { result, score } = useAnalysis();
  const [q, setQ] = useState("");
  const blocked = useMemo(() => {
    const s = new Set<string>();
    result.issues.forEach((i) => {
      if (i.status === "open" && (i.severity === "critical" || i.severity === "high")) s.add(i.recordId);
      if (i.status === "corrected" && i.category === "duplicate") s.add(i.recordId);
    });
    return s;
  }, [result.issues]);
  const trusted = result.records.filter((r) => !blocked.has(r.id) && r.price != null);
  const criticalOpen = result.issues.filter((i) => i.status === "open" && i.severity === "critical").length;
  const reviewed = result.issues.filter((i) => i.status !== "open").length;
  const shown = trusted.filter((r) => !q || `${r.market} ${r.commodity} ${r.district}`.toLowerCase().includes(q.toLowerCase()));

  const rows = trusted.map((r) => [r.date, r.province, r.district, r.market, r.commodity, r.channel, r.unit, r.price, r.currency, r.corrected ? "yes" : "no"]);
  const headers = ["date", "province", "district", "market", "commodity", "channel", "unit", "price", "currency", "corrected"];

  const exportCsv = () => downloadFile("minagri-trusted.csv", toCsv(headers, rows), "text/csv");
  const exportJson = () =>
    downloadFile(
      "minagri-trusted.json",
      JSON.stringify(
        trusted.map((r) => ({
          date: r.date,
          province: r.province,
          district: r.district,
          market: r.market,
          commodity: r.commodity,
          channel: r.channel,
          unit: r.unit,
          price: r.price,
          currency: r.currency,
          corrected: Boolean(r.corrected),
        })),
        null,
        2,
      ),
      "application/json",
    );

  return (
    <AppShell
      kicker="Destination"
      title="Trusted dataset"
      subtitle="Records with a price and no open critical or high issues. Raw values remain in data lineage."
    >
      <section className="rounded-lg bg-primary px-6 py-6 text-primary-foreground">
        <div className="text-sm font-medium text-accent-green">Trusted dataset</div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-xs text-white/60">Data quality</div>
            <div className="text-3xl font-bold">{score.total} / 100</div>
            <div className="text-sm text-white/70">{qualityLabel(score.total)}</div>
          </div>
          <div>
            <div className="text-xs text-white/60">Records</div>
            <div className="text-3xl font-bold">{result.records.length.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-white/60">Validated</div>
            <div className="text-3xl font-bold">{trusted.length.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-white/60">Critical issues</div>
            <div className="text-3xl font-bold">{criticalOpen}</div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button className="bg-accent-green text-primary hover:bg-accent-green/90" onClick={exportCsv}>
            Download CSV
          </Button>
          <Button variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={exportJson}>
            Export JSON
          </Button>
          <Button asChild variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white">
            <a href="#records">Explore dataset</a>
          </Button>
          <Button asChild variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white">
            <Link to="/" hash="quality">
              View quality report
            </Link>
          </Button>
        </div>
      </section>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Raw" value={result.profile.rows.toLocaleString()} hint="Rows read from the file" />
        <Stat label="Processed" value={result.records.length.toLocaleString()} hint="Standardised records" />
        <Stat label="Reviewed" value={reviewed} hint="Human decisions recorded" />
        <Stat label="Trusted" value={trusted.length.toLocaleString()} hint="Released for use" />
      </div>

      <div id="records" className="my-4 flex flex-wrap gap-2">
        <Input placeholder="Search market, commodity, district…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" aria-label="Search trusted records" />
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title="No trusted records match this view"
          body="Resolve critical and high issues in Review Center to release more rows, or clear the search."
          action={
            <Button asChild>
              <Link to="/review">Go to Review Center</Link>
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-secondary text-left">
              <tr>
                {["Date", "District", "Market", "Commodity", "Channel", "Unit", "Price"].map((h) => (
                  <th key={h} className="p-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 300).map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="p-3">{r.date}</td>
                  <td className="p-3">{r.district}</td>
                  <td className="p-3">{r.market}</td>
                  <td className="p-3">
                    {r.commodity}
                    {r.corrected && <span className="ml-2 rounded-full bg-soft px-2 py-0.5 text-xs font-medium text-primary">Corrected</span>}
                  </td>
                  <td className="p-3 capitalize">{r.channel}</td>
                  <td className="p-3">{r.unit}</td>
                  <td className="p-3 text-right font-medium">{r.price == null ? "No data" : `${r.price.toLocaleString()} RWF`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shown.length > 300 && <p className="mt-2 text-xs text-muted-foreground">Showing 300 of {shown.length}. Download CSV for every trusted row.</p>}
    </AppShell>
  );
}
