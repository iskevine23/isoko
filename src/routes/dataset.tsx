import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { AppShell, Stat } from "@/components/AppShell";
import { pageTitle } from "@/lib/brand";
import { EmptyState, qualityLabel } from "@/components/minagri/visuals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchSelect, type SearchSelectOption } from "@/components/ui/search-select";
import { CHANNEL_LABEL } from "@/lib/minagri/catalog";
import { downloadFile, toCsv } from "@/lib/minagri/csv";
import { useAnalysis } from "@/lib/minagri/store";
import type { DataRecord, PriceChannel } from "@/lib/minagri/types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
const CHANNEL_ORDER: PriceChannel[] = ["farmgate", "wholesale", "retail"];

type PriceCell = { price: number; corrected: boolean };

type DatasetRow = {
  id: string;
  date: string;
  province: string;
  district: string;
  market: string;
  commodity: string;
  unit: string;
  currency: string;
  prices: Partial<Record<string, PriceCell>>;
};

function groupRecords(records: DataRecord[]): DatasetRow[] {
  const map = new Map<string, DatasetRow>();
  for (const record of records) {
    const key = [record.date, record.province, record.district, record.market, record.commodity, record.unit, record.currency].join("\u0000");
    let row = map.get(key);
    if (!row) {
      row = {
        id: key,
        date: record.date,
        province: record.province,
        district: record.district,
        market: record.market,
        commodity: record.commodity,
        unit: record.unit,
        currency: record.currency || "RWF",
        prices: {},
      };
      map.set(key, row);
    }
    if (record.channel && record.price != null) {
      const prev = row.prices[record.channel];
      if (!prev || (record.corrected && !prev.corrected)) {
        row.prices[record.channel] = { price: record.price, corrected: Boolean(record.corrected) };
      }
    }
  }
  return [...map.values()].sort(
    (a, b) => b.date.localeCompare(a.date) || a.commodity.localeCompare(b.commodity) || a.market.localeCompare(b.market),
  );
}

function groupMatches(row: DatasetRow, filters: Filters) {
  if (filters.channel && row.prices[filters.channel] == null) return false;
  const corrected = Object.values(row.prices).some((cell) => cell?.corrected);
  if (filters.corrected === "yes" && !corrected) return false;
  if (filters.corrected === "no" && corrected) return false;
  const min = filters.minPrice === "" ? null : Number(filters.minPrice);
  const max = filters.maxPrice === "" ? null : Number(filters.maxPrice);
  if ((min == null || !Number.isFinite(min)) && (max == null || !Number.isFinite(max))) return true;
  const cells = filters.channel ? [row.prices[filters.channel]] : Object.values(row.prices);
  return cells.some((cell) => {
    if (!cell) return false;
    if (min != null && Number.isFinite(min) && cell.price < min) return false;
    if (max != null && Number.isFinite(max) && cell.price > max) return false;
    return true;
  });
}

type Filters = {
  q: string;
  from: string;
  to: string;
  province: string;
  district: string;
  market: string;
  commodity: string;
  channel: string;
  unit: string;
  currency: string;
  corrected: string;
  minPrice: string;
  maxPrice: string;
};

const EMPTY_FILTERS: Filters = {
  q: "",
  from: "",
  to: "",
  province: "",
  district: "",
  market: "",
  commodity: "",
  channel: "",
  unit: "",
  currency: "",
  corrected: "",
  minPrice: "",
  maxPrice: "",
};

function matchRecord(record: DataRecord, filters: Filters, skip: Set<string>) {
  if (!skip.has("q") && filters.q.trim()) {
    const needle = filters.q.trim().toLowerCase();
    const hay = [
      record.date,
      record.province,
      record.district,
      record.market,
      record.commodity,
      record.channel,
      CHANNEL_LABEL[record.channel] ?? "",
      record.unit,
      record.currency,
    ]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  if (!skip.has("from") && filters.from && record.date < filters.from) return false;
  if (!skip.has("to") && filters.to && record.date > filters.to) return false;
  if (!skip.has("province") && filters.province && record.province !== filters.province) return false;
  if (!skip.has("district") && filters.district && record.district !== filters.district) return false;
  if (!skip.has("market") && filters.market && record.market !== filters.market) return false;
  if (!skip.has("commodity") && filters.commodity && record.commodity !== filters.commodity) return false;
  if (!skip.has("channel") && filters.channel && record.channel !== filters.channel) return false;
  if (!skip.has("unit") && filters.unit && record.unit !== filters.unit) return false;
  if (!skip.has("currency") && filters.currency && record.currency !== filters.currency) return false;
  if (!skip.has("corrected")) {
    if (filters.corrected === "yes" && !record.corrected) return false;
    if (filters.corrected === "no" && record.corrected) return false;
  }
  if (!skip.has("price")) {
    const min = filters.minPrice === "" ? null : Number(filters.minPrice);
    const max = filters.maxPrice === "" ? null : Number(filters.maxPrice);
    if (min != null && Number.isFinite(min) && (record.price == null || record.price < min)) return false;
    if (max != null && Number.isFinite(max) && (record.price == null || record.price > max)) return false;
  }
  return true;
}

function facet(
  rows: DataRecord[],
  pick: (record: DataRecord) => string,
  label?: (value: string) => string,
): SearchSelectOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = pick(row).trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" }))
    .map(([value, count]) => ({
      value,
      label: label ? label(value) : value,
      hint: count.toLocaleString(),
    }));
}

function withAll(label: string, options: SearchSelectOption[]): SearchSelectOption[] {
  return [{ value: "", label }, ...options];
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block min-w-0 text-sm", className)}>
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function pageItems(current: number, total: number): Array<number | "gap"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const keep = new Set<number>([1, total, current - 1, current, current + 1]);
  if (current <= 3) {
    keep.add(2);
    keep.add(3);
    keep.add(4);
  }
  if (current >= total - 2) {
    keep.add(total - 3);
    keep.add(total - 2);
    keep.add(total - 1);
  }
  const sorted = [...keep].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const items: Array<number | "gap"> = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) items.push("gap");
    items.push(sorted[i]);
  }
  return items;
}

export const Route = createFileRoute("/dataset")({
  head: () => ({
    meta: [
      { title: pageTitle("Trusted Dataset") },
      { name: "description", content: "Validated agricultural prices ready to export." },
      { property: "og:title", content: pageTitle("Trusted Dataset") },
      { property: "og:description", content: "Validated agricultural prices ready to export." },
    ],
  }),
  component: Dataset,
});

function Dataset() {
  const { result, score } = useAnalysis();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [page, setPage] = useState(1);
  const filterKey = JSON.stringify(filters);
  const [pageKey, setPageKey] = useState(filterKey);
  if (filterKey !== pageKey) {
    setPageKey(filterKey);
    setPage(1);
  }
  const activeFilterCount = Object.values(filters).filter((value) => value !== "").length;
  const filtersActive = activeFilterCount > 0;
  const blocked = useMemo(() => {
    const s = new Set<string>();
    result.issues.forEach((i) => {
      if (i.status === "open" && (i.severity === "critical" || i.severity === "high")) s.add(i.recordId);
      if (i.status === "corrected" && i.category === "duplicate") s.add(i.recordId);
    });
    return s;
  }, [result.issues]);
  const trusted = useMemo(
    () => result.records.filter((r) => !blocked.has(r.id) && r.price != null),
    [result.records, blocked],
  );
  const criticalOpen = result.issues.filter((i) => i.status === "open" && i.severity === "critical").length;
  const reviewed = result.issues.filter((i) => i.status !== "open").length;
  const view = useMemo(() => {
    const base = trusted.filter((record) =>
      matchRecord(record, filters, new Set(["channel", "price", "corrected"])),
    );
    const shown = groupRecords(base).filter((row) => groupMatches(row, filters));
    const extras = new Set<string>();
    for (const row of shown) {
      for (const key of Object.keys(row.prices)) {
        if (!(CHANNEL_ORDER as readonly string[]).includes(key)) extras.add(key);
      }
    }
    const priceColumns = [
      ...CHANNEL_ORDER.map((key) => ({ key, label: CHANNEL_LABEL[key] ?? key })),
      ...[...extras].sort().map((key) => ({ key, label: CHANNEL_LABEL[key] ?? key })),
    ];
    const provinceRows = trusted.filter((record) =>
      matchRecord(record, filters, new Set(["province", "district", "market"])),
    );
    const districtRows = trusted.filter((record) =>
      matchRecord(record, filters, new Set(["district", "market"])),
    );
    const marketRows = trusted.filter((record) => matchRecord(record, filters, new Set(["market"])));
    const commodityRows = trusted.filter((record) => matchRecord(record, filters, new Set(["commodity"])));
    const channelRows = trusted.filter((record) => matchRecord(record, filters, new Set(["channel"])));
    const unitRows = trusted.filter((record) => matchRecord(record, filters, new Set(["unit"])));
    const currencyRows = trusted.filter((record) => matchRecord(record, filters, new Set(["currency"])));
    const correctedRows = trusted.filter((record) => matchRecord(record, filters, new Set(["corrected"])));
    const channels = facet(channelRows, (record) => record.channel, (value) => CHANNEL_LABEL[value] ?? value).sort(
      (a, b) => {
        const ai = CHANNEL_ORDER.indexOf(a.value);
        const bi = CHANNEL_ORDER.indexOf(b.value);
        if (ai === -1 && bi === -1) return a.label.localeCompare(b.label);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      },
    );
    let from = "";
    let to = "";
    for (const record of trusted) {
      if (!record.date) continue;
      if (!from || record.date < from) from = record.date;
      if (!to || record.date > to) to = record.date;
    }
    return {
      shown,
      priceColumns,
      from,
      to,
      provinces: facet(provinceRows, (record) => record.province),
      districts: facet(districtRows, (record) => record.district),
      markets: facet(marketRows, (record) => record.market),
      commodities: facet(commodityRows, (record) => record.commodity),
      channels,
      units: facet(unitRows, (record) => record.unit),
      currencies: facet(currencyRows, (record) => record.currency),
      corrected: correctedRows.filter((record) => record.corrected).length,
      unchanged: correctedRows.filter((record) => !record.corrected).length,
    };
  }, [trusted, filters]);
  const shown = view.shown;
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const start = shown.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE;
  const pageRows = shown.slice(start, start + PAGE_SIZE);

  const goTo = (next: number) => {
    const target = Math.min(Math.max(1, next), pageCount);
    setPage(target);
    document.getElementById("records")?.scrollIntoView({ block: "nearest" });
  };

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
      subtitle="Each row is one market observation. Farm gate, wholesale, and retail prices are shown in their own columns."
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

      <div id="records" className="my-4 rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className={cn("flex flex-wrap items-center justify-between gap-2", filtersOpen && "mb-3")}>
          <button
            type="button"
            className="flex items-center gap-2 rounded-md text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            aria-expanded={filtersOpen}
            aria-controls="dataset-filters"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", !filtersOpen && "-rotate-90")} aria-hidden />
            Filters
            {!filtersOpen && activeFilterCount > 0 && (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {activeFilterCount} active
              </span>
            )}
          </button>
          {filtersActive && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
              Clear filters
            </Button>
          )}
        </div>
        {filtersOpen && (
        <div id="dataset-filters" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search" className="sm:col-span-2">
            <Input
              placeholder="Market, commodity, district…"
              value={filters.q}
              onChange={(e) => setFilters((current) => ({ ...current, q: e.target.value }))}
              aria-label="Search trusted records"
            />
          </Field>
          <Field label="From">
            <Input
              type="date"
              value={filters.from}
              min={view.from || undefined}
              max={filters.to || view.to || undefined}
              onChange={(e) => setFilters((current) => ({ ...current, from: e.target.value }))}
              aria-label="From date"
            />
          </Field>
          <Field label="To">
            <Input
              type="date"
              value={filters.to}
              min={filters.from || view.from || undefined}
              max={view.to || undefined}
              onChange={(e) => setFilters((current) => ({ ...current, to: e.target.value }))}
              aria-label="To date"
            />
          </Field>
          <Field label="Record">
            <SearchSelect
              aria-label="Record status"
              value={filters.corrected}
              onChange={(corrected) => setFilters((current) => ({ ...current, corrected }))}
              options={withAll("All records", [
                { value: "yes", label: "Corrected", hint: view.corrected.toLocaleString() },
                { value: "no", label: "Unchanged", hint: view.unchanged.toLocaleString() },
              ])}
              searchPlaceholder="Search status…"
            />
          </Field>
          <Field label="Province">
            <SearchSelect
              aria-label="Province"
              value={filters.province}
              onChange={(province) =>
                setFilters((current) => ({ ...current, province, district: "", market: "" }))
              }
              options={withAll("All provinces", view.provinces)}
              searchPlaceholder="Search province…"
            />
          </Field>
          <Field label="District">
            <SearchSelect
              aria-label="District"
              value={filters.district}
              onChange={(district) => setFilters((current) => ({ ...current, district, market: "" }))}
              options={withAll("All districts", view.districts)}
              searchPlaceholder="Search district…"
            />
          </Field>
          <Field label="Market">
            <SearchSelect
              aria-label="Market"
              value={filters.market}
              onChange={(market) => setFilters((current) => ({ ...current, market }))}
              options={withAll("All markets", view.markets)}
              searchPlaceholder="Search market…"
            />
          </Field>
          <Field label="Commodity">
            <SearchSelect
              aria-label="Commodity"
              value={filters.commodity}
              onChange={(commodity) => setFilters((current) => ({ ...current, commodity }))}
              options={withAll("All commodities", view.commodities)}
              searchPlaceholder="Search commodity…"
            />
          </Field>
          <Field label="Channel">
            <SearchSelect
              aria-label="Price channel"
              value={filters.channel}
              onChange={(channel) => setFilters((current) => ({ ...current, channel }))}
              options={withAll("All channels", view.channels)}
              searchPlaceholder="Search channel…"
            />
          </Field>
          <Field label="Unit">
            <SearchSelect
              aria-label="Unit"
              value={filters.unit}
              onChange={(unit) => setFilters((current) => ({ ...current, unit }))}
              options={withAll("All units", view.units)}
              searchPlaceholder="Search unit…"
            />
          </Field>
          <Field label="Currency">
            <SearchSelect
              aria-label="Currency"
              value={filters.currency}
              onChange={(currency) => setFilters((current) => ({ ...current, currency }))}
              options={withAll("All currencies", view.currencies)}
              searchPlaceholder="Search currency…"
            />
          </Field>
          <Field label="Min price">
            <Input
              type="number"
              min={0}
              inputMode="decimal"
              placeholder="Any"
              value={filters.minPrice}
              onChange={(e) => setFilters((current) => ({ ...current, minPrice: e.target.value }))}
              aria-label="Minimum price"
            />
          </Field>
          <Field label="Max price">
            <Input
              type="number"
              min={0}
              inputMode="decimal"
              placeholder="Any"
              value={filters.maxPrice}
              onChange={(e) => setFilters((current) => ({ ...current, maxPrice: e.target.value }))}
              aria-label="Maximum price"
            />
          </Field>
        </div>
        )}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title="No trusted records match this view"
          body={
            filtersActive
              ? "No released rows match these filters. Clear them to see the full trusted dataset."
              : "Resolve critical and high issues in Review Center to release more rows."
          }
          action={
            filtersActive ? (
              <Button type="button" onClick={() => setFilters(EMPTY_FILTERS)}>
                Clear filters
              </Button>
            ) : (
              <Button asChild>
                <Link to="/review">Go to Review Center</Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-secondary text-left">
              <tr>
                {["Date", "Province", "District", "Market", "Commodity", "Unit", "Currency"].map((h) => (
                  <th key={h} className="p-3 font-medium">
                    {h}
                  </th>
                ))}
                {view.priceColumns.map((column) => (
                  <th key={column.key} className="p-3 text-right font-medium">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="p-3">{r.date}</td>
                  <td className="p-3">{r.province || "—"}</td>
                  <td className="p-3">{r.district}</td>
                  <td className="p-3">{r.market}</td>
                  <td className="p-3">{r.commodity}</td>
                  <td className="p-3">{r.unit}</td>
                  <td className="p-3">{r.currency}</td>
                  {view.priceColumns.map((column) => {
                    const cell = r.prices[column.key];
                    return (
                      <td key={column.key} className="p-3 text-right font-medium">
                        {cell == null ? (
                          "No data"
                        ) : (
                          <>
                            {cell.price.toLocaleString()}
                            {cell.corrected && (
                              <span className="ml-2 rounded-full bg-soft px-2 py-0.5 text-xs font-medium text-primary">
                                Corrected
                              </span>
                            )}
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shown.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Showing {(start + 1).toLocaleString()}–{(start + pageRows.length).toLocaleString()} of{" "}
            {shown.length.toLocaleString()}
          </p>
          {pageCount > 1 && (
            <nav aria-label="Trusted dataset pages" className="flex flex-wrap items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => goTo(currentPage - 1)}
              >
                <ChevronLeft aria-hidden />
                Previous
              </Button>
              {pageItems(currentPage, pageCount).map((item, index) =>
                item === "gap" ? (
                  <span key={`gap-${index}`} className="px-1 text-sm text-muted-foreground" aria-hidden>
                    …
                  </span>
                ) : (
                  <Button
                    key={item}
                    type="button"
                    variant={item === currentPage ? "default" : "outline"}
                    size="sm"
                    className="min-w-9"
                    aria-current={item === currentPage ? "page" : undefined}
                    aria-label={`Page ${item}`}
                    onClick={() => goTo(item)}
                  >
                    {item}
                  </Button>
                ),
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={currentPage >= pageCount}
                onClick={() => goTo(currentPage + 1)}
              >
                Next
                <ChevronRight aria-hidden />
              </Button>
            </nav>
          )}
        </div>
      )}
    </AppShell>
  );
}
