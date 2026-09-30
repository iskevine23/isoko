"""Relative price features for the Isolation Forest.

Raw prices are never used alone: goat meat and eggs live on different scales,
so every feature is a log ratio or a robust z-score inside a peer group.
Changing this list or its order requires retraining (python train.py).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .config import MIN_PEERS
from .statistics import priced, robust_stats

FEATURES = [
    "Versus same commodity and channel",
    "Robust z-score",
    "Versus this market's usual level",
    "Versus this province's usual level",
    "Price channel",
    "Retail versus farm gate",
    "Wholesale versus farm gate",
    "Retail versus wholesale",
]
CHANNEL_CODE = {"farmgate": 0, "wholesale": 1, "retail": 2}


def _log(v):
    return np.log(np.maximum(v, 1e-6))


def _pct(ratio: float) -> str:
    p = round((ratio - 1) * 100)
    return f"{'+' if p >= 0 else ''}{p}%"


@dataclass
class FeatureFrame:
    frame: pd.DataFrame  # priced rows with id, peer_median, peer_count
    X: np.ndarray
    signal: np.ndarray  # distance from typical per feature; 0 for imputed features
    display: list[list[str]]


def build_features(df: pd.DataFrame) -> FeatureFrame:
    p = priced(df).copy().reset_index(drop=True)
    if p.empty:
        return FeatureFrame(p, np.zeros((0, len(FEATURES))), np.zeros((0, len(FEATURES))), [])

    stats = {key: robust_stats(g["price"]) for key, g in p.groupby(["commodity", "channel"])}
    st = [stats[(c, ch)] for c, ch in zip(p["commodity"], p["channel"])]
    p["peer_median"] = [s.median for s in st]
    p["peer_count"] = [s.n for s in st]
    enough = p["peer_count"] >= MIN_PEERS
    ratio = np.where(enough, p["price"] / np.maximum(p["peer_median"], 1e-9), 1.0)
    z = np.where(enough, np.clip([s.z(v) for s, v in zip(st, p["price"])], -8, 8), 0.0)
    p["ratio"] = ratio

    med_market = p.groupby("market")["ratio"].median()
    med_province = p.groupby("province")["ratio"].median()
    market_res = ratio / np.maximum(p["market"].map(med_market).fillna(1.0).to_numpy(), 1e-9)
    province_res = ratio / np.maximum(p["province"].map(med_province).fillna(1.0).to_numpy(), 1e-9)

    ladder = p.pivot_table(index=["date", "market", "commodity"], columns="channel", values="price", aggfunc="first")
    for ch in CHANNEL_CODE:
        if ch not in ladder:
            ladder[ch] = np.nan

    def typical(a, b, default):
        v = _log(ladder[a] / ladder[b]).dropna()
        return float(v.median()) if len(v) else float(np.log(default))

    t_rf, t_wf, t_rw = typical("retail", "farmgate", 1.3), typical("wholesale", "farmgate", 1.1), typical("retail", "wholesale", 1.1)
    keys = list(zip(p["date"], p["market"], p["commodity"]))
    lf = ladder.reindex(keys)
    farm, ws = lf["farmgate"].to_numpy(), lf["wholesale"].to_numpy()
    on_retail, on_ws = (p["channel"] == "retail").to_numpy(), (p["channel"] == "wholesale").to_numpy()
    price = p["price"].to_numpy()
    has_rf, has_wf, has_rw = on_retail & ~np.isnan(farm), on_ws & ~np.isnan(farm), on_retail & ~np.isnan(ws)
    with np.errstate(invalid="ignore", divide="ignore"):
        rf = np.where(has_rf, _log(price / farm), t_rf)
        wf = np.where(has_wf, _log(price / farm), t_wf)
        rw = np.where(has_rw, _log(price / ws), t_rw)

    X = np.column_stack([
        _log(ratio), z, _log(market_res), _log(province_res),
        p["channel"].map(CHANNEL_CODE).to_numpy(dtype=float), rf, wf, rw,
    ])
    signal = np.column_stack([
        np.abs(_log(ratio)), np.abs(z) / 4, np.abs(_log(market_res)), np.abs(_log(province_res)), np.zeros(len(p)),
        np.where(has_rf, np.abs(rf - t_rf), 0), np.where(has_wf, np.abs(wf - t_wf), 0), np.where(has_rw, np.abs(rw - t_rw), 0),
    ])
    display = []
    for i in range(len(p)):
        n = int(p.at[i, "peer_count"])
        peers = f"{n} {p.at[i, 'channel']} observations" if enough[i] else f"only {n} comparable market{'s' if n != 1 else ''}"
        display.append([
            f"{_pct(ratio[i])} versus the median of {peers}" if enough[i] else f"not compared ({peers})",
            f"{z[i]:+.2f} within {peers}" if enough[i] else f"not compared ({peers})",
            f"{_pct(market_res[i])} after allowing for this market's usual level",
            f"{_pct(province_res[i])} after allowing for this province's usual level",
            str(p.at[i, "channel"]),
            f"retail is {_pct(np.exp(rf[i]))} over farm gate (typical {_pct(np.exp(t_rf))})" if has_rf[i] else "not compared on this channel",
            f"wholesale is {_pct(np.exp(wf[i]))} over farm gate (typical {_pct(np.exp(t_wf))})" if has_wf[i] else "not compared on this channel",
            f"retail is {_pct(np.exp(rw[i]))} over wholesale (typical {_pct(np.exp(t_rw))})" if has_rw[i] else "not compared on this channel",
        ])
    return FeatureFrame(p, X, signal, display)
