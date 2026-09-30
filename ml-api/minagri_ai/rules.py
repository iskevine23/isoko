"""Layers 1 and 3: deterministic validation and the farm gate ≤ wholesale ≤ retail ladder."""

from __future__ import annotations

import pandas as pd

from .issues import issue, rwf
from .statistics import CHANNEL_LABEL, priced

MAX_FARM_TO_RETAIL = 3.0


def detect_invalid_prices(df: pd.DataFrame) -> list[dict]:
    out = []
    for r in df.itertuples():
        if r.price is not None and not pd.isna(r.price) and r.price <= 0:
            out.append(issue(
                r.id, "INVALID_PRICE", "completeness", "high", 0.97,
                f"Non-positive price for {r.commodity or 'a commodity'}",
                f"A price of {r.price:g} RWF cannot be a market price.",
                [("Observed", f"{r.price:g}")],
                "Enter the actual price or leave it blank if it was not collected.",
                "Rule: price must be greater than zero (Layer 1)",
            ))
    return out


def detect_ladder_violations(df: pd.DataFrame) -> list[dict]:
    out: list[dict] = []
    p = priced(df)
    p = p[p["market"] != ""]
    for _, group in p.groupby(["date", "market", "commodity"]):
        by = {r.channel: r for r in group.itertuples()}
        farm, ws, retail = by.get("farmgate"), by.get("wholesale"), by.get("retail")

        def check(low, high):
            if low is None or high is None or low.price <= high.price:
                return
            gap = (low.price - high.price) / high.price * 100
            lo, hi = CHANNEL_LABEL[low.channel], CHANNEL_LABEL[high.channel]
            # Retail below farm gate is never accepted, whatever the gap.
            retail_below_farm = low.channel == "farmgate" and high.channel == "retail"
            out.append(issue(
                high.id, "LADDER_VIOLATION", "conflict",
                "critical" if retail_below_farm else "high" if gap > 30 else "medium", 0.75 + gap / 200,
                "Retail price below farm-gate price" if retail_below_farm else f"Pricing ladder violation — {lo} above {hi}",
                f"For {high.commodity} at {high.market}, the {lo.lower()} price ({rwf(low.price)}) is higher than the "
                f"{hi.lower()} price ({rwf(high.price)}). The expected order is farm gate ≤ wholesale ≤ retail.",
                [(lo, f"{rwf(low.price)} (row #{low.row_number})"), (hi, f"{rwf(high.price)} (row #{high.row_number})"),
                 ("Inversion", f"{gap:.1f}%")],
                "Correct the mis-recorded price or delete it. Retail can never be below farm gate."
                if retail_below_farm else "Confirm which of the two prices was mis-recorded.",
                "Contextual rule — farm gate ≤ wholesale ≤ retail (Layer 3)",
            ))

        check(farm, ws)
        check(ws, retail)
        check(farm, retail)
        if farm is not None and retail is not None and retail.price / farm.price > MAX_FARM_TO_RETAIL:
            ratio = retail.price / farm.price
            out.append(issue(
                retail.id, "PRICE_ANOMALY", "anomaly", "high", 0.7 + (ratio - 3) / 10,
                f"Extreme farm-to-retail markup for {retail.commodity}",
                f"The retail price is {ratio:.1f}× the farm-gate price at {retail.market}; markups above "
                f"{MAX_FARM_TO_RETAIL:.0f}× usually mean a unit or entry error.",
                [("Farm gate", rwf(farm.price)), ("Retail", rwf(retail.price)), ("Markup", f"{(ratio - 1) * 100:.0f}%")],
                "Check whether the retail price was entered for a different unit or quantity.",
                "Contextual channel-ratio rule (Layer 3)",
            ))
    return out
