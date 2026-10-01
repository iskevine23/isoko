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
    is_market = kind == "market"
    noun = "market" if is_market else "product"
    evidence = [(c.value, f"{c.score * 100:.0f}% — {c.reason}") for c in m.candidates]
    raw = m.input
    if m.status in ("exact", "auto", "empty"):
        return None
    if m.status == "archived":
        c = load_catalog().archived_by_name(raw)
        return issue(
            row.id, "ENTITY_MATCH", "match", "medium", 1.0,
            f'Discontinued product: "{raw}"',
            f'"{c.name}" (code {c.code}) is no longer on the list of products whose prices are collected, '
            "but this file still reports a price for it.",
            [("Product", f"{c.name} · code {c.code}"), ("Status", "Discontinued (archived)")],
            "Check whether this product should still be collected. If yes, ask an administrator to restore it; "
            "if not, remove the row.",
            m.method,
        )
    if m.status == "unknown":
        cat = load_catalog()
        return issue(
            row.id, "UNKNOWN_ENTITY", "match", "high", 0.88,
            f'Not a known market: "{raw}"' if is_market else f'Not a known agricultural product: "{raw}"',
            f'"{raw}" does not match any of the {len(cat.markets)} markets where prices are collected, '
            "and no similar name was found." if is_market else
            f'"{raw}" does not match any of the {len(cat.commodities)} agricultural products tracked in Rwandan '
            "markets, and no similar name was found. It may be misspelled, not an agricultural product, or a "
            "product that is not tracked yet.",
            [(c.value, f"{c.score * 100:.0f}% similar (too low to match)") for c in m.candidates],
            "Correct the market name if it is misspelled, or ask an administrator to register this market."
            if is_market else
            "Correct the name if it is misspelled. If it is a real agricultural product, ask an administrator "
            "to add it; otherwise remove the row.",
            m.method,
        )
    if m.status == "ambiguous":
        tied = [c.value for c in m.candidates if m.candidates[0].score - c.score < 0.02]
        return issue(
            row.id, "ENTITY_MATCH", "match", "medium", m.score,
            f'Unclear {noun}: "{raw}" matches {len(tied)} {noun}s',
            f'"{raw}" fits {" and ".join(chr(34) + t + chr(34) for t in tied)} equally well, '
            "so the system cannot tell which one was meant.",
            evidence, f'Choose the correct {noun}. "{m.value}" is listed first only by order, not because it is more likely.',
            m.method, (kind, m.value),
        )
    return issue(
        row.id, "ENTITY_MATCH", "match", "low" if is_market or m.score >= 0.78 else "medium", m.score,
        f'Check the {noun} name: "{raw}"',
        f'"{raw}" is not a known {noun} name, but it looks like "{m.value}" ({m.score * 100:.0f}% similar). '
        "It was not changed automatically because the match is not certain enough.",
        evidence, f'If "{raw}" means "{m.value}", accept the suggestion. Otherwise choose the correct {noun}.',
        m.method, (kind, m.value),
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
