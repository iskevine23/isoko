import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CheckCircle2,
  Database,
  Download,
  ShieldCheck,
  Store,
  Wheat,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell, Panel } from "@/components/AppShell";
import { pageTitle } from "@/lib/brand";
import { DraftBanner } from "@/components/minagri/DraftBanner";
import { SearchSelect } from "@/components/ui/search-select";
import { Button } from "@/components/ui/button";
import { CHANNEL_LABEL, MARKETS } from "@/lib/minagri/catalog";
import { RwandaPriceMap } from "@/components/minagri/RwandaPriceMap";
import { matchProvince, projectRwanda, RWANDA_PROVINCES } from "@/lib/minagri/rwanda-map";
import { downloadFile, toCsv } from "@/lib/minagri/csv";
import { MODEL_CARD } from "@/lib/minagri/ml/price-model";
import { issueCounts } from "@/lib/minagri/scoring";
import { median } from "@/lib/minagri/stats";
import { useAnalysis } from "@/lib/minagri/store";
import type { AnalysisResult, DataRecord } from "@/lib/minagri/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: pageTitle("Dashboard") },
      {
        name: "description",
        content: "Clean agricultural price statistics, and a summary when review is still pending.",
      },
      { property: "og:title", content: pageTitle("Dashboard") },
      {
        property: "og:description",
        content: "Clean agricultural price statistics, and a summary when review is still pending.",
      },
    ],
  }),
  component: Dashboard,
});

const CHANNELS = ["farmgate", "wholesale", "retail"] as const;
const COLOR = { farmgate: "#4F9D52", wholesale: "#2563EB", retail: "#8B5CF6" } as const;
const AXIS = { fill: "#64748B", fontSize: 12 };
const GRID = "#E6EEE7";
const TOOLTIP = {
  borderRadius: 8,
  border: "1px solid #d7e5d8",
  fontSize: 13,
  boxShadow: "0 4px 12px rgb(16 42 27 / 0.08)",
};

function splitRecords(result: AnalysisResult) {
  const blocked = new Set<string>();
  for (const issue of result.issues) {
    if (issue.status === "open" && (issue.severity === "critical" || issue.severity === "high"))
      blocked.add(issue.recordId);
    if (issue.status === "corrected" && issue.category === "duplicate") blocked.add(issue.recordId);
  }
  const clean: DataRecord[] = [];
  let held = 0;
  let noPrice = 0;
  for (const r of result.records) {
    if (r.price == null || r.price <= 0) noPrice++;
    else if (blocked.has(r.id)) held++;
    else clean.push(r);
  }
  return { clean, held, noPrice };
}

const fmt = (n: number) => n.toLocaleString();

function Dashboard() {
  const { result, score } = useAnalysis();
  const counts = issueCounts(result.issues);
  const { clean, held, noPrice } = useMemo(() => splitRecords(result), [result]);
  const total = Math.max(1, result.records.length);
  const cleanPct = Math.round((clean.length / total) * 100);

  const commodities = useMemo(() => {
    const tally = new Map<string, number>();
    for (const row of clean) tally.set(row.commodity, (tally.get(row.commodity) ?? 0) + 1);
    return [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [clean]);
  const [picked, setPicked] = useState("");
  const commodity = picked && commodities.includes(picked) ? picked : (commodities[0] ?? "");
  const [province, setProvince] = useState<string | null>(null);
  const [mapChannel, setMapChannel] = useState<(typeof CHANNELS)[number]>("retail");

  const markets = useMemo(() => new Set(clean.map((r) => r.market)).size, [clean]);
  const coveragePct = Math.round(
    (result.coverage.reportingMarkets / Math.max(1, result.coverage.totalMarkets)) * 100,
  );

  const trend = useMemo(() => {
    const byDate = new Map<string, Record<string, number[]>>();
    for (const row of clean) {
      if (row.commodity !== commodity || !row.date) continue;
      if (province && matchProvince(row.province) !== province) continue;
      const bucket = byDate.get(row.date) ?? {};
      (bucket[row.channel] ??= []).push(row.price!);
      byDate.set(row.date, bucket);
    }
    return [...byDate.entries()].sort().map(([date, values]) => ({
      date: date.slice(5),
      farmgate: values.farmgate ? Math.round(median(values.farmgate)) : null,
      wholesale: values.wholesale ? Math.round(median(values.wholesale)) : null,
      retail: values.retail ? Math.round(median(values.retail)) : null,
    }));
  }, [clean, commodity, province]);

  const ladder = useMemo(
    () =>
      CHANNELS.map((channel) => {
        const values = clean
          .filter(
            (r) =>
              r.commodity === commodity &&
              r.channel === channel &&
              (!province || matchProvince(r.province) === province),
          )
          .map((r) => r.price!);
        return {
          channel,
          n: values.length,
          median: values.length ? Math.round(median(values)) : null,
        };
      }),
    [clean, commodity, province],
  );

  const priceUnit =
    clean.find((r) => r.commodity === commodity && r.channel === mapChannel && r.unit)?.unit ??
    clean.find((r) => r.commodity === commodity && r.unit)?.unit ??
    "";

  const priceMap = useMemo(() => {
    const prices = new Map<string, number[]>();
    const marketSets = new Map<string, Set<string>>();
    const byMarket = new Map<string, { province: string; prices: number[] }>();
    for (const row of clean) {
      if (row.commodity !== commodity || row.channel !== mapChannel || row.price == null) continue;
      const name = matchProvince(row.province);
      if (!name) continue;
      const list = prices.get(name) ?? [];
      list.push(row.price);
      prices.set(name, list);
      const seen = marketSets.get(name) ?? new Set<string>();
      seen.add(row.market);
      marketSets.set(name, seen);
      const bucket = byMarket.get(row.market) ?? { province: name, prices: [] };
      bucket.prices.push(row.price);
      byMarket.set(row.market, bucket);
    }
    const located = new Map(MARKETS.map((m) => [m.name.toLowerCase(), m]));
    const dots = [];
    for (const [market, bucket] of byMarket) {
      const info = located.get(market.toLowerCase());
      if (!info) continue;
      const [x, y] = projectRwanda(info.lng, info.lat);
      dots.push({
        name: market,
        province: bucket.province,
        district: info.district,
        x,
        y,
        median: Math.round(median(bucket.prices)),
        observations: bucket.prices.length,
      });
    }
    return {
      provinces: RWANDA_PROVINCES.map((shape) => {
        const values = prices.get(shape.name) ?? [];
        return {
          name: shape.name,
          median: values.length ? Math.round(median(values)) : null,
          observations: values.length,
          markets: marketSets.get(shape.name)?.size ?? 0,
        };
      }),
      dots,
    };
  }, [clean, commodity, mapChannel]);

  const mix = CHANNELS.map((channel) => ({
    channel,
    name: CHANNEL_LABEL[channel],
    value: clean.filter((r) => r.channel === channel).length,
  }));

  const pending = [
    {
      label: "Critical",
      count: counts.critical,
      search: { focus: "critical" as const },
      tone: "text-red-700 bg-red-50 ring-red-200",
    },
    {
      label: "Price anomalies",
      count: counts.anomalies,
      search: { cat: "anomaly" as const },
      tone: "text-amber-800 bg-amber-50 ring-amber-200",
    },
    {
      label: "Price conflicts",
      count: counts.conflicts,
      search: { cat: "conflict" as const },
      tone: "text-amber-800 bg-amber-50 ring-amber-200",
    },
    {
      label: "Duplicates",
      count: counts.duplicates,
      search: { cat: "duplicate" as const },
      tone: "text-foreground bg-secondary ring-border",
    },
    {
      label: "Name matches",
      count: counts.matches,
      search: { cat: "match" as const },
      tone: "text-info bg-info/10 ring-info/20",
    },
  ].filter((p) => p.count > 0);

  const downloadClean = () =>
    downloadFile(
      "e-biciro-clean.csv",
      toCsv(
        [
          "date",
          "province",
          "district",
          "market",
          "commodity",
          "channel",
          "unit",
          "price",
          "currency",
          "corrected",
        ],
        clean.map((r) => [
          r.date,
          r.province,
          r.district,
          r.market,
          r.commodity,
          r.channel,
          r.unit,
          r.price,
          r.currency,
          r.corrected ? "yes" : "no",
        ]),
      ),
      "text/csv",
    );

  const range = result.profile.dateCoverage.from
    ? `${result.profile.dateCoverage.from} to ${result.profile.dateCoverage.to}`
    : "No dates detected";

  const forest = result.ml.isolationForest;

  return (
    <AppShell
      title="Dashboard"
      subtitle={`${result.datasetName} · ${range}`}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={downloadClean} disabled={clean.length === 0}>
            <Download aria-hidden />
            Clean CSV
          </Button>
          <Button asChild variant="outline">
            <Link to="/upload">Upload dataset</Link>
          </Button>
        </div>
      }
    >
      <DraftBanner className="mb-4" />
      <section className="grid gap-4 rounded-lg border border-border bg-card p-5 shadow-sm lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:p-6">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-section-title">Clean data</h2>
            {result.isDemo && (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                Test file
              </span>
            )}
          </div>
          <div className="mt-3 flex items-end gap-3">
            <span className="font-[family-name:var(--font-display)] text-5xl font-bold tracking-tight text-primary">
              {cleanPct}%
            </span>
            <span className="mb-1.5 text-sm text-muted-foreground">
              {fmt(clean.length)} of {fmt(result.records.length)} records ready to use
            </span>
          </div>
          <div
            className="mt-4 flex h-3 overflow-hidden rounded-full bg-secondary"
            role="img"
            aria-label={`${clean.length} clean, ${held} waiting for review, ${noPrice} without a price`}
          >
            <div
              className="bar-grow bg-agri"
              style={{ width: `${(clean.length / total) * 100}%` }}
            />
            <div className="bar-grow bg-warning" style={{ width: `${(held / total) * 100}%` }} />
            <div
              className="bar-grow bg-slate-300"
              style={{ width: `${(noPrice / total) * 100}%` }}
            />
          </div>
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <Legend color="bg-agri" label="Clean" value={clean.length} />
            <Legend color="bg-warning" label="Waiting for review" value={held} />
            <Legend color="bg-slate-300" label="No price recorded" value={noPrice} />
          </dl>
        </div>

        <div className="rounded-lg bg-secondary/60 p-4">
          {counts.open > 0 ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Pending review</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {fmt(counts.open)} items need a decision · {fmt(counts.resolved)} already
                    resolved
                  </p>
                </div>
                <Button asChild size="sm">
                  <Link to="/review">
                    Start review
                    <ArrowRight aria-hidden />
                  </Link>
                </Button>
              </div>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {pending.map((p) => (
                  <li key={p.label}>
                    <Link
                      to="/review"
                      search={p.search}
                      className="flex items-center justify-between rounded-md bg-card px-3 py-2 text-sm shadow-sm ring-1 ring-border transition-colors hover:ring-primary/40"
                    >
                      <span>{p.label}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${p.tone}`}
                      >
                        {p.count}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="flex h-full flex-col justify-center">
              <div className="flex items-center gap-2 text-primary">
                <CheckCircle2 className="h-5 w-5" aria-hidden />
                <h2 className="text-sm font-semibold">Nothing waiting for review</h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Every flagged item has a decision. The clean set is ready to share.
              </p>
              <div className="mt-4">
                <Button onClick={downloadClean}>
                  <Download aria-hidden />
                  Download clean CSV
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={<Database aria-hidden />}
          label="Clean records"
          value={fmt(clean.length)}
          hint={`${fmt(result.records.length)} rows read`}
        />
        <Kpi
          icon={<Wheat aria-hidden />}
          label="Commodities"
          value={fmt(commodities.length)}
          hint="With a clean price"
        />
        <Kpi
          icon={<Store aria-hidden />}
          label="Markets"
          value={fmt(markets)}
          hint={`${result.coverage.reportingMarkets} of ${result.coverage.totalMarkets} registered reporting (${coveragePct}%)`}
        />
        <Kpi
          icon={<ShieldCheck aria-hidden />}
          label="Quality score"
          value={`${score.total}`}
          suffix="/100"
          hint="Rises as review is cleared"
          ring={score.total}
        />
      </div>

      <div className="mt-4">
        <Panel
          title={commodity ? `${commodity} across Rwanda` : "Prices across Rwanda"}
          action={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div
                className="flex rounded-md border border-border p-0.5"
                role="group"
                aria-label="Price channel"
              >
                {CHANNELS.map((channel) => (
                  <button
                    key={channel}
                    type="button"
                    aria-pressed={mapChannel === channel}
                    onClick={() => setMapChannel(channel)}
                    className={`rounded-[5px] px-2.5 py-1 text-xs font-medium ${
                      mapChannel === channel
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {CHANNEL_LABEL[channel]}
                  </button>
                ))}
              </div>
              {commodities.length > 0 && (
                <SearchSelect
                  aria-label="Commodity"
                  value={commodity}
                  onChange={setPicked}
                  options={commodities.map((name) => ({ value: name, label: name }))}
                  searchPlaceholder="Search commodity…"
                  className="h-9 w-52"
                />
              )}
            </div>
          }
        >
          {commodity ? (
            <RwandaPriceMap
              commodity={commodity}
              unit={priceUnit}
              provinces={priceMap.provinces}
              dots={priceMap.dots}
              selected={province}
              onSelect={setProvince}
            />
          ) : (
            <Empty text="No clean prices yet." />
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title={
            province ? `Median price over time · ${province.replace(" Province", "")}` : "Median price over time"
          }
          action={
            commodities.length > 0 ? (
              <SearchSelect
                aria-label="Commodity"
                value={commodity}
                onChange={setPicked}
                options={commodities.map((name) => ({ value: name, label: name }))}
                searchPlaceholder="Search commodity…"
                className="h-9 w-52"
              />
            ) : null
          }
        >
          {trend.length === 0 ? (
            <Empty
              text={
                province
                  ? `No clean prices for ${commodity} in ${province}.`
                  : "No clean prices for this commodity yet."
              }
            />
          ) : (
            <>
              <div className="h-64">
                <ResponsiveContainer>
                  <AreaChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      {CHANNELS.map((c) => (
                        <linearGradient key={c} id={`fill-${c}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={COLOR[c]} stopOpacity={0.18} />
                          <stop offset="100%" stopColor={COLOR[c]} stopOpacity={0} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="date" tick={AXIS} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={AXIS}
                      axisLine={false}
                      tickLine={false}
                      width={52}
                      tickFormatter={(v) => fmt(Number(v))}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP}
                      formatter={(value, name) => [
                        value == null ? "No data" : `${fmt(Number(value))} RWF`,
                        name,
                      ]}
                    />
                    {CHANNELS.map((c) => (
                      <Area
                        key={c}
                        type="monotone"
                        dataKey={c}
                        name={CHANNEL_LABEL[c]}
                        stroke={COLOR[c]}
                        strokeWidth={2}
                        fill={`url(#fill-${c})`}
                        dot={false}
                        activeDot={{ r: 4 }}
                        connectNulls={false}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <ChannelKey />
            </>
          )}
        </Panel>

        <Panel
          title={
            commodity
              ? `Price ladder · ${commodity}${province ? ` · ${province.replace(" Province", "")}` : ""}`
              : "Price ladder"
          }
        >
          <ol className="space-y-2">
            {ladder.map((step, i) => {
              const prev = ladder[i - 1];
              const markup =
                prev?.median && step.median
                  ? Math.round(((step.median - prev.median) / prev.median) * 100)
                  : null;
              const inverted = markup != null && markup < 0;
              return (
                <li key={step.channel}>
                  {markup != null && (
                    <div
                      className={`py-1 pl-4 text-xs font-medium ${inverted ? "text-amber-800" : "text-muted-foreground"}`}
                    >
                      {inverted
                        ? `⚠ ${Math.abs(markup)}% lower than ${CHANNEL_LABEL[prev!.channel].toLowerCase()}`
                        : `+${markup}% markup`}
                    </div>
                  )}
                  <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
                    <span className="flex items-center gap-2 text-sm">
                      <i
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: COLOR[step.channel] }}
                      />
                      {CHANNEL_LABEL[step.channel]}
                    </span>
                    <span className="text-right">
                      <span className="block text-sm font-semibold">
                        {step.median == null ? "No data" : `${fmt(step.median)} RWF`}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {step.n ? `${step.n} observations` : "Not reported"}
                      </span>
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">
            Medians from clean records. Missing channels are not treated as zero.
          </p>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Clean records by channel">
          {clean.length === 0 ? (
            <Empty text="No clean records yet." />
          ) : (
            <>
              <div className="relative h-48">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={mix}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={58}
                      outerRadius={82}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {mix.map((m) => (
                        <Cell key={m.channel} fill={COLOR[m.channel]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={TOOLTIP}
                      formatter={(value, name) => [`${fmt(Number(value))} records`, name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                  <div>
                    <div className="text-2xl font-bold">{fmt(clean.length)}</div>
                    <div className="text-xs text-muted-foreground">clean records</div>
                  </div>
                </div>
              </div>
              <ul className="mt-2 space-y-1.5 text-sm">
                {mix.map((m) => (
                  <li key={m.channel} className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <i
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: COLOR[m.channel] }}
                      />
                      {m.name}
                    </span>
                    <span className="font-medium">
                      {fmt(m.value)}{" "}
                      <span className="text-muted-foreground">
                        · {Math.round((m.value / Math.max(1, clean.length)) * 100)}%
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>

        <Panel className="lg:col-span-2" title="Market coverage by province">
          <ul className="space-y-3.5">
            {result.coverage.provinces.map((p) => {
              const pct = Math.round((p.reporting / Math.max(1, p.markets)) * 100);
              return (
                <li key={p.name}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted-foreground">
                      {p.reporting === 0
                        ? "No reports"
                        : `${p.reporting} of ${p.markets} markets · ${fmt(p.observations)} rows`}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="bar-grow h-2 rounded-full bg-agri"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-sm font-semibold">{pct}%</span>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            {result.coverage.reportingMarkets} of {result.coverage.totalMarkets} registered markets
            reported. A market without a report is missing data, not a zero price.
          </p>
        </Panel>
      </div>

      <section className="mt-4 rounded-lg border border-border bg-card px-5 py-4 shadow-sm">
        <h2 className="text-sm font-semibold">How this data was checked</h2>
        <dl className="mt-3 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <Check
            label="Rows scored by Isolation Forest"
            value={forest.applied ? fmt(forest.recordsScored) : "Not run"}
          />
          <Check
            label="Outliers confirmed by rules"
            value={forest.applied ? fmt(forest.corroborated) : "—"}
          />
          <Check
            label="Extra outliers found by model"
            value={forest.applied ? fmt(forest.newIssues) : "—"}
          />
          <Check
            label="Uncertain names checked by TF-IDF model"
            value={fmt(result.ml.entityEmbeddings.rowsCompared)}
          />
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          {forest.applied
            ? forest.origin === "trained"
              ? `Price model: Isolation Forest (${forest.trees} trees) trained on ${forest.trainedOn}, ${new Date(forest.trainedAt).toLocaleDateString()}. Rows scoring above ${forest.threshold} are unusual.`
              : forest.note
            : forest.note}
        </p>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium text-primary">Measured accuracy</summary>
          <p className="mt-2 text-xs text-muted-foreground">
            {MODEL_CARD.priceModel.evaluation.protocol}
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-4 font-medium">Injected error</th>
                  <th className="py-1.5 pr-4 font-medium">Robust z-score</th>
                  <th className="py-1.5 pr-4 font-medium">Isolation Forest</th>
                  <th className="py-1.5 font-medium">All checks together</th>
                </tr>
              </thead>
              <tbody>
                {MODEL_CARD.priceModel.evaluation.byType.map((r) => (
                  <tr key={r.type} className="border-t border-border">
                    <td className="py-1.5 pr-4">{r.type}</td>
                    <td className="py-1.5 pr-4">{r.statisticalRecall}%</td>
                    <td className="py-1.5 pr-4">{r.forestRecall}%</td>
                    <td className="py-1.5 font-semibold">{r.hybridRecall}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Share of error-free rows sent to review:{" "}
            {MODEL_CARD.priceModel.evaluation.untouchedFlagRate.hybrid}%. Name matching:{" "}
            {MODEL_CARD.entityMatcher.evaluation.commodity.withTfidfCheck.autoAcceptPrecision}% of
            automatic commodity matches and{" "}
            {MODEL_CARD.entityMatcher.evaluation.market.withTfidfCheck.autoAcceptPrecision}% of
            automatic market matches were correct on misspelled catalog names.
          </p>
        </details>
      </section>
    </AppShell>
  );
}

function Kpi({
  icon,
  label,
  value,
  suffix,
  hint,
  ring,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  suffix?: string;
  hint: string;
  ring?: number;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground [&_svg]:size-4 [&_svg]:text-agri">
          {icon}
          {label}
        </div>
        <div className="mt-2 text-3xl font-bold tracking-tight">
          {value}
          {suffix && (
            <span className="ml-0.5 text-base font-medium text-muted-foreground">{suffix}</span>
          )}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      </div>
      {ring != null && (
        <div
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full"
          style={{ background: `conic-gradient(#4F9D52 ${ring * 3.6}deg, #E8FBE6 0deg)` }}
          aria-hidden
        >
          <div className="h-9 w-9 rounded-full bg-card" />
        </div>
      )}
    </div>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <i className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{fmt(value)}</dd>
    </div>
  );
}

function Check({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold">{value}</dd>
    </div>
  );
}

function ChannelKey() {
  return (
    <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
      {CHANNELS.map((c) => (
        <span key={c} className="flex items-center gap-1.5">
          <i className="inline-block h-2 w-2 rounded-full" style={{ background: COLOR[c] }} />
          {CHANNEL_LABEL[c]}
        </span>
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="grid h-48 place-items-center text-sm text-muted-foreground">{text}</p>;
}
