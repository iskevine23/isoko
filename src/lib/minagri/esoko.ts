import { DISTRICTS } from "./districts";

/**
 * Rwanda e-Soko export format (farm gate, wholesale, retail price endpoints,
 * plus the product, market and province catalogs).
 * Commodity joins use `commodity_code → product.id`, which is the verified
 * relationship in the 28 Sep 2026 export (the product's own commodity_code
 * field does not match price rows).
 */

export interface EsokoProduct {
  id: number;
  commodity_code?: string | null;
  commodity_name: string;
  commodity_name_en?: string | null;
  commodity_name_fr?: string | null;
  commodity_unit?: string | null;
  archived?: boolean | null;
}

export interface EsokoMarket {
  id: number;
  name: string;
  district?: string | null;
  esoko_province?: number | null;
  market_code?: string | null;
  province?: { id: number; name: string } | number | null;
}

export interface EsokoPriceRow {
  id?: number;
  market_name?: string | null;
  commodity_code?: string | number | null;
  commodity_name?: string | null;
  price_1?: number | null;
  price_2?: number | null;
  price_3?: number | null;
  average_price?: number | null;
  price_type?: string | null;
  created_on?: string | null;
  entry_date?: string | null;
  market?: EsokoMarket | null;
  product?: EsokoProduct | null;
}

/** e-Soko province ids, as listed in the province endpoint. */
export const ESOKO_PROVINCE: Record<number, string> = {
  1: "Southern Province",
  2: "Western Province",
  3: "Northern Province",
  4: "Eastern Province",
  5: "Kigali City",
};

export interface CatalogCommodity {
  id: number;
  code: string;
  /** English catalog name, used as the canonical label. */
  name: string;
  local: string;
  french: string;
  unit: string;
  archived: boolean;
  /** Median farm-gate price in the reference snapshot, when the product was priced. */
  referenceFarmgate: number | null;
}

export interface CatalogMarket {
  id: number;
  code: string;
  name: string;
  /** Name exactly as stored in e-Soko. */
  source: string;
  district: string;
  province: string;
  /** Province id recorded on the market, which conflicts with the district for some markets. */
  registryProvince: string | null;
}

export interface EsokoCatalog {
  source: string;
  commodities: CatalogCommodity[];
  markets: CatalogMarket[];
  notes: string[];
}

export interface EsokoSnapshot {
  source: string;
  date: string;
  headers: string[];
  rows: string[][];
}

export const TABLE_HEADERS = ["date", "province", "district", "market", "commodity", "price_type", "unit", "price", "esoko_id"];

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

function cleanLabel(value: string | null | undefined): string {
  const v = (value ?? "").replace(/\s+/g, " ").trim();
  return v ? v[0]!.toUpperCase() + v.slice(1) : "";
}

export function districtInfo(raw: string | null | undefined) {
  const key = (raw ?? "").trim().toLowerCase();
  return DISTRICTS.find((d) => d.name.toLowerCase() === key);
}

function provinceId(market: EsokoMarket | null | undefined): number | null {
  if (!market) return null;
  if (typeof market.esoko_province === "number") return market.esoko_province;
  if (typeof market.province === "number") return market.province;
  if (market.province && typeof market.province === "object") return market.province.id;
  return null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function buildCatalog(products: EsokoProduct[], markets: EsokoMarket[], farmgate: EsokoPriceRow[]): EsokoCatalog {
  const farmPrices = new Map<number, number[]>();
  for (const row of farmgate) {
    const id = Number(row.product?.id ?? row.commodity_code);
    const price = rowPrice(row);
    if (!Number.isFinite(id) || price === null) continue;
    const list = farmPrices.get(id) ?? [];
    list.push(price);
    farmPrices.set(id, list);
  }

  const commodities: CatalogCommodity[] = products.map((p) => ({
    id: p.id,
    code: String(p.commodity_code ?? ""),
    name: cleanLabel(p.commodity_name_en) || cleanLabel(p.commodity_name),
    local: cleanLabel(p.commodity_name),
    french: cleanLabel(p.commodity_name_fr),
    unit: (p.commodity_unit ?? "kg").toLowerCase(),
    archived: Boolean(p.archived),
    referenceFarmgate: median(farmPrices.get(p.id) ?? []),
  }));

  const notes: string[] = [];
  const nameCount = new Map<string, number>();
  for (const m of markets) {
    const key = titleCase(m.name);
    nameCount.set(key, (nameCount.get(key) ?? 0) + 1);
  }

  const labelled = markets.map((m) => {
    const d = districtInfo(m.district);
    const base = titleCase(m.name);
    const district = d?.name ?? titleCase(m.district ?? "");
    return { m, d, district, name: (nameCount.get(base) ?? 0) > 1 ? `${base} (${district})` : base };
  });
  const labelCount = new Map<string, number>();
  for (const l of labelled) labelCount.set(l.name, (labelCount.get(l.name) ?? 0) + 1);

  let provinceConflicts = 0;
  const catalogMarkets: CatalogMarket[] = labelled.map(({ m, d, district, name: label }) => {
    const code = String(m.market_code ?? "");
    const name = (labelCount.get(label) ?? 0) > 1 ? `${label.replace(/\)$/, "")}, code ${code})` : label;
    const pid = provinceId(m);
    const registryProvince = pid !== null ? (ESOKO_PROVINCE[pid] ?? null) : null;
    const linkedId = m.province && typeof m.province === "object" ? m.province.id : typeof m.province === "number" ? m.province : null;
    const linkedProvince = linkedId !== null ? (ESOKO_PROVINCE[linkedId] ?? null) : null;
    const province = d?.province ?? registryProvince ?? "";
    const conflicting = [registryProvince, linkedProvince].filter((p): p is string => Boolean(p) && p !== d?.province);
    if (d && conflicting.length) {
      provinceConflicts += 1;
      notes.push(`${name}: district ${district} is in ${d.province}, but the market record also says ${[...new Set(conflicting)].join(" / ")}. District was used.`);
    }
    return { id: m.id, code, name, source: m.name, district, province, registryProvince };
  });
  if (provinceConflicts) {
    notes.unshift(`${provinceConflicts} market records have a province that disagrees with their district.`);
  }

  nameCount.forEach((count, name) => {
    if (count > 1) notes.push(`${count} registered markets are named "${name}". They are kept apart by district.`);
  });

  return { source: "Rwanda e-Soko export, 28 September 2026", commodities, markets: catalogMarkets, notes };
}

export function rowPrice(row: EsokoPriceRow): number | null {
  if (typeof row.average_price === "number" && Number.isFinite(row.average_price)) return row.average_price;
  const values = [row.price_1, row.price_2, row.price_3].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function isEsokoExport(value: unknown): value is EsokoPriceRow[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const first = value[0] as Record<string, unknown>;
  return (
    typeof first === "object" &&
    first !== null &&
    ("average_price" in first || "price_1" in first) &&
    ("market_name" in first || "market" in first) &&
    ("commodity_code" in first || "product" in first)
  );
}

/**
 * Converts e-Soko price rows into the platform's tabular layout. Values are
 * copied as reported. Cleaning happens later so that lineage keeps the originals.
 */
export function esokoToTable(
  rows: EsokoPriceRow[],
  options: { channel?: string; ambiguousLocalNames?: Set<string>; products?: Map<number, EsokoProduct> } = {},
): { headers: string[]; rows: Record<string, string>[] } {
  const out = rows.map((row) => {
    const productId = Number(row.product?.id ?? row.commodity_code);
    const product = row.product ?? options.products?.get(productId) ?? null;
    const local = cleanLabel(product?.commodity_name ?? row.commodity_name);
    const english = cleanLabel(product?.commodity_name_en);
    const ambiguous = options.ambiguousLocalNames?.has(local.toLowerCase()) ?? false;
    const pid = provinceId(row.market);
    const price = rowPrice(row);
    return {
      date: (row.created_on ?? row.entry_date ?? "").slice(0, 10),
      province: pid !== null ? (ESOKO_PROVINCE[pid] ?? "") : "",
      district: row.market?.district ?? "",
      market: row.market?.name ?? row.market_name ?? "",
      commodity: ambiguous && english ? english : local || english,
      price_type: row.price_type ?? options.channel ?? "",
      unit: product?.commodity_unit ?? "",
      price: price === null ? "" : String(price),
      esoko_id: row.id !== undefined ? String(row.id) : "",
    };
  });
  return { headers: TABLE_HEADERS, rows: out };
}
