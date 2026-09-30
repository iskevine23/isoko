"""Reads uploads (CSV, raw e-Soko JSON exports, flat JSON) into normalised rows."""

from __future__ import annotations

import io
import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime

import pandas as pd

from .catalog import load_catalog

ESOKO_PROVINCE = {1: "Southern Province", 2: "Western Province", 3: "Northern Province", 4: "Eastern Province", 5: "Kigali City"}
TABLE_HEADERS = ["date", "province", "district", "market", "commodity", "price_type", "unit", "price", "esoko_id"]

COLUMN_ALIASES = {
    "date": ["date", "observation_date", "price_date", "day", "itariki"],
    "province": ["province", "intara"],
    "district": ["district", "akarere"],
    "market": ["market", "market_name", "isoko", "marketname"],
    "commodity": ["commodity", "product", "crop", "item", "igicuruzwa"],
    "channel": ["price_type", "channel", "pricetype", "market_level", "type", "level"],
    "unit": ["unit", "measure", "uom", "unit_of_measure"],
    "price": ["price", "value", "amount", "price_rwf", "unit_price", "igiciro"],
}

CHANNEL_MAP = {
    "farmgate": "farmgate", "farm gate": "farmgate", "farm_gate": "farmgate", "farm": "farmgate",
    "producer": "farmgate", "producer price": "farmgate",
    "wholesale": "wholesale", "whole sale": "wholesale", "wholesaler": "wholesale", "bulk": "wholesale",
    "retail": "retail", "retailer": "retail", "consumer": "retail",
}


@dataclass
class Table:
    headers: list[str]
    rows: list[dict[str, str]]
    errors: list[str] = field(default_factory=list)


@dataclass
class Row:
    id: str
    row_number: int
    date: str
    province: str
    district: str
    market_raw: str
    commodity_raw: str
    channel: str
    unit: str
    price: float | None
    raw: dict[str, str]


def _norm_header(h: str) -> str:
    return re.sub(r"\s+", "_", re.sub(r"[^a-z0-9 _]", " ", h.strip().lower())).strip("_")


def detect_columns(headers: list[str]) -> dict[str, str | None]:
    norm = [(h, _norm_header(h)) for h in headers]
    out: dict[str, str | None] = {}
    for fld, aliases in COLUMN_ALIASES.items():
        hit = next((h for h, n in norm if n in aliases), None) or next(
            (h for h, n in norm if any(a in n for a in aliases)), None
        )
        out[fld] = hit
    return out


def parse_price(value: str) -> float | None:
    cleaned = re.sub(r"[^0-9.\-]", "", value or "")
    if cleaned in ("", "-", "."):
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def parse_date(value: str) -> str:
    v = (value or "").strip()
    if not v:
        return ""
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d %B %Y", "%d %b %Y", "%B %Y", "%b %Y"):
        try:
            return datetime.strptime(v, fmt).date().isoformat()
        except ValueError:
            pass
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})[T\s]", v)
    if m:
        try:
            return date(int(m[1]), int(m[2]), int(m[3])).isoformat()
        except ValueError:
            return ""
    return ""


def _clean_label(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def is_esoko_export(rows: list) -> bool:
    if not rows or not isinstance(rows[0], dict):
        return False
    first = rows[0]
    return (
        ("average_price" in first or "price_1" in first)
        and ("market_name" in first or "market" in first)
        and ("commodity_code" in first or "product" in first)
    )


def _row_price(row: dict) -> float | None:
    avg = row.get("average_price")
    if isinstance(avg, (int, float)):
        return float(avg)
    values = [row.get(k) for k in ("price_1", "price_2", "price_3")]
    values = [float(v) for v in values if isinstance(v, (int, float))]
    return sum(values) / len(values) if values else None


def esoko_to_table(rows: list[dict]) -> Table:
    ambiguous = load_catalog().ambiguous_local_names
    out = []
    for row in rows:
        product = row.get("product") if isinstance(row.get("product"), dict) else {}
        market = row.get("market") if isinstance(row.get("market"), dict) else {}
        local = _clean_label(product.get("commodity_name") or row.get("commodity_name"))
        english = _clean_label(product.get("commodity_name_en") or row.get("commodity_name_en"))
        province = market.get("province")
        pid = province.get("id") if isinstance(province, dict) else province if isinstance(province, int) else None
        price = _row_price(row)
        out.append({
            "date": str(row.get("created_on") or row.get("entry_date") or "")[:10],
            "province": ESOKO_PROVINCE.get(pid, "") if pid is not None else "",
            "district": str(market.get("district") or ""),
            "market": str(market.get("name") or row.get("market_name") or ""),
            "commodity": english if local.lower() in ambiguous and english else (local or english),
            "price_type": str(row.get("price_type") or ""),
            "unit": str(product.get("commodity_unit") or ""),
            "price": "" if price is None else repr(price),
            "esoko_id": str(row.get("id", "")),
        })
    return Table(TABLE_HEADERS, out)


def json_to_table(value) -> Table:
    if isinstance(value, dict) and isinstance(value.get("headers"), list) and isinstance(value.get("rows"), list):
        headers = [str(h) for h in value["headers"]]
        return Table(headers, [{h: str(r.get(h, "") or "") for h in headers} for r in value["rows"] if isinstance(r, dict)])
    rows = value if isinstance(value, list) else value.get("data") if isinstance(value, dict) else None
    if not isinstance(rows, list):
        raise ValueError('The JSON must contain an array of price records, {"data": [...]}, or {"headers": [...], "rows": [...]}.')
    if is_esoko_export(rows):
        return esoko_to_table(rows)
    headers: list[str] = []
    for r in rows:
        if isinstance(r, dict):
            headers.extend(k for k in r if k not in headers)
    table_rows = [
        {h: "" if r.get(h) is None or isinstance(r.get(h), (dict, list)) else str(r.get(h)) for h in headers}
        for r in rows
        if isinstance(r, dict)
    ]
    return Table(headers, table_rows)


def read_upload(content: bytes, filename: str) -> Table:
    text = content.decode("utf-8-sig", errors="replace")
    if filename.lower().endswith(".json") or text.lstrip()[:1] in ("[", "{"):
        try:
            return json_to_table(json.loads(text))
        except json.JSONDecodeError as exc:
            raise ValueError(f"{filename}: not valid JSON ({exc.msg}).") from exc
    if filename.lower().endswith((".xlsx", ".xls")):
        raise ValueError(f"{filename}: export Excel sheets as CSV first.")
    errors: list[str] = []
    try:
        df = pd.read_csv(io.StringIO(text), dtype=str, keep_default_na=False, sep=None, engine="python",
                         on_bad_lines=lambda bad: errors.append(f"Skipped malformed line: {bad[:6]}") or None)
    except Exception as exc:  # pandas raises several parser error types
        raise ValueError(f"{filename}: could not read CSV ({exc}).") from exc
    return Table([str(c) for c in df.columns], df.to_dict(orient="records"), errors)


def merge_tables(tables: list[Table]) -> Table:
    headers: list[str] = []
    for t in tables:
        headers.extend(h for h in t.headers if h not in headers)
    rows = [{h: str(r.get(h, "") or "") for h in headers} for t in tables for r in t.rows]
    return Table(headers, rows, [e for t in tables for e in t.errors])


def normalise(table: Table) -> tuple[list[Row], dict[str, str | None]]:
    cols = detect_columns(table.headers)

    def get(raw: dict, fld: str) -> str:
        col = cols.get(fld)
        return str(raw.get(col, "") or "").strip() if col else ""

    rows = []
    for i, raw in enumerate(table.rows):
        channel_raw = get(raw, "channel").lower().replace("-", " ").strip()
        rows.append(Row(
            id=f"rec-{i + 1}",
            row_number=i + 2,
            date=parse_date(get(raw, "date")),
            province=get(raw, "province"),
            district=get(raw, "district"),
            market_raw=get(raw, "market"),
            commodity_raw=get(raw, "commodity"),
            channel=CHANNEL_MAP.get(channel_raw, CHANNEL_MAP.get(channel_raw.replace(" ", ""), "")),
            unit=get(raw, "unit").lower(),
            price=parse_price(get(raw, "price")),
            raw={k: str(v) for k, v in raw.items()},
        ))
    return rows, cols
