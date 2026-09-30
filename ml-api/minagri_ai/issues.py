"""Findings in the same shape as the web app's `Issue` type (src/lib/minagri/types.ts)."""

from __future__ import annotations

import itertools
import uuid

_seq = itertools.count(1)


def issue(
    record_id: str,
    type_: str,
    category: str,
    severity: str,
    confidence: float,
    title: str,
    explanation: str,
    evidence: list[tuple[str, str]],
    recommendation: str,
    method: str,
    suggestion: tuple[str, str | float] | None = None,
) -> dict:
    out = {
        "id": f"py-{next(_seq)}-{uuid.uuid4().hex[:5]}",
        "recordId": record_id,
        "type": type_,
        "category": category,
        "severity": severity,
        "confidence": round(float(min(max(confidence, 0.0), 0.99)), 4),
        "title": title,
        "explanation": explanation,
        "evidence": [{"label": label, "value": value} for label, value in evidence],
        "recommendation": recommendation,
        "method": method,
        "status": "open",
    }
    if suggestion is not None:
        out["suggestion"] = {"field": suggestion[0], "value": suggestion[1]}
    return out


def rwf(v: float) -> str:
    return f"{round(v):,} RWF"
