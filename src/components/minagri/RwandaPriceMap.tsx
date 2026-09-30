import { useRef, useState, type CSSProperties } from "react";
import { RWANDA_BOUNDS, RWANDA_PROVINCES, RWANDA_VIEWBOX } from "@/lib/minagri/rwanda-map";
import { median } from "@/lib/minagri/stats";

export interface ProvincePrice {
  name: string;
  median: number | null;
  observations: number;
  markets: number;
}

export interface MarketPriceDot {
  name: string;
  province: string;
  district: string;
  x: number;
  y: number;
  median: number;
  observations: number;
}

const SHORT: Record<string, string> = {
  "Kigali City": "Kigali",
  "Northern Province": "North",
  "Southern Province": "South",
  "Eastern Province": "East",
  "Western Province": "West",
};

const LOW = [232, 246, 228];
const HIGH = [22, 101, 52];

function mix(t: number) {
  const c = LOW.map((v, i) => Math.round(v + (HIGH[i] - v) * t));
  return `rgb(${c.join(",")})`;
}

const fmt = (n: number) => n.toLocaleString();

export function RwandaPriceMap({
  commodity,
  unit,
  provinces,
  dots,
  selected,
  onSelect,
}: {
  commodity: string;
  unit: string;
  provinces: ProvincePrice[];
  dots: MarketPriceDot[];
  selected: string | null;
  onSelect: (province: string | null) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [dot, setDot] = useState<MarketPriceDot | null>(null);
  const hideTimer = useRef<number | null>(null);
  const holdMarket = (market: MarketPriceDot) => {
    if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    setDot(market);
    setHover(market.province);
  };
  const releaseMarket = (market: MarketPriceDot) => {
    if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setDot((current) =>
        current?.name === market.name && current.province === market.province ? null : current,
      );
    }, 320);
  };
  const byName = new Map(provinces.map((p) => [p.name, p]));
  const priced = provinces.filter((p) => p.median != null).map((p) => p.median!);
  const min = priced.length ? Math.min(...priced) : 0;
  const max = priced.length ? Math.max(...priced) : 0;
  const span = max - min;

  const fillFor = (median: number | null) => {
    if (median == null) return "#E7EEE8";
    if (priced.length < 2) return mix(0.55);
    return mix((median - min) / span);
  };
  const inkFor = (median: number | null) => {
    if (median == null || priced.length < 2) return "#102a1b";
    return (median - min) / span > 0.62 ? "#f7faf7" : "#102a1b";
  };

  const focus = hover ?? selected;
  const focusStat = focus ? byName.get(focus) : undefined;
  const ordered = [...provinces].sort((a, b) => (b.median ?? -1) - (a.median ?? -1));
  const ranked = [...(selected ? dots.filter((d) => d.province === selected) : dots)].sort(
    (a, b) => a.median - b.median,
  );
  const dearest = ranked.at(-1) ?? null;
  const cheapest =
    ranked.length > 1 && ranked[0].median !== ranked[ranked.length - 1].median ? ranked[0] : null;
  const countryMedian = ranked.length ? Math.round(median(ranked.map((d) => d.median))) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_17rem]">
      <div className="relative">
        <svg
          viewBox={RWANDA_VIEWBOX}
          role="group"
          aria-label={`Rwanda map of ${commodity} prices`}
          className="h-auto w-full"
        >
          {RWANDA_PROVINCES.map((shape) => {
            const stat = byName.get(shape.name);
            const median = stat?.median ?? null;
            const on = selected === shape.name;
            return (
              <path
                key={shape.name}
                d={shape.d}
                role="button"
                tabIndex={0}
                aria-pressed={on}
                aria-label={
                  median == null
                    ? `${shape.name}, no ${commodity} price`
                    : `${shape.name}, median ${fmt(median)} RWF`
                }
                fill={fillFor(median)}
                stroke={on ? "#102a1b" : "#ffffff"}
                strokeWidth={on ? 3.5 : 1.4}
                className="cursor-pointer outline-none transition-[stroke-width] focus-visible:stroke-[#102a1b]"
                onMouseEnter={() => setHover(shape.name)}
                onMouseLeave={() => setHover((h) => (h === shape.name ? null : h))}
                onFocus={() => setHover(shape.name)}
                onBlur={() => setHover((h) => (h === shape.name ? null : h))}
                onClick={() => onSelect(on ? null : shape.name)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(on ? null : shape.name);
                  }
                }}
              />
            );
          })}
          {RWANDA_PROVINCES.map((shape) => {
            const stat = byName.get(shape.name);
            const median = stat?.median ?? null;
            const [x, y] = shape.label;
            const ink = inkFor(median);
            return (
              <text
                key={`${shape.name}-label`}
                x={x}
                y={y}
                textAnchor="middle"
                fill={ink}
                className="pointer-events-none select-none"
                style={{ fontSize: shape.name === "Kigali City" ? 10 : 12 }}
              >
                <tspan x={x} dy={median == null ? 4 : -2} fontWeight={600}>
                  {SHORT[shape.name] ?? shape.name}
                </tspan>
                <tspan x={x} dy={13} fontWeight={700}>
                  {median == null ? "—" : fmt(median)}
                </tspan>
              </text>
            );
          })}
          {dots.map((m) => {
            const active = dot?.name === m.name && dot.province === m.province;
            const dear = m.name === dearest?.name;
            const cheap = m.name === cheapest?.name;
            const dim = selected != null && m.province !== selected;
            return (
              <g
                key={`${m.province}-${m.name}`}
                className="cursor-pointer"
                opacity={dim ? 0.28 : 1}
                onMouseEnter={() => holdMarket(m)}
                onMouseLeave={() => releaseMarket(m)}
              >
                {(active || dear || cheap) && (
                  <circle
                    cx={m.x}
                    cy={m.y}
                    r={active ? 12 : 9}
                    fill={dear ? "#C4A35A" : "#102a1b"}
                    opacity={0.18}
                  />
                )}
                <circle
                  cx={m.x}
                  cy={m.y}
                  r={active ? 5.2 : 3.8}
                  fill="#ffffff"
                  stroke={dear ? "#C4A35A" : cheap ? "#102a1b" : fillFor(m.median)}
                  strokeWidth={active || dear || cheap ? 2.4 : 1.8}
                />
                <circle cx={m.x} cy={m.y} r={active ? 2.2 : 1.6} fill={fillFor(m.median)} />
                <title>
                  {m.name}: {fmt(m.median)} RWF
                </title>
              </g>
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0">
          {dearest && (
            <div
              className="pointer-events-auto absolute z-10"
              style={calloutPosition(dearest, "up")}
              onMouseEnter={() => holdMarket(dearest)}
              onMouseLeave={() => releaseMarket(dearest)}
            >
              <MarketHighlight
                market={dearest}
                unit={unit}
                eyebrow={cheapest ? "Highest price" : "Market"}
                countryMedian={countryMedian}
                accent="#C4A35A"
              />
            </div>
          )}
          {cheapest && (
            <div
              className="pointer-events-auto absolute z-10"
              style={calloutPosition(cheapest, "down")}
              onMouseEnter={() => holdMarket(cheapest)}
              onMouseLeave={() => releaseMarket(cheapest)}
            >
              <MarketHighlight
                market={cheapest}
                unit={unit}
                eyebrow="Lowest price"
                countryMedian={countryMedian}
                accent="#1b6534"
              />
            </div>
          )}
          {dot &&
            !(dot.name === dearest?.name && dot.province === dearest?.province) &&
            !(dot.name === cheapest?.name && dot.province === cheapest?.province) && (
              <div
                className="pointer-events-auto absolute z-10"
                style={calloutPosition(dot, "down")}
                onMouseEnter={() => holdMarket(dot)}
                onMouseLeave={() => releaseMarket(dot)}
              >
                <MarketHighlight
                  market={dot}
                  unit={unit}
                  eyebrow="Market"
                  countryMedian={countryMedian}
                  accent="#102a1b"
                />
              </div>
            )}
        </div>
      </div>

      <div className="flex flex-col">
        <div className="mb-3">
          <div
            className="h-2.5 rounded-full"
            style={{ background: `linear-gradient(90deg, ${mix(0)}, ${mix(1)})` }}
            role="img"
            aria-label={
              priced.length
                ? `Price scale from ${fmt(min)} to ${fmt(max)} RWF`
                : "No prices to scale"
            }
          />
          <div className="mt-1 flex justify-between text-xs text-muted-foreground">
            <span>{priced.length ? `${fmt(min)} RWF` : "Lower"}</span>
            <span>{priced.length ? `${fmt(max)} RWF` : "Higher"}</span>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <i className="inline-block h-2.5 w-2.5 rounded-sm bg-[#E7EEE8] ring-1 ring-border" />
            No clean price
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <i className="inline-block h-2.5 w-2.5 rounded-full border-2 border-[#C4A35A] bg-white" />
            Highest market
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <i className="inline-block h-2.5 w-2.5 rounded-full border-2 border-[#102a1b] bg-white" />
            Lowest market
          </p>
        </div>

        <ul className="space-y-1.5">
          {ordered.map((p) => {
            const on = selected === p.name;
            const hot = focus === p.name;
            return (
              <li key={p.name}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSelect(on ? null : p.name)}
                  onMouseEnter={() => setHover(p.name)}
                  onMouseLeave={() => setHover((h) => (h === p.name ? null : h))}
                  className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    on
                      ? "border-primary bg-primary/5"
                      : hot
                        ? "border-border bg-secondary"
                        : "border-border bg-card hover:bg-secondary/70"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <i
                      className="inline-block h-3 w-3 shrink-0 rounded-sm ring-1 ring-black/10"
                      style={{ background: fillFor(p.median) }}
                    />
                    <span className="truncate font-medium">{SHORT[p.name] ?? p.name}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-semibold">
                      {p.median == null ? "No data" : `${fmt(p.median)}`}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {p.median == null
                        ? "Not reported"
                        : `${p.markets} market${p.markets === 1 ? "" : "s"}`}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {(dearest || cheapest) && (
          <div className="mt-4 border-t border-border pt-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Market highlights
            </h3>
            <ul className="mt-2 space-y-2">
              {dearest && (
                <HighlightRow
                  label={cheapest ? "Highest" : "Market"}
                  market={dearest}
                  unit={unit}
                  accent="#C4A35A"
                  active={dot?.name === dearest.name}
                  onEnter={() => holdMarket(dearest)}
                  onLeave={() => releaseMarket(dearest)}
                />
              )}
              {cheapest && (
                <HighlightRow
                  label="Lowest"
                  market={cheapest}
                  unit={unit}
                  accent="#1b6534"
                  active={dot?.name === cheapest.name}
                  onEnter={() => holdMarket(cheapest)}
                  onLeave={() => releaseMarket(cheapest)}
                />
              )}
            </ul>
          </div>
        )}

        <p className="mt-3 text-xs text-muted-foreground">
          {focusStat?.median != null
            ? `${focusStat.name}: median ${fmt(focusStat.median)} RWF${unit ? `/${unit}` : ""} from ${focusStat.observations} clean ${commodity} prices.`
            : `Median ${commodity || "product"} price. Darker green is a higher price.`}
          {selected
            ? " Click the province again to show the whole country."
            : " Click a province to filter the charts."}
        </p>
      </div>
    </div>
  );
}

function calloutPosition(market: MarketPriceDot, prefer: "up" | "down"): CSSProperties {
  const { width, height } = RWANDA_BOUNDS;
  const right = market.x > width * 0.58;
  const place = market.y < 90 ? "down" : market.y > height - 90 ? "up" : prefer;
  return {
    left: `${(market.x / width) * 100}%`,
    top: `${(market.y / height) * 100}%`,
    transform: `${right ? "translateX(calc(-100% - 14px))" : "translateX(14px)"} ${
      place === "up" ? "translateY(calc(-100% - 8px))" : "translateY(10px)"
    }`,
  };
}

function MarketHighlight({
  market,
  unit,
  eyebrow,
  countryMedian,
  accent,
}: {
  market: MarketPriceDot;
  unit: string;
  eyebrow: string;
  countryMedian: number | null;
  accent: string;
}) {
  const delta =
    countryMedian && countryMedian > 0
      ? Math.round(((market.median - countryMedian) / countryMedian) * 100)
      : null;
  return (
    <div
      className="w-48 rounded-md border border-border bg-card/95 px-2.5 py-2 shadow-md backdrop-blur-sm"
      style={{ borderLeftWidth: 3, borderLeftColor: accent }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {eyebrow}
      </div>
      <div className="truncate text-sm font-semibold leading-tight">{market.name}</div>
      <div className="truncate text-xs text-muted-foreground">
        {[market.district, SHORT[market.province] ?? market.province].filter(Boolean).join(" · ")}
      </div>
      <div className="mt-1 font-[family-name:var(--font-display)] text-base font-bold tracking-tight">
        {fmt(market.median)}
        <span className="ml-1 text-xs font-medium text-muted-foreground">
          RWF{unit ? `/${unit}` : ""}
        </span>
      </div>
      <div className="text-[11px] text-muted-foreground">
        {market.observations} price{market.observations === 1 ? "" : "s"}
        {delta != null && delta !== 0
          ? ` · ${Math.abs(delta)}% ${delta > 0 ? "above" : "below"} median`
          : ""}
      </div>
    </div>
  );
}

function HighlightRow({
  label,
  market,
  unit,
  accent,
  active,
  onEnter,
  onLeave,
}: {
  label: string;
  market: MarketPriceDot;
  unit: string;
  accent: string;
  active: boolean;
  onEnter: () => void;
  onLeave: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onFocus={onEnter}
        onBlur={onLeave}
        className={`flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left ${
          active ? "border-primary bg-primary/5" : "border-border bg-card"
        }`}
        style={{ borderLeftWidth: 3, borderLeftColor: accent }}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {label}
          </span>
          <span className="block truncate text-sm font-semibold">{market.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {[market.district, SHORT[market.province] ?? market.province].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className="shrink-0 text-right text-sm font-semibold">
          {fmt(market.median)}
          <span className="block text-[11px] font-medium text-muted-foreground">
            RWF{unit ? `/${unit}` : ""}
          </span>
        </span>
      </button>
    </li>
  );
}
