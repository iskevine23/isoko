/**
 * Builds the reference catalog and price snapshot from the raw e-Soko exports in data/.
 * Run: npm run data:build
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCatalog,
  esokoToTable,
  TABLE_HEADERS,
  type EsokoMarket,
  type EsokoPriceRow,
  type EsokoProduct,
  type EsokoSnapshot,
} from "../src/lib/minagri/esoko";

const root = join(import.meta.dir, "..");
const read = <T>(name: string): T => JSON.parse(readFileSync(join(root, "data", name), "utf8")) as T;

const products = read<EsokoProduct[]>("esoko-product.json");
const markets = read<EsokoMarket[]>("esoko-market.json");
const channels: [string, EsokoPriceRow[]][] = [
  ["farmgate", read<EsokoPriceRow[]>("esoko-farmgate.json")],
  ["wholesale", read<EsokoPriceRow[]>("esoko-wholesaler.json")],
  ["retail", read<EsokoPriceRow[]>("esoko-retailer.json")],
];

const catalog = buildCatalog(products, markets, channels[0]![1]);

const localCount = new Map<string, number>();
for (const c of catalog.commodities) localCount.set(c.local.toLowerCase(), (localCount.get(c.local.toLowerCase()) ?? 0) + 1);
const ambiguousLocalNames = new Set([...localCount].filter(([, n]) => n > 1).map(([name]) => name));
const productMap = new Map(products.map((p) => [p.id, p]));

const rows: string[][] = [];
const dates = new Set<string>();
for (const [channel, data] of channels) {
  const table = esokoToTable(data, { channel, ambiguousLocalNames, products: productMap });
  for (const row of table.rows) {
    dates.add(row.date);
    rows.push(TABLE_HEADERS.map((h) => row[h as keyof typeof row] ?? ""));
  }
}

const snapshot: EsokoSnapshot = {
  source: catalog.source,
  date: [...dates].sort().join(", "),
  headers: TABLE_HEADERS,
  rows,
};

const outDir = join(root, "src/lib/minagri/data");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "esoko-catalog.json"), JSON.stringify(catalog, null, 1));
writeFileSync(join(outDir, "esoko-snapshot.json"), JSON.stringify(snapshot));

const priced = catalog.commodities.filter((c) => c.referenceFarmgate !== null).length;
console.log(`Catalog: ${catalog.commodities.length} commodities (${priced} priced), ${catalog.markets.length} markets`);
console.log(`Snapshot: ${rows.length} price rows dated ${snapshot.date}`);
console.log(`Registry notes: ${catalog.notes.length}`);
