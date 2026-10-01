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
            zero = r.price == 0
            out.append(issue(
                r.id, "INVALID_PRICE", "completeness", "high", 0.97,
                "Price recorded as 0 RWF" if zero else f"Negative price recorded ({r.price:g} RWF)",
                "A product cannot sell for 0 RWF. A zero usually means the price was not collected; leave the cell "
                "empty instead, so it counts as missing rather than free." if zero else
                "A price cannot be below zero, so this is a data-entry error.",
                [("Observed", f"{r.price:g}")],
                "Enter the real price, or leave it empty if it was not collected." if zero else "Enter the correct price.",
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
                "Retail price is lower than farm-gate price" if retail_below_farm
                else f"{lo} price is higher than {hi.lower()} price",
                f"For {high.commodity} at {high.market}, the {lo.lower()} price ({rwf(low.price)}) is higher than the "
                f"{hi.lower()} price ({rwf(high.price)}). Prices normally rise from farm gate to wholesale to retail, "
                "so one of these two prices is probably wrong.",
                [(lo, f"{rwf(low.price)} (row #{low.row_number})"), (hi, f"{rwf(high.price)} (row #{high.row_number})"),
                 ("Inversion", f"{gap:.1f}%")],
                "Check both prices with the market reporter and correct the wrong one. Retail can never be lower "
                "than the farm-gate price." if retail_below_farm else
                "Check both prices with the market reporter and correct the one that was entered wrongly.",
                "Contextual rule — farm gate ≤ wholesale ≤ retail (Layer 3)",
            ))

        check(farm, ws)
        check(ws, retail)
        check(farm, retail)
        if farm is not None and retail is not None and retail.price / farm.price > MAX_FARM_TO_RETAIL:
            ratio = retail.price / farm.price
            out.append(issue(
                retail.id, "PRICE_ANOMALY", "anomaly", "high", 0.7 + (ratio - 3) / 10,
                f"{retail.commodity}: retail price is {ratio:.1f}× the farm-gate price",
                f"At {retail.market}, {retail.commodity} sells for {rwf(retail.price)} at retail but "
                f"{rwf(farm.price)} at farm gate, {ratio:.1f} times more. Markups above {MAX_FARM_TO_RETAIL:.0f} "
                "times are rare and usually mean one of the prices was entered for a different unit or quantity.",
                [("Farm gate", rwf(farm.price)), ("Retail", rwf(retail.price)), ("Markup", f"{(ratio - 1) * 100:.0f}%")],
                "Check whether the retail price was entered for a different unit or quantity.",
                "Contextual channel-ratio rule (Layer 3)",
            ))
    return out
