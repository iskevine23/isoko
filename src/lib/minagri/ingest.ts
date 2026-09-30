import { AMBIGUOUS_LOCAL_NAMES } from "./catalog";
import { matrixToTable, parseCsv, sniffDelimiter, type ParsedCsv } from "./csv";
import { DISTRICTS } from "./districts";
import { esokoToTable, isEsokoExport } from "./esoko";
import { parseDate, parsePrice } from "./standardize";

export interface DataTable extends ParsedCsv {
  /** Human-readable source format, e.g. "Excel workbook". */
  format: string;
  notes: string[];
}

export class UnsupportedFileError extends Error {}

const SPREADSHEET = ["xlsx", "xlsm", "xlsb", "xls", "ods", "numbers"];
const DOCUMENT = [
  "pdf",
  "doc",
  "docx",
  "ppt",
  "pptx",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "heic",
  "zip",
];

export const ACCEPTED_FILES =
  ".csv,.tsv,.txt,.dat,.json,.ndjson,.jsonl,.geojson,.xml,.xlsx,.xlsm,.xlsb,.xls,.ods,.numbers,text/*,application/json,application/xml";

export const FORMAT_LABEL = "CSV · Excel · JSON · XML · TSV · TXT";

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) {
    return value.every((v) => v == null || typeof v !== "object")
      ? value.filter((v) => v != null).join("; ")
      : `${value.length} items`;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function flatten(obj: Record<string, unknown>, prefix = "", out: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      flatten(value as Record<string, unknown>, path, out);
    } else {
      out[path] = cellText(value);
    }
  }
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const isRecordArray = (v: unknown): v is Record<string, unknown>[] =>
  Array.isArray(v) && v.length > 0 && v.every(isRecord);

/**
 * Finds the observation rows inside arbitrary JSON: a plain array of objects, an envelope such as
 * `{ data: [...] }`, or a keyed map like `{ "Beans": { mk: [...] } }`. Sibling scalar fields and map
 * keys are carried down as columns so grouping information is not lost.
 */
function jsonRows(
  node: unknown,
  context: Record<string, string> = {},
  depth = 0,
): Record<string, string>[] {
  if (depth > 6) return [];
  if (isRecordArray(node)) return node.map((item) => ({ ...context, ...flatten(item) }));
  if (!isRecord(node)) return [];

  const scalars: Record<string, string> = { ...context };
  const arrays: [string, Record<string, unknown>[]][] = [];
  const objects: [string, Record<string, unknown>][] = [];
  for (const [key, value] of Object.entries(node)) {
    if (isRecordArray(value)) arrays.push([key, value]);
    else if (isRecord(value)) objects.push([key, value]);
    else scalars[key] = cellText(value);
  }

  if (arrays.length) {
    const [, largest] = arrays.sort((a, b) => b[1].length - a[1].length)[0];
    return jsonRows(largest, scalars, depth + 1);
  }
  if (objects.length >= 2) {
    const rows = objects.flatMap(([key, value]) =>
      jsonRows(value, { ...scalars, group: key }, depth + 1),
    );
    if (rows.length) return rows;
  }
  if (objects.length === 1) return jsonRows(objects[0][1], scalars, depth + 1);
  return Object.keys(node).length ? [flatten(node)] : [];
}

function tableFromRecords(
  rows: Record<string, string>[],
  format: string,
  notes: string[] = [],
): DataTable {
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }
  const filled = rows.map((row) =>
    Object.fromEntries(headers.map((h) => [h, (row[h] ?? "").trim()])),
  );
  return {
    headers,
    rows: filled,
    errors: rows.length ? [] : ["No records were found in this file."],
    format,
    notes,
  };
}

function parseJson(text: string, fileName: string): DataTable {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
    try {
      value = lines.map((l) => JSON.parse(l));
    } catch (error) {
      throw new UnsupportedFileError(
        `The JSON could not be read: ${error instanceof Error ? error.message : "invalid JSON"}`,
      );
    }
  }
  const list = isRecord(value) && Array.isArray(value.data) ? value.data : value;
  if (isEsokoExport(list)) {
    const table = esokoToTable(list, {
      channel: channelFromName(fileName) ?? undefined,
      ambiguousLocalNames: AMBIGUOUS_LOCAL_NAMES,
    });
    return {
      ...table,
      errors: [],
      format: "e-Soko JSON export",
      notes: [`Read ${table.rows.length.toLocaleString()} e-Soko price records`],
    };
  }
  const rows = jsonRows(value);
  return tableFromRecords(
    rows,
    "JSON",
    rows.length ? [`Read ${rows.length.toLocaleString()} records from JSON`] : [],
  );
}

function parseXml(text: string): DataTable {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror"))
    throw new UnsupportedFileError("The XML file is not well formed.");
  const groups = new Map<string, Element[]>();
  doc.querySelectorAll("*").forEach((el) => {
    if (!el.parentElement || (el.children.length === 0 && el.attributes.length === 0)) return;
    const key = `${el.parentElement.tagName}>${el.tagName}`;
    const list = groups.get(key) ?? [];
    list.push(el);
    groups.set(key, list);
  });
  const best = [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  const rows = best.map((el) => {
    const row: Record<string, string> = {};
    for (const attr of Array.from(el.attributes)) row[attr.name] = attr.value;
    for (const child of Array.from(el.children)) {
      row[child.tagName] = (child.textContent ?? "").trim();
    }
    return row;
  });
  return tableFromRecords(
    rows,
    "XML",
    rows.length ? [`Read ${rows.length.toLocaleString()} <${best[0]?.tagName}> records`] : [],
  );
}

async function parseSpreadsheet(file: File): Promise<DataTable> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  let bestName = "";
  let best: ParsedCsv | null = null;
  for (const name of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[name], {
      header: 1,
      raw: false,
      dateNF: "yyyy-mm-dd",
      defval: "",
      blankrows: false,
    });
    const table = matrixToTable(matrix);
    if (!best || table.rows.length > best.rows.length) {
      best = table;
      bestName = name;
    }
  }
  if (!best || best.rows.length === 0)
    throw new UnsupportedFileError("The workbook has no sheet with data rows.");
  const notes =
    workbook.SheetNames.length > 1
      ? [
          `Used sheet "${bestName}" (${best.rows.length.toLocaleString()} rows) of ${workbook.SheetNames.length}`,
        ]
      : [];
  return { ...best, format: "Excel workbook", notes };
}

function parseText(text: string, ext: string, fileName: string): DataTable {
  const head = text.replace(/^\uFEFF/, "").trimStart();
  if (
    ext === "json" ||
    ext === "ndjson" ||
    ext === "jsonl" ||
    ext === "geojson" ||
    head.startsWith("{") ||
    head.startsWith("[")
  ) {
    return parseJson(text, fileName);
  }
  if (ext === "xml" || head.startsWith("<")) return parseXml(text);
  const delimiter = ext === "tsv" ? "\t" : sniffDelimiter(text);
  const label =
    delimiter === "\t"
      ? "Tab-separated text"
      : delimiter === ";"
        ? "Semicolon-separated text"
        : delimiter === "|"
          ? "Pipe-separated text"
          : "CSV";
  return { ...parseCsv(text, delimiter), format: label, notes: [] };
}

function looksBinary(text: string) {
  const sample = text.slice(0, 2000);
  let odd = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code === 0 || code === 0xfffd || (code < 9 && code !== 0)) odd++;
  }
  return sample.length > 0 && odd / sample.length > 0.05;
}

const CHANNEL_COLUMN: [RegExp, string][] = [
  [/farm\s*_?gate|farm|producer|umuhinzi/, "farmgate"],
  [/wholesale|whole_sale|bulk|irangura/, "wholesale"],
  [/retail|consumer|detail|ikiranguzo/, "retail"],
];

/**
 * Wide price sheets hold one column per price type ("Farmgate Price", "Wholesale Price", "Retail Price").
 * These are split into one row per reported price. Empty cells were never reported, so they add no row.
 */
function unpivotChannels(table: DataTable): DataTable {
  const priceColumns: { header: string; channel: string }[] = [];
  for (const header of table.headers) {
    const norm = normHeader(header);
    const hit = CHANNEL_COLUMN.find(([re]) => re.test(norm));
    if (!hit || /type|level|channel/.test(norm)) continue;
    const values = columnValues(table, header);
    if (!values.length || values.filter((v) => parsePrice(v) !== null).length / values.length < 0.7)
      continue;
    if (!priceColumns.some((p) => p.channel === hit[1]))
      priceColumns.push({ header, channel: hit[1] });
  }
  if (priceColumns.length < 2) return table;

  const priceHeaders = new Set(priceColumns.map((p) => p.header));
  const keep = table.headers.filter((h) => !priceHeaders.has(h));
  const rows: Record<string, string>[] = [];
  for (const row of table.rows) {
    for (const { header, channel } of priceColumns) {
      if (!row[header]) continue;
      const out: Record<string, string> = {};
      for (const h of keep) out[h] = row[h] ?? "";
      out["Price type"] = channel;
      out.Price = row[header];
      rows.push(out);
    }
  }
  return {
    ...table,
    headers: [...keep, "Price type", "Price"],
    rows,
    notes: [
      ...table.notes,
      `Split ${priceColumns.map((p) => `"${p.header}"`).join(", ")} into one row per price type: ${table.rows.length.toLocaleString()} rows became ${rows.length.toLocaleString()} prices`,
    ],
  };
}

export async function readDataFile(file: File): Promise<DataTable> {
  return unpivotChannels(await readTableFile(file));
}

async function readTableFile(file: File): Promise<DataTable> {
  const ext = extensionOf(file.name);
  if (SPREADSHEET.includes(ext)) return parseSpreadsheet(file);
  if (DOCUMENT.includes(ext)) {
    throw new UnsupportedFileError(
      `${ext.toUpperCase()} files hold documents or images, not a data table. Export the table to Excel, CSV, or JSON and upload that file.`,
    );
  }
  const text = await file.text();
  if (looksBinary(text)) {
    try {
      return await parseSpreadsheet(file);
    } catch {
      throw new UnsupportedFileError(
        "This file is not a readable data table. Use Excel, CSV, JSON, XML, or tab-separated text.",
      );
    }
  }
  return parseText(text, ext, file.name);
}

export type Field =
  | "date"
  | "province"
  | "district"
  | "market"
  | "commodity"
  | "channel"
  | "unit"
  | "price"
  | "currency";
export type ColumnMapping = Record<Field, string | null>;

export const FIELDS: { key: Field; label: string; required: boolean }[] = [
  { key: "market", label: "Market", required: true },
  { key: "commodity", label: "Commodity", required: true },
  { key: "price", label: "Price", required: true },
  { key: "date", label: "Date", required: false },
  { key: "channel", label: "Price type", required: false },
  { key: "unit", label: "Unit", required: false },
  { key: "district", label: "District", required: false },
  { key: "province", label: "Province", required: false },
  { key: "currency", label: "Currency", required: false },
];

/** Header names the standardiser recognises exactly, so mapped tables never fall back to guessing. */
const CANONICAL: Record<Field, string> = {
  date: "date",
  province: "province",
  district: "district",
  market: "market",
  commodity: "commodity",
  channel: "price_type",
  unit: "unit",
  price: "price",
  currency: "currency",
};

const ALIASES: Record<Field, string[]> = {
  date: [
    "date",
    "observation_date",
    "price_date",
    "entry_date",
    "created_on",
    "created_at",
    "reported_on",
    "report_date",
    "collection_date",
    "day",
    "period",
    "month",
    "last",
    "itariki",
    "umunsi",
  ],
  province: ["province", "province_name", "market_province", "region", "intara"],
  district: ["district", "district_name", "market_district", "akarere", "d"],
  market: [
    "market",
    "market_name",
    "marketname",
    "market_place",
    "marketplace",
    "isoko",
    "location",
    "m",
  ],
  commodity: [
    "commodity",
    "commodity_name",
    "commodity_name_en",
    "product",
    "product_name",
    "product_commodity_name",
    "crop",
    "item",
    "item_name",
    "igicuruzwa",
    "igihingwa",
    "group",
  ],
  channel: ["price_type", "pricetype", "channel", "market_level", "price_level", "level", "type"],
  unit: [
    "unit",
    "commodity_unit",
    "product_commodity_unit",
    "measure",
    "uom",
    "unit_of_measure",
    "ingero",
  ],
  price: [
    "price",
    "average_price",
    "avg_price",
    "mean_price",
    "price_rwf",
    "rwf",
    "unit_price",
    "value",
    "amount",
    "cost",
    "igiciro",
    "p",
  ],
  currency: ["currency", "ifaranga"],
};

const TEXT_FIELDS: Field[] = [
  "province",
  "district",
  "market",
  "commodity",
  "channel",
  "unit",
  "currency",
];

function normHeader(h: string) {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function columnValues(table: ParsedCsv, header: string) {
  const values: string[] = [];
  for (const row of table.rows) {
    const v = row[header];
    if (v) values.push(v);
    if (values.length >= 300) break;
  }
  return values;
}

/** "Markets" → "market", "Prices_RWF" → "price_rwf": plural headers name the same field. */
const singular = (norm: string) =>
  norm
    .split("_")
    .map((t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t))
    .join("_");

const DISTRICT_NAMES = new Set(DISTRICTS.map((d) => d.name.toLowerCase()));
const PROVINCE_NAMES = new Set([
  "kigali",
  "southern",
  "western",
  "northern",
  "eastern",
  "south",
  "west",
  "north",
  "east",
]);
const provinceKey = (v: string) =>
  v
    .toLowerCase()
    .replace(/\b(province|city|intara|of)\b/g, "")
    .replace(/[^a-z]/g, "");

/** Share of values that are Rwandan district names and province names, so "region" columns map by content. */
function geographyShares(values: string[]) {
  const district = values.filter((v) => DISTRICT_NAMES.has(v.trim().toLowerCase())).length;
  const province = values.filter((v) => PROVINCE_NAMES.has(provinceKey(v))).length;
  return { district: district / values.length, province: province / values.length };
}

function headerScore(field: Field, header: string): number {
  const norm = singular(normHeader(header));
  const tokens = norm.split("_");
  const last = header.split(".").pop() ?? header;
  if (
    /(^|_)(id|uuid|code|mobile|phone|email)$/.test(norm) ||
    /^(is|has|same|different|updated)_/.test(norm)
  )
    return 0;
  const aliases = ALIASES[field];
  if (aliases.includes(norm)) return 3;
  if (aliases.includes(singular(normHeader(last)))) return 2.5;
  const words = aliases.filter((a) => a.length > 2);
  if (words.some((a) => norm.startsWith(`${a}_`) || norm.endsWith(`_${a}`) || tokens.includes(a)))
    return 1;
  return 0;
}

/**
 * Suggests which column holds each field from the header names, then checks the values: prices must be
 * numeric, dates readable, and names textual. Boolean or empty columns are never chosen, and each column
 * is used for at most one field.
 */
export function suggestMapping(table: ParsedCsv): ColumnMapping {
  const candidates: { field: Field; header: string; score: number }[] = [];
  for (const header of table.headers) {
    const values = columnValues(table, header);
    if (!values.length) continue;
    if (values.every((v) => /^(true|false|yes|no)$/i.test(v))) continue;
    const fill = values.length / Math.min(table.rows.length, 300);
    const numeric =
      values.filter((v) => parsePrice(v) !== null && /^[\s\d.,\-RWFrwf]+$/.test(v)).length /
      values.length;
    const geo = geographyShares(values);
    for (const { key: field } of FIELDS) {
      let base = headerScore(field, header);
      if (field === "district" || field === "province") {
        const own = field === "district" ? geo.district : geo.province;
        const other = field === "district" ? geo.province : geo.district;
        if (own >= 0.6) base = Math.max(base, 2.8);
        else if (other >= 0.6) continue;
      }
      if (!base) continue;
      if (field === "price" && numeric < 0.7) continue;
      if (
        field === "date" &&
        values.filter((v) => parseDate(v) !== null).length / values.length < 0.6
      )
        continue;
      if (TEXT_FIELDS.includes(field) && numeric > 0.9) continue;
      if (
        field === "channel" &&
        values.filter((v) => /farm|whole|retail|producer|consumer|bulk/i.test(v)).length /
          values.length <
          0.5
      )
        continue;
      candidates.push({ field, header, score: base + fill * 0.5 });
    }
  }
  const mapping = Object.fromEntries(FIELDS.map((f) => [f.key, null])) as ColumnMapping;
  const used = new Set<string>();
  for (const c of candidates.sort((a, b) => b.score - a.score)) {
    if (mapping[c.field] || used.has(c.header)) continue;
    mapping[c.field] = c.header;
    used.add(c.header);
  }
  return mapping;
}

export function missingRequired(mapping: ColumnMapping) {
  return FIELDS.filter((f) => f.required && !mapping[f.key]).map((f) => f.label);
}

export function channelFromName(name: string): "farmgate" | "wholesale" | "retail" | null {
  const n = name.toLowerCase();
  if (/farm|producer/.test(n)) return "farmgate";
  if (/wholesal/.test(n)) return "wholesale";
  if (/retail|consumer/.test(n)) return "retail";
  return null;
}

/**
 * Keeps only the mapped columns under the names the pipeline expects. Unmapped columns (IDs, agent
 * contact details, timestamps) are dropped so they neither reach the review screens nor lower completeness.
 */
export function applyMapping(
  table: DataTable,
  mapping: ColumnMapping,
  defaultChannel: string | null,
): DataTable {
  const fields = FIELDS.map((f) => f.key).filter(
    (k) => mapping[k] || (k === "channel" && defaultChannel),
  );
  const headers = fields.map((k) => CANONICAL[k]);
  const rows = table.rows.map((row) =>
    Object.fromEntries(
      fields.map((k) => [
        CANONICAL[k],
        mapping[k] ? (row[mapping[k]!] ?? "") : (defaultChannel ?? ""),
      ]),
    ),
  );
  return { ...table, headers, rows };
}

/** Combines several prepared files so farm-gate, wholesale, and retail exports can be analysed together. */
export function mergeTables(tables: { table: DataTable; name: string }[]): DataTable {
  if (tables.length === 1) return tables[0].table;
  const rows = tables.flatMap(({ table, name }) =>
    table.rows.map((row) => ({ ...row, source_file: name })),
  );
  const merged = tableFromRecords(
    rows,
    [...new Set(tables.map((t) => t.table.format))].join(" + "),
  );
  merged.errors = tables.flatMap(({ table, name }) => table.errors.map((e) => `${name}: ${e}`));
  merged.notes = tables.flatMap(({ table, name }) => [
    `${name}: ${table.rows.length.toLocaleString()} rows`,
    ...table.notes,
  ]);
  return merged;
}
