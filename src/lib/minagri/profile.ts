import { MARKETS, PROVINCES } from "./catalog";
import { mean } from "./stats";
import type { ColumnProfile, Coverage, DataRecord, Profile } from "./types";

export function buildProfile(
  rows: Record<string, string>[],
  headers: string[],
  records: DataRecord[],
): Profile {
  const columnProfiles: ColumnProfile[] = headers.map((h) => {
    const values = rows.map((r) => (r[h] ?? "").trim());
    const nonEmpty = values.filter((v) => v !== "");
    const numeric = nonEmpty.filter((v) => Number.isFinite(Number(v.replace(/[,\s]/g, ""))));
    const isNumeric = nonEmpty.length > 0 && numeric.length / nonEmpty.length > 0.9;
    const isDate = /date/i.test(h);
    const nums = numeric.map((v) => Number(v.replace(/[,\s]/g, "")));
    return {
      name: h,
      type: isDate ? "date" : isNumeric ? "numeric" : "categorical",
      missing: values.length - nonEmpty.length,
      unique: new Set(nonEmpty).size,
      sample: Array.from(new Set(nonEmpty)).slice(0, 4),
      min: isNumeric && nums.length ? Math.min(...nums) : undefined,
      max: isNumeric && nums.length ? Math.max(...nums) : undefined,
      mean: isNumeric && nums.length ? mean(nums) : undefined,
    };
  });

  const dates = records.map((r) => r.date).filter(Boolean).sort();
  const seen = new Set<string>();
  let duplicateRows = 0;
  for (const r of records) {
    const k = [r.date, r.market, r.commodity, r.channel].join("|");
    if (seen.has(k)) duplicateRows++;
    seen.add(k);
  }

  const channelCounts: Record<string, number> = {};
  records.forEach((r) => {
    const key = r.channel || "unknown";
    channelCounts[key] = (channelCounts[key] ?? 0) + 1;
  });

  return {
    rows: records.length,
    columns: headers.length,
    columnProfiles,
    missingCells: columnProfiles.reduce((a, c) => a + c.missing, 0),
    duplicateRows,
    commodities: new Set(records.map((r) => r.commodity).filter(Boolean)).size,
    markets: new Set(records.map((r) => r.market).filter(Boolean)).size,
    provinces: Array.from(new Set(records.map((r) => r.province).filter(Boolean))),
    districts: new Set(records.map((r) => r.district).filter(Boolean)).size,
    dateCoverage: {
      from: dates[0] ?? "",
      to: dates[dates.length - 1] ?? "",
      days: new Set(dates).size,
    },
    channelCounts,
  };
}

export function buildCoverage(records: DataRecord[]): Coverage {
  const reporting = new Set(records.map((r) => r.market).filter(Boolean));
  const provinces = PROVINCES.map((p) => {
    const marketsInProvince = MARKETS.filter((m) => m.province === p);
    const reportingHere = marketsInProvince.filter((m) => reporting.has(m.name));
    return {
      name: p,
      markets: marketsInProvince.length,
      reporting: reportingHere.length,
      observations: records.filter((r) => r.province === p).length,
    };
  });
  return {
    reportingMarkets: Array.from(reporting).filter((m) => MARKETS.some((x) => x.name === m)).length,
    totalMarkets: MARKETS.length,
    provinces,
    missingProvinces: provinces.filter((p) => p.observations === 0).map((p) => p.name),
  };
}
