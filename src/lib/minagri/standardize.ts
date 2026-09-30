import { ARCHIVED_COMMODITIES, COMMODITIES, DISTRICTS, MARKETS, VALID_UNITS } from "./catalog";
import {
  COMMODITY_AUTO_ACCEPT,
  COMMODITY_REVIEW_MIN,
  MARKET_AUTO_ACCEPT,
  MARKET_REVIEW_MIN,
  rankEntityMatches,
  TIE_MARGIN,
} from "./ml/entity-match";
import { normalizeText, titleCase } from "./text";
import type { DataRecord, Issue, LineageEntry, PriceChannel } from "./types";

const COLUMN_ALIASES: Record<string, string[]> = {
  date: ["date", "observation_date", "price_date", "day", "itariki"],
  province: ["province", "intara"],
  district: ["district", "akarere"],
  market: ["market", "market_name", "isoko", "marketname"],
  commodity: ["commodity", "product", "crop", "item", "igicuruzwa"],
  channel: ["price_type", "channel", "pricetype", "market_level", "type", "level"],
  unit: ["unit", "measure", "uom", "unit_of_measure"],
  price: ["price", "value", "amount", "price_rwf", "unit_price", "igiciro"],
  currency: ["currency", "ifaranga"],
};

export function detectColumns(headers: string[]): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  const normHeaders = headers.map((h) => ({ raw: h, norm: normalizeText(h).replace(/\s+/g, "_") }));
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const hit =
      normHeaders.find((h) => aliases.includes(h.norm)) ??
      normHeaders.find((h) => aliases.some((a) => h.norm.includes(a)));
    map[field] = hit ? hit.raw : null;
  }
  return map;
}

const CHANNEL_MAP: Record<string, PriceChannel> = {
  farmgate: "farmgate",
  "farm gate": "farmgate",
  farm_gate: "farmgate",
  farm: "farmgate",
  producer: "farmgate",
  "producer price": "farmgate",
  wholesale: "wholesale",
  "whole sale": "wholesale",
  bulk: "wholesale",
  retail: "retail",
  consumer: "retail",
};

export function parsePrice(value: string): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseDate(value: string): string | null {
  if (!value) return null;
  const v = value.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v);
  if (m) return iso(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(v);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    if (month > 0) return iso(+m[3], month, +m[1]);
  }
  m = /^([A-Za-z]+)\.?\s+(\d{4})$/.exec(v);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    if (month > 0) return iso(+m[2], month, 1);
  }
  m = /^(?:[A-Za-z]{3},?\s+)?([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})\b/.exec(v);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    if (month > 0) return iso(+m[3], month, +m[2]);
  }
  m = /^(\d{4})-(\d{2})-(\d{2})[T\s]/.exec(v);
  if (m) return iso(+m[1], +m[2], +m[3]);
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

export const commodityCandidates = COMMODITIES.map((c) => ({
  canonical: c.name,
  aliases: c.synonyms,
}));
export const marketCandidates = MARKETS.map((m) => ({
  canonical: m.name,
  aliases: m.source.toLowerCase() === m.name.toLowerCase() ? [] : [m.source],
}));

/** Exact registry spelling first ("Kicukiro Market" is a market name); otherwise match without the word "market". */
export function rankMarketName(rawValue: string) {
  const exact = rankEntityMatches(rawValue, marketCandidates, 3, MARKET_AUTO_ACCEPT);
  if (exact.matches[0] && exact.matches[0].score >= 0.999 && !exact.ambiguous) return exact;
  return rankEntityMatches(
    rawValue.replace(/\bmarket\b/gi, " "),
    marketCandidates,
    3,
    MARKET_AUTO_ACCEPT,
  );
}

export interface StandardizeOutput {
  records: DataRecord[];
  issues: Issue[];
  lineage: LineageEntry[];
  /** Commodity or market names that needed the TF-IDF character model. */
  embeddingRows: number;
}

type EntityIssue = Omit<Issue, "id" | "recordId">;
interface EntityMatch {
  value: string;
  confidence: number;
  embedded: boolean;
  issue?: EntityIssue;
}

let issueSeq = 0;
export function nextIssueId() {
  issueSeq += 1;
  return `iss-${issueSeq}-${Math.random().toString(36).slice(2, 7)}`;
}

export function standardize(
  rows: Record<string, string>[],
  columns: Record<string, string | null>,
  analyzedAt: string,
  onRows?: (done: number) => void,
): StandardizeOutput {
  const records: DataRecord[] = [];
  const issues: Issue[] = [];
  const lineage: LineageEntry[] = [];
  let embeddingRows = 0;
  const matchCache = new Map<string, EntityMatch>();
  const marketByName = new Map(MARKETS.map((m) => [m.name, m]));
  const unitByCommodity = new Map(COMMODITIES.map((c) => [c.name, c.unit]));

  rows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const id = `rec-${index + 1}`;
    const get = (field: string) => (columns[field] ? (raw[columns[field]!] ?? "").trim() : "");

    const trace: DataRecord["trace"] = {};
    const addTrace = (
      field: string,
      original: string,
      normalized: string,
      rule: string,
      confidence = 1,
    ) => {
      trace[field] = { original, normalized, rule };
      if (original !== normalized) {
        lineage.push({
          id: `${id}-${field}`,
          stage: "Standardization",
          recordId: id,
          field,
          before: original || "(empty)",
          after: normalized || "(empty)",
          rule,
          confidence,
          timestamp: analyzedAt,
          actor: "system",
        });
      }
    };

    // date
    const rawDate = get("date");
    const parsedDate = parseDate(rawDate);
    addTrace("date", rawDate, parsedDate ?? "", "ISO-8601 date normalisation");

    // commodity + market: tiered catalog matching, once per distinct name
    const matchEntity = (kind: "commodity" | "market", rawValue: string) => {
      const key = `${kind}|${rawValue}`;
      let match = matchCache.get(key);
      if (!match) {
        match = resolveEntity(kind, rawValue);
        matchCache.set(key, match);
      }
      if (match.embedded) embeddingRows += 1;
      if (match.issue) issues.push({ ...match.issue, id: nextIssueId(), recordId: id });
      return match;
    };
    const resolveEntity = (kind: "commodity" | "market", rawValue: string): EntityMatch => {
      const isMarket = kind === "market";
      const label = isMarket ? "Market" : "Commodity";
      let value = titleCase(normalizeText(rawValue));
      let confidence = 1;
      let embedded = false;
      let issue: EntityIssue | undefined;
      if (!rawValue) return { value, confidence, embedded };

      const autoAccept = isMarket ? MARKET_AUTO_ACCEPT : COMMODITY_AUTO_ACCEPT;
      const reviewMin = isMarket ? MARKET_REVIEW_MIN : COMMODITY_REVIEW_MIN;
      const archived = isMarket
        ? undefined
        : ARCHIVED_COMMODITIES.get(normalizeText(rawValue).toLowerCase());
      if (archived) {
        issue = {
          type: "ENTITY_MATCH",
          category: "match",
          severity: "medium",
          confidence: 1,
          title: `Commodity is archived in the e-Soko catalog: "${rawValue}"`,
          explanation: `"${archived.name}" (product ${archived.id}, code ${archived.code}) is marked archived in the e-Soko catalog, but prices are still being recorded for it.`,
          evidence: [
            { label: "Catalog product", value: `${archived.name} · id ${archived.id}` },
            { label: "Catalog status", value: "Archived" },
          ],
          recommendation:
            "Confirm whether this product is still collected. If it is, restore it in the catalog; if not, stop collecting it.",
          method: "Exact lookup in the archived part of the e-Soko catalog",
          status: "open",
        };
        return { value: archived.name, confidence: 1, embedded, issue };
      }
      const ranked = isMarket
        ? rankMarketName(rawValue)
        : rankEntityMatches(rawValue, commodityCandidates, 3, autoAccept);
      embedded = ranked.usedEmbedding;
      const matches = ranked.matches;
      const top = matches[0];
      const method = embedded
        ? `Fuzzy match checked by a TF-IDF character model fitted on the ${isMarket ? "market registry" : "commodity catalog"}${ranked.modelAgrees ? " (models agree)" : " (models disagree)"}`
        : `${isMarket ? "Market registry" : "Catalog"} lookup (normalisation, edit distance, token overlap, e-Soko names)`;
      const evidence = matches.map((m) => ({
        label: m.value,
        value: `${Math.round(m.score * 100)}% — ${m.reason}`,
      }));

      if (top && top.score >= reviewMin) {
        value = top.value;
        confidence = top.score;
        if (ranked.ambiguous) {
          const tied = matches.filter((m) => top.score - m.score < TIE_MARGIN).map((m) => m.value);
          issue = {
            type: "ENTITY_MATCH",
            category: "match",
            severity: "medium",
            confidence: top.score,
            title: `${label} name matches ${tied.length} catalog entries: "${rawValue}"`,
            explanation: `"${rawValue}" fits ${tied.map((t) => `"${t}"`).join(" and ")} equally well. The catalog has more than one entry with this name, so a person must choose.`,
            evidence,
            recommendation: `Choose the correct ${kind}. "${top.value}" is shown first only because of catalog order.`,
            method,
            suggestion: { field: kind, value: top.value },
            status: "open",
          };
        } else if (top.score < autoAccept) {
          issue = {
            type: "ENTITY_MATCH",
            category: "match",
            severity: isMarket || top.score >= 0.78 ? "low" : "medium",
            confidence: top.score,
            title: `${label} name needs confirmation: "${rawValue}"`,
            explanation: `"${rawValue}" is not an exact ${isMarket ? "registry" : "catalog"} entry. The closest match is "${top.value}".`,
            evidence,
            recommendation: `Map to "${top.value}" or choose another ${kind}.`,
            method,
            suggestion: { field: kind, value: top.value },
            status: "open",
          };
        }
      } else {
        issue = {
          type: "UNKNOWN_ENTITY",
          category: "match",
          severity: "high",
          confidence: 0.88,
          title: `Unknown ${kind}: "${rawValue}"`,
          explanation: isMarket
            ? `"${rawValue}" is not in the e-Soko registry of ${MARKETS.length} markets.`
            : `"${rawValue}" does not resemble any of the ${COMMODITIES.length} commodities in the e-Soko catalog.`,
          evidence: matches.map((m) => ({
            label: m.value,
            value: `${Math.round(m.score * 100)}% similarity`,
          })),
          recommendation: isMarket
            ? "Correct the market name or register the market."
            : "Correct the commodity name or add it to the catalog.",
          method,
          status: "open",
        };
      }
      return { value, confidence, embedded, issue };
    };

    const rawCommodity = get("commodity");
    const commodityMatch = matchEntity("commodity", rawCommodity);
    const commodity = commodityMatch.value;
    addTrace(
      "commodity",
      rawCommodity,
      commodity,
      commodityMatch.embedded
        ? "Catalog match checked by TF-IDF character model"
        : "Commodity catalog matching",
      commodityMatch.confidence,
    );

    const rawMarket = get("market");
    const marketMatch = matchEntity("market", rawMarket);
    const market = marketMatch.value;
    addTrace(
      "market",
      rawMarket,
      market,
      marketMatch.embedded
        ? "Registry match checked by TF-IDF character model"
        : "Market registry matching",
      marketMatch.confidence,
    );

    // geography derived from registry (authoritative)
    const registry = marketByName.get(market);
    const rawDistrict = get("district");
    const rawProvince = get("province");
    const district = registry?.district ?? titleCase(normalizeText(rawDistrict));
    const province =
      registry?.province ??
      DISTRICTS.find((d) => d.name.toLowerCase() === normalizeText(rawProvince))?.province ??
      titleCase(normalizeText(rawProvince));
    addTrace("district", rawDistrict, district, "Derived from market registry");
    addTrace("province", rawProvince, province, "Derived from market registry");

    // channel
    const rawChannel = get("channel");
    const channelKey = normalizeText(rawChannel);
    const channel = (CHANNEL_MAP[channelKey] ??
      CHANNEL_MAP[channelKey.replace(/\s/g, "")] ??
      "") as PriceChannel | "";
    addTrace("channel", rawChannel, channel, "Price-channel vocabulary mapping");

    // unit
    const rawUnit = get("unit");
    let unit = normalizeText(rawUnit).replace(/s$/, "");
    if (["kg", "kilo", "kilogram", "kgs"].includes(unit)) unit = "kg";
    if (["l", "litre", "liter", "lt"].includes(unit)) unit = "litre";
    if (["pc", "piece", "unit", "egg"].includes(unit)) unit = "piece";
    addTrace("unit", rawUnit, unit, "Unit-of-measure normalisation");

    // price
    const rawPrice = get("price");
    const price = parsePrice(rawPrice);
    addTrace(
      "price",
      rawPrice,
      price === null ? "" : String(price),
      "Numeric + currency normalisation",
    );

    const currency = (get("currency") || "RWF").toUpperCase();

    records.push({
      id,
      rowNumber,
      date: parsedDate ?? "",
      province,
      district,
      market,
      commodity,
      unit,
      channel,
      price,
      currency,
      trace,
      raw,
    });

    // rule based validation (layer 1)
    const missing: string[] = [];
    if (!parsedDate) missing.push("date");
    if (!commodity) missing.push("commodity");
    if (!market) missing.push("market");
    if (!channel) missing.push("price type");
    if (price === null) missing.push("price");

    if (rawDate && !parsedDate) {
      issues.push({
        id: nextIssueId(),
        recordId: id,
        type: "INVALID_DATE",
        category: "conflict",
        severity: "high",
        confidence: 1,
        title: `Unreadable date "${rawDate}"`,
        explanation:
          "The date could not be interpreted with any known format (ISO, dd/mm/yyyy, d Month yyyy).",
        evidence: [{ label: "Raw value", value: rawDate }],
        recommendation: "Provide the observation date as YYYY-MM-DD.",
        method: "Rule-based validation (Layer 1)",
        status: "open",
      });
    }

    if (missing.length) {
      issues.push({
        id: nextIssueId(),
        recordId: id,
        type: "MISSING_VALUE",
        category: "conflict",
        severity:
          missing.includes("price") || missing.includes("commodity") ? "critical" : "medium",
        confidence: 1,
        title: `Missing required ${missing.length > 1 ? "fields" : "field"}: ${missing.join(", ")}`,
        explanation:
          "Required reporting fields are empty. A missing price is not the same as a price of zero — this observation was never reported.",
        evidence: [
          { label: "Row", value: `#${rowNumber}` },
          { label: "Missing", value: missing.join(", ") },
        ],
        recommendation: "Ask the reporting market to resubmit the missing values.",
        method: "Rule-based validation (Layer 1)",
        status: "open",
      });
    }

    if (price !== null && price <= 0) {
      issues.push({
        id: nextIssueId(),
        recordId: id,
        type: "INVALID_PRICE",
        category: "conflict",
        severity: "critical",
        confidence: 1,
        title: price === 0 ? "Price recorded as zero" : "Negative price recorded",
        explanation:
          price === 0
            ? "A zero price is impossible for a traded commodity. This usually means the market did not report, which must be recorded as missing data rather than zero."
            : "A negative price is impossible and indicates a data-entry error.",
        evidence: [
          { label: "Observed", value: `${price} ${currency}` },
          { label: "Valid range", value: "> 0 RWF" },
        ],
        recommendation: "Correct the price or mark the observation as not reported.",
        method: "Rule-based validation (Layer 1)",
        status: "open",
      });
    }

    if (unit && !VALID_UNITS.includes(unit)) {
      issues.push({
        id: nextIssueId(),
        recordId: id,
        type: "UNIT_INCONSISTENCY",
        category: "conflict",
        severity: "medium",
        confidence: 0.85,
        title: `Unrecognised unit "${rawUnit}"`,
        explanation: `Units must be one of ${VALID_UNITS.join(", ")} so that prices are comparable across markets.`,
        evidence: [{ label: "Raw unit", value: rawUnit }],
        recommendation: "Convert the observation to a standard unit.",
        method: "Rule-based validation (Layer 1)",
        status: "open",
      });
    }

    const expectedUnit = unitByCommodity.get(commodity);
    if (expectedUnit && unit && VALID_UNITS.includes(unit) && unit !== expectedUnit) {
      issues.push({
        id: nextIssueId(),
        recordId: id,
        type: "UNIT_INCONSISTENCY",
        category: "conflict",
        severity: "medium",
        confidence: 0.8,
        title: `Unit mismatch for ${commodity}`,
        explanation: `${commodity} is normally reported in ${expectedUnit}, but this observation uses ${unit}.`,
        evidence: [
          { label: "Reported unit", value: unit },
          { label: "Catalog unit", value: expectedUnit },
        ],
        recommendation: `Convert the price to ${expectedUnit}.`,
        method: "Catalog consistency check",
        suggestion: { field: "unit", value: expectedUnit },
        status: "open",
      });
    }

    if (onRows && ((index + 1) % 500 === 0 || index + 1 === rows.length)) onRows(index + 1);
  });

  return { records, issues, lineage, embeddingRows };
}
