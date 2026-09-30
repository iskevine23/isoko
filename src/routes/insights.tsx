import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell, Panel } from "@/components/AppShell";
import { EmptyState } from "@/components/minagri/visuals";
import { SearchSelect } from "@/components/ui/search-select";
import { CHANNEL_LABEL } from "@/lib/minagri/catalog";
import { median } from "@/lib/minagri/stats";
import { useAnalysis } from "@/lib/minagri/store";

export const Route = createFileRoute("/insights")({
  head: () => ({
    meta: [
      { title: "Insights — MINAGRI Data Intelligence" },
      {
        name: "description",
        content: "Farm, wholesale, and retail prices across reporting markets.",
      },
      { property: "og:title", content: "Insights — MINAGRI Data Intelligence" },
      {
        property: "og:description",
        content: "Farm, wholesale, and retail prices across reporting markets.",
      },
    ],
  }),
  component: Insights,
});

const FARM = "#4F9D52";
const WHOLESALE = "#2563EB";
const RETAIL = "#8B5CF6";

function Insights() {
  const { result } = useAnalysis();
  const recs = result.records.filter(
    (r) => r.price != null && r.price > 0 && r.commodity && r.date,
  );
  const commodities = useMemo(
    () => Array.from(new Set(recs.map((r) => r.commodity))).sort(),
    [recs],
  );
  const [c, setC] = useState("");
  const commodity = c || commodities[0] || "";

  const trend = useMemo(() => {
    const byDate = new Map<string, Record<string, number[]>>();
    recs
      .filter((r) => r.commodity === commodity)
      .forEach((r) => {
        const bucket = byDate.get(r.date) ?? {};
        (bucket[r.channel] ??= []).push(r.price!);
        byDate.set(r.date, bucket);
      });
    return Array.from(byDate.entries())
      .sort()
      .map(([date, v]) => ({
        date: date.slice(5),
        farmgate: v.farmgate ? median(v.farmgate) : null,
        wholesale: v.wholesale ? median(v.wholesale) : null,
        retail: v.retail ? median(v.retail) : null,
      }));
  }, [recs, commodity]);

  const ladder = useMemo(() => {
    return (["farmgate", "wholesale", "retail"] as const).map((channel) => {
      const values = recs
        .filter((r) => r.commodity === commodity && r.channel === channel)
        .map((r) => r.price!);
      return {
        channel,
        label: CHANNEL_LABEL[channel] ?? channel,
        n: values.length,
        median: values.length ? median(values) : null,
      };
    });
  }, [recs, commodity]);

  const margins = useMemo(
    () =>
      commodities
        .map((name) => {
          const farm = recs
            .filter((r) => r.commodity === name && r.channel === "farmgate")
            .map((r) => r.price!);
          const retail = recs
            .filter((r) => r.commodity === name && r.channel === "retail")
            .map((r) => r.price!);
          if (!farm.length || !retail.length) return null;
          const fm = median(farm);
          const rm = median(retail);
          if (!fm) return null;
          return {
            name,
            margin: Math.round(((rm - fm) / fm) * 100),
            farm: Math.round(fm),
            retail: Math.round(rm),
          };
        })
        .filter(
          (row): row is { name: string; margin: number; farm: number; retail: number } =>
            row != null,
        )
        .sort((a, b) => b.margin - a.margin)
        .slice(0, 12),
    [recs, commodities],
  );

  const violation = result.issues.find(
    (i) =>
      i.status === "open" &&
      i.type === "LADDER_VIOLATION" &&
      i.explanation.toLowerCase().includes(commodity.toLowerCase()),
  );
  const marketsReporting = new Set(
    recs.filter((r) => r.commodity === commodity).map((r) => r.market),
  ).size;

  if (!commodity) {
    return (
      <AppShell
        kicker="Price intelligence"
        title="Insights"
        subtitle="Median prices from the current dataset."
      >
        <EmptyState
          title="No priced observations yet"
          body="Upload an agricultural dataset to begin analysis. Rows without a price are kept out of these charts."
        />
      </AppShell>
    );
  }

  return (
    <AppShell
      kicker="Price intelligence"
      title="Insights"
      subtitle="Median prices from records that actually have a price. Missing observations stay blank."
    >
      <div className="mb-4 max-w-xs text-sm font-medium">
        <span aria-hidden>Commodity</span>
        <SearchSelect
          aria-label="Commodity"
          value={commodity}
          onChange={setC}
          options={commodities.map((name) => ({ value: name, label: name }))}
          searchPlaceholder="Search commodity…"
          className="mt-1"
        />
      </div>

      <Panel title={`Farm to retail — ${commodity}`}>
        <div className="grid gap-3 md:grid-cols-3">
          {ladder.map((step, index) => {
            const prev = ladder[index - 1];
            const markup =
              prev?.median && step.median
                ? Math.round(((step.median - prev.median) / prev.median) * 100)
                : null;
            const inverted =
              prev?.median != null && step.median != null && step.median < prev.median;
            return (
              <div
                key={step.channel}
                className={`rounded-lg border p-4 ${inverted ? "border-warning bg-warning/10" : "border-border bg-secondary/40"}`}
              >
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {step.label}
                </div>
                <div className="mt-2 text-2xl font-bold">
                  {step.median == null
                    ? "No data"
                    : `${Math.round(step.median).toLocaleString()} RWF`}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {step.n === 0 ? "No observations" : `${step.n} observations`}
                </div>
                {markup != null && (
                  <div
                    className={`mt-3 text-sm font-medium ${inverted ? "text-amber-800" : "text-primary"}`}
                  >
                    {inverted
                      ? "Pricing ladder inconsistency"
                      : `${markup >= 0 ? "+" : ""}${markup}% from ${prev?.label.toLowerCase()}`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {violation && <p className="mt-4 text-sm text-amber-800">⚠ {violation.explanation}</p>}
        <p className="mt-3 text-xs text-muted-foreground">
          {marketsReporting} markets reported {commodity}. Markets that did not report are omitted —
          they are not shown as 0 RWF.
        </p>
      </Panel>

      <Panel title={`Median price by channel — ${commodity}`} className="mt-6">
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d7e5d8" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip
                formatter={(value) =>
                  value == null ? "No data" : `${Number(value).toLocaleString()} RWF`
                }
              />
              <Legend />
              <Line
                dataKey="farmgate"
                name="Farm gate"
                stroke={FARM}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
              <Line
                dataKey="wholesale"
                name="Wholesale"
                stroke={WHOLESALE}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
              <Line
                dataKey="retail"
                name="Retail"
                stroke={RETAIL}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel title="Farm-gate to retail markup" className="mt-6">
        <p className="mb-3 text-sm text-muted-foreground">
          Only commodities with both a farm-gate and a retail observation. A negative bar means
          retail sits below farm gate.
        </p>
        <div className="h-80 w-full">
          <ResponsiveContainer>
            <BarChart data={margins} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d7e5d8" />
              <XAxis type="number" fontSize={12} unit="%" />
              <YAxis type="category" dataKey="name" fontSize={12} width={120} />
              <Tooltip
                formatter={(value, _name, item) => [
                  `${value}%  ·  farm ${item.payload.farm.toLocaleString()} → retail ${item.payload.retail.toLocaleString()} RWF`,
                  "Markup",
                ]}
              />
              <Bar dataKey="margin" name="Markup" radius={[0, 8, 8, 0]}>
                {margins.map((row) => (
                  <Cell key={row.name} fill={row.margin < 0 ? "#DC2626" : FARM} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    </AppShell>
  );
}
