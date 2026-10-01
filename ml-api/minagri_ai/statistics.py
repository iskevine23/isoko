"""Layer 2: robust statistics inside commodity × price-channel peer groups."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .config import IQR_K, MIN_GROUP, ROBUST_Z_LIMIT
from .issues import issue, rwf

CHANNEL_LABEL = {"farmgate": "Farm gate", "wholesale": "Wholesale", "retail": "Retail"}


@dataclass
class RobustStats:
    n: int
    median: float
    mad: float
    q1: float
    q3: float

    @property
    def iqr(self) -> float:
        return self.q3 - self.q1

    @property
    def lower_fence(self) -> float:
        return self.q1 - IQR_K * self.iqr

    @property
    def upper_fence(self) -> float:
        return self.q3 + IQR_K * self.iqr

    def z(self, value: float) -> float:
        """Modified z-score (Iglewicz & Hoaglin); falls back to IQR, then 5% of the median, when MAD is zero."""
        # MAD ≈ 0.6745σ, so the fallbacks are expressed on the MAD scale.
        scale = self.mad or 0.6745 * self.iqr / 1.349 or 0.6745 * max(0.05 * self.median, 1.0)
        return 0.6745 * (value - self.median) / scale


def robust_stats(values) -> RobustStats:
    v = np.asarray(values, dtype=float)
    med = float(np.median(v))
    return RobustStats(
        n=len(v),
        median=med,
        mad=float(np.median(np.abs(v - med))),
        q1=float(np.quantile(v, 0.25)),
        q3=float(np.quantile(v, 0.75)),
    )


def compared_to_usual(price: float, median: float) -> str:
    """"about 6.3 times" / "62% above" / "only about 10% of" / "35% below", to read before "the usual … price"."""
    ratio = price / median
    if ratio >= 2:
        return f"about {ratio:.1f} times"
    if ratio > 1:
        return f"{round((ratio - 1) * 100)}% above"
    if ratio <= 0.5:
        return f"only about {round(ratio * 100)}% of"
    return f"{round((1 - ratio) * 100)}% below"


def likely_cause(price: float, median: float) -> str:
    ratio = price / median
    if ratio >= 7:
        return "This looks like an extra zero or a price entered for a larger unit."
    if ratio <= 1 / 7:
        return "This looks like a missing zero or a price entered for a smaller unit."
    if ratio > 1:
        return "It may be a typing error, a different unit, or a real local price rise."
    return "It may be a typing error, a different unit, or a real local price drop."


def priced(df: pd.DataFrame) -> pd.DataFrame:
    return df[(df["price"].notna()) & (df["price"] > 0) & (df["commodity"] != "") & (df["channel"] != "")]


def detect_price_outliers(df: pd.DataFrame) -> list[dict]:
    issues: list[dict] = []
    for (commodity, channel), group in priced(df).groupby(["commodity", "channel"]):
        if len(group) < MIN_GROUP:
            continue
        st = robust_stats(group["price"])
        label = CHANNEL_LABEL.get(channel, channel)
        for r in group.itertuples():
            z = st.z(r.price)
            outside = r.price < st.lower_fence or r.price > st.upper_fence
            if abs(z) < ROBUST_Z_LIMIT and not outside:
                continue
            high = r.price > st.median
            issues.append(issue(
                r.id, "PRICE_ANOMALY", "anomaly",
                "critical" if abs(z) > 8 else "high" if abs(z) > 5 else "medium",
                0.6 + min(abs(z), 12) / 20 + (0.08 if outside else 0),
                f"{commodity}: {label.lower()} price is unusually {'high' if high else 'low'}",
                f"At {r.market or 'this market'}, {commodity} is priced {rwf(r.price)}/{r.unit or 'kg'}, "
                f"{compared_to_usual(r.price, st.median)} the usual {label.lower()} price in other markets "
                f"({rwf(st.median)}, from {st.n} prices). {likely_cause(r.price, st.median)}",
                [
                    ("Observed", f"{rwf(r.price)}/{r.unit or 'kg'}"),
                    ("Expected range", f"{rwf(max(0, st.lower_fence))} – {rwf(st.upper_fence)}"),
                    ("Peer median", f"{rwf(st.median)} (n={st.n})"),
                    ("Robust z-score", f"{z:.2f}"),
                ],
                f"Check the price with the market reporter and correct it if it is wrong. "
                f"The usual price ({rwf(st.median)}) is suggested.",
                "Modified z-score (median/MAD) + IQR fence within commodity × price channel (Python AI API, Layer 2)",
                ("price", round(st.median)),
            ))
    return issues
