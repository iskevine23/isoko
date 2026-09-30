import { median, robustStats, robustZ } from "../stats";
import type { DataRecord, PriceChannel } from "../types";

/**
 * Relative price features for Isolation Forest.
 * Raw prices are not used on their own: goat meat and eggs live on different
 * scales, so every feature is a log ratio or a robust z-score inside a peer group.
 * Changing this list or its order requires retraining (npm run ml:train).
 */

export const FEATURE_SET = "price-features-v2";

export const FEATURES = [
  "Versus same commodity and channel",
  "Robust z-score",
  "Versus this market's usual level",
  "Versus this province's usual level",
  "Price channel",
  "Retail versus farm gate",
  "Wholesale versus farm gate",
  "Retail versus wholesale",
] as const;

/** Peer statistics need at least this many markets before they count. */
export const MIN_PEERS = 3;

export interface PricedPoint {
  record: DataRecord;
  /** Median price of the same commodity and channel, used as a correction hint. */
  peerMedian: number;
  peerCount: number;
  /** Model inputs, one column per FEATURES entry. */
  values: number[];
  /** Human-readable reading of each feature, parallel to `values`. */
  display: string[];
  /** How far each feature is from typical, used to explain a flag. Imputed features stay at 0. */
  signal: number[];
}

const CHANNEL_CODE: Record<PriceChannel, number> = { farmgate: 0, wholesale: 1, retail: 2 };

const log = (v: number) => Math.log(Math.max(v, 1e-6));

function push(map: Map<string, number[]>, key: string, value: number) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function pct(ratio: number): string {
  const p = Math.round((ratio - 1) * 100);
  return `${p >= 0 ? "+" : ""}${p}%`;
}

export function ladderKey(r: Pick<DataRecord, "date" | "market" | "commodity">): string {
  return `${r.date}|${r.market}|${r.commodity}`;
}

export function buildPriceFeatures(records: DataRecord[]): PricedPoint[] {
  const usable = records.filter(
    (r): r is DataRecord & { price: number; channel: PriceChannel } =>
      r.price !== null && r.price > 0 && r.channel !== "" && Boolean(r.commodity),
  );
  if (usable.length === 0) return [];

  const byCommodityChannel = new Map<string, number[]>();
  for (const r of usable) push(byCommodityChannel, `${r.commodity}|${r.channel}`, r.price);
  const peerStats = new Map<string, ReturnType<typeof robustStats>>();
  byCommodityChannel.forEach((vals, key) => peerStats.set(key, robustStats(vals)));

  const peerRatio = (r: (typeof usable)[number]) => {
    const stats = peerStats.get(`${r.commodity}|${r.channel}`)!;
    return stats.n >= MIN_PEERS ? r.price / Math.max(stats.median, 1e-9) : 1;
  };

  const marketRatios = new Map<string, number[]>();
  const provinceRatios = new Map<string, number[]>();
  for (const r of usable) {
    const ratio = peerRatio(r);
    if (r.market) push(marketRatios, r.market, ratio);
    if (r.province) push(provinceRatios, r.province, ratio);
  }
  const medMarket = new Map<string, number>();
  marketRatios.forEach((vals, key) => medMarket.set(key, median(vals)));
  const medProvince = new Map<string, number>();
  provinceRatios.forEach((vals, key) => medProvince.set(key, median(vals)));

  const ladder = new Map<string, Partial<Record<PriceChannel, number>>>();
  for (const r of usable) {
    const g = ladder.get(ladderKey(r)) ?? {};
    g[r.channel] = r.price;
    ladder.set(ladderKey(r), g);
  }

  const retailFarm: number[] = [];
  const wsFarm: number[] = [];
  const retailWs: number[] = [];
  ladder.forEach((g) => {
    if (g.farmgate && g.retail) retailFarm.push(log(g.retail / g.farmgate));
    if (g.farmgate && g.wholesale) wsFarm.push(log(g.wholesale / g.farmgate));
    if (g.wholesale && g.retail) retailWs.push(log(g.retail / g.wholesale));
  });
  const typicalRetailFarm = retailFarm.length ? median(retailFarm) : log(1.3);
  const typicalWsFarm = wsFarm.length ? median(wsFarm) : log(1.1);
  const typicalRetailWs = retailWs.length ? median(retailWs) : log(1.1);

  return usable.map((r) => {
    const stats = peerStats.get(`${r.commodity}|${r.channel}`)!;
    const enoughPeers = stats.n >= MIN_PEERS;
    const ratio = peerRatio(r);
    const z = enoughPeers ? Math.max(-8, Math.min(8, robustZ(r.price, stats))) : 0;
    const marketResidual = ratio / Math.max(medMarket.get(r.market) ?? 1, 1e-9);
    const provinceResidual = ratio / Math.max(medProvince.get(r.province) ?? 1, 1e-9);

    // Ladder gaps describe one channel. Copying them onto the other prices
    // made normal farm and wholesale rows look like the bad retail price.
    const g = ladder.get(ladderKey(r)) ?? {};
    const onRetail = r.channel === "retail";
    const onWholesale = r.channel === "wholesale";
    const hasRF = onRetail && Boolean(g.farmgate);
    const hasWF = onWholesale && Boolean(g.farmgate);
    const hasRW = onRetail && Boolean(g.wholesale);
    const rf = hasRF ? log(g.retail! / g.farmgate!) : typicalRetailFarm;
    const wf = hasWF ? log(g.wholesale! / g.farmgate!) : typicalWsFarm;
    const rw = hasRW ? log(g.retail! / g.wholesale!) : typicalRetailWs;

    const peerNote = enoughPeers ? `${stats.n} ${r.channel} observations` : `only ${stats.n} comparable market${stats.n === 1 ? "" : "s"}`;
    const values = [log(ratio), z, log(marketResidual), log(provinceResidual), CHANNEL_CODE[r.channel], rf, wf, rw];
    const display = [
      enoughPeers ? `${pct(ratio)} versus the median of ${peerNote}` : `not compared (${peerNote})`,
      enoughPeers ? `${z >= 0 ? "+" : ""}${z.toFixed(2)} within ${peerNote}` : `not compared (${peerNote})`,
      `${pct(marketResidual)} after allowing for this market's usual level`,
      `${pct(provinceResidual)} after allowing for this province's usual level`,
      r.channel,
      hasRF ? `retail is ${pct(Math.exp(rf))} over farm gate (typical ${pct(Math.exp(typicalRetailFarm))})` : "not compared on this channel",
      hasWF ? `wholesale is ${pct(Math.exp(wf))} over farm gate (typical ${pct(Math.exp(typicalWsFarm))})` : "not compared on this channel",
      hasRW ? `retail is ${pct(Math.exp(rw))} over wholesale (typical ${pct(Math.exp(typicalRetailWs))})` : "not compared on this channel",
    ];
    const signal = [
      Math.abs(log(ratio)),
      Math.abs(z) / 4,
      Math.abs(log(marketResidual)),
      Math.abs(log(provinceResidual)),
      0,
      hasRF ? Math.abs(rf - typicalRetailFarm) : 0,
      hasWF ? Math.abs(wf - typicalWsFarm) : 0,
      hasRW ? Math.abs(rw - typicalRetailWs) : 0,
    ];

    return { record: r, peerMedian: stats.median, peerCount: stats.n, values, display, signal };
  });
}
