import catalogData from "./data/esoko-catalog.json";
import { DISTRICTS, PROVINCES, type DistrictInfo } from "./districts";
import type { EsokoCatalog } from "./esoko";

export { DISTRICTS, PROVINCES, type DistrictInfo };

const catalog = catalogData as EsokoCatalog;

export const CATALOG_SOURCE = catalog.source;
export const REGISTRY_NOTES = catalog.notes;

export interface MarketInfo {
  name: string;
  code: string;
  district: string;
  province: string;
  lat: number;
  lng: number;
  /** Name as stored in e-Soko. */
  source: string;
}

export const MARKETS: MarketInfo[] = catalog.markets.map((m, i) => {
  const d = DISTRICTS.find((x) => x.name === m.district);
  const jitter = ((i % 7) - 3) * 0.012;
  return {
    name: m.name,
    code: m.code,
    district: m.district,
    province: m.province,
    lat: (d?.lat ?? -1.95) + jitter,
    lng: (d?.lng ?? 30.05) + jitter * 0.8,
    source: m.source,
  };
});

export interface CommodityInfo {
  id: number;
  name: string;
  local: string;
  unit: string;
  /** Median farm-gate price RWF in the reference snapshot, 0 when not priced that day. */
  base: number;
  synonyms: string[];
}

const localCount = new Map<string, number>();
for (const c of catalog.commodities) {
  const key = c.local.toLowerCase();
  localCount.set(key, (localCount.get(key) ?? 0) + 1);
}

/** Kinyarwanda names shared by more than one catalog product. */
export const AMBIGUOUS_LOCAL_NAMES = new Set(
  [...localCount].filter(([, n]) => n > 1).map(([name]) => name),
);

export const COMMODITIES: CommodityInfo[] = catalog.commodities
  .filter((c) => !c.archived)
  .map((c) => ({
    id: c.id,
    name: c.name,
    local: c.local,
    unit: c.unit,
    base: c.referenceFarmgate ?? 0,
    synonyms: [
      ...new Set([c.local, c.french].filter((s) => s && s.toLowerCase() !== c.name.toLowerCase())),
    ],
  }));

/** Products e-Soko has archived, keyed by lower-case English, Kinyarwanda and French names. */
export const ARCHIVED_COMMODITIES = new Map(
  catalog.commodities
    .filter((c) => c.archived)
    .flatMap((c) =>
      [c.name, c.french]
        .filter(Boolean)
        .map((n) => [n.toLowerCase(), { id: c.id, code: c.code, name: c.name }] as const),
    ),
);

export const CHANNEL_LABEL: Record<string, string> = {
  farmgate: "Farm gate",
  wholesale: "Wholesale",
  retail: "Retail",
};

export const VALID_UNITS = [
  ...new Set(["kg", "litre", "piece", "bunch", ...catalog.commodities.map((c) => c.unit)]),
];
