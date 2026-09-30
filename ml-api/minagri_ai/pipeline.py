"""End-to-end analysis: ingest → matching engine → anomaly engine → findings for the Review Center."""

from __future__ import annotations

import time
from datetime import datetime, timezone

import pandas as pd

from .anomaly import run_anomaly_engine
from .catalog import load_catalog
from .ingest import Row, Table, normalise
from .issues import issue
from .matching import MatchResult, embedder_status, engine


def _title(s: str) -> str:
    return " ".join(w.capitalize() for w in s.split())


def _entity_issue(row: Row, kind: str, m: MatchResult) -> dict | None:
    label = kind.capitalize()
    registry = "registry" if kind == "market" else "catalog"
    evidence = [(c.value, f"{c.score * 100:.0f}% — {c.reason}") for c in m.candidates]
    raw = m.input
    if m.status in ("exact", "auto", "empty"):
        return None
    if m.status == "archived":
        c = load_catalog().archived_by_name(raw)
        return issue(
            row.id, "ENTITY_MATCH", "match", "medium", 1.0,
            f'Commodity is archived in the e-Soko catalog: "{raw}"',
            f'"{c.name}" (product {c.id}, code {c.code}) is archived in the e-Soko catalog, but prices are still recorded for it.',
            [("Catalog product", f"{c.name} · id {c.id}"), ("Catalog status", "Archived")],
            "Confirm whether this product is still collected. If it is, restore it in the catalog; if not, stop collecting it.",
            m.method,
        )
    if m.status == "unknown":
        cat = load_catalog()
        size = len(cat.markets) if kind == "market" else len(cat.commodities)
        return issue(
            row.id, "UNKNOWN_ENTITY", "match", "high", 0.88, f'Unknown {kind}: "{raw}"',
            f'"{raw}" does not resemble any of the {size} entries in the e-Soko {registry}.',
            [(c.value, f"{c.score * 100:.0f}% similarity") for c in m.candidates],
            "Correct the market name or register the market." if kind == "market"
            else "Correct the commodity name or add it to the catalog.",
            m.method,
        )
    if m.status == "ambiguous":
        tied = [c.value for c in m.candidates if m.candidates[0].score - c.score < 0.02]
        return issue(
            row.id, "ENTITY_MATCH", "match", "medium", m.score,
            f'{label} name matches {len(tied)} {registry} entries: "{raw}"',
            f'"{raw}" fits {" and ".join(chr(34) + t + chr(34) for t in tied)} equally well, so a person must choose.',
            evidence, f'Choose the correct {kind}. "{m.value}" is listed first only because of catalog order.', m.method,
            (kind, m.value),
        )
    return issue(
        row.id, "ENTITY_MATCH", "match", "low" if kind == "market" or m.score >= 0.78 else "medium", m.score,
        f'{label} name needs confirmation: "{raw}"',
        f'"{raw}" is not an exact {registry} entry. The closest match is "{m.value}".',
        evidence, f'Map to "{m.value}" or choose another {kind}.', m.method, (kind, m.value),
    )


def coverage(records: list[dict]) -> dict:
    cat = load_catalog()
    reporting = {r["market"] for r in records if r["market"] and r["price"] is not None}
    provinces = []
    for prov in cat.provinces:
        markets = [m for m in cat.markets if m.province == prov]
        names = {m.name for m in markets}
        provinces.append({
            "name": prov,
            "markets": len(markets),
            "reporting": len(names & reporting),
            "observations": sum(1 for r in records if r["market"] in names and r["price"] is not None),
        })
    return {
        "reportingMarkets": len(reporting & {m.name for m in cat.markets}),
        "totalMarkets": len(cat.markets),
        "provinces": provinces,
        "missingProvinces": [p["name"] for p in provinces if p["reporting"] == 0],
    }


def analyze(table: Table, use_embedding: bool = True) -> dict:
    started = time.perf_counter()
    cat = load_catalog()
    rows, columns = normalise(table)
    commodity_matches = engine("commodity").match_many([r.commodity_raw for r in rows], use_embedding)
    market_matches = engine("market").match_many([r.market_raw for r in rows], use_embedding)

    records: list[dict] = []
    issues: list[dict] = []
    for r in rows:
        cm, mm = commodity_matches[r.commodity_raw], market_matches[r.market_raw]
        market = cat.market(mm.value) if mm.value else None
        records.append({
            "id": r.id,
            "rowNumber": r.row_number,
            "date": r.date,
            # district is the safer reference when the registry's province disagrees
            "province": market.province if market else _title(r.province),
            "district": market.district if market else _title(r.district),
            "market": mm.value or _title(r.market_raw),
            "commodity": cm.value or _title(r.commodity_raw),
            "unit": r.unit or (cat.commodity(cm.value).unit if cat.commodity(cm.value) else ""),
            "channel": r.channel,
            "price": r.price,
            "match": {"commodity": cm.to_dict(), "market": mm.to_dict()},
        })
        for kind, m in (("commodity", cm), ("market", mm)):
            found = _entity_issue(r, kind, m)
            if found:
                issues.append(found)

    df = pd.DataFrame(
        [{k: rec[k] for k in ("id", "rowNumber", "date", "province", "market", "commodity", "unit", "channel", "price")}
         for rec in records]
    ).rename(columns={"rowNumber": "row_number"})
    if df.empty:
        anomaly_issues, forest_report, _ = [], {"applied": False, "note": "No rows."}, []
    else:
        df["price"] = pd.to_numeric(df["price"], errors="coerce")
        anomaly_issues, forest_report, _ = run_anomaly_engine(df)
    issues += anomaly_issues

    embedded = {m.input for m in (*commodity_matches.values(), *market_matches.values()) if m.used_embedding}
    rows_compared = sum(1 for r in rows if r.commodity_raw in embedded or r.market_raw in embedded)
    status = embedder_status() if use_embedding else {"backend": "disabled", "sentenceTransformer": False}
    return {
        "engine": "minagri-ai-python",
        "analyzedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "elapsedMs": round((time.perf_counter() - started) * 1000),
        "columns": columns,
        "parseErrors": table.errors,
        "records": records,
        "issues": issues,
        "coverage": coverage(records),
        "ml": {
            "isolationForest": forest_report,
            "entityEmbeddings": {
                "rowsCompared": rows_compared,
                "backend": status["backend"],
                "note": (
                    f"{status['backend']} embeddings checked {rows_compared:,} rows whose commodity or market name "
                    "RapidFuzz could not settle on its own."
                    if rows_compared else "Every name matched exactly or with high RapidFuzz confidence; embeddings were not needed."
                ),
            },
        },
    }
