"""Anomaly engine: rules (Layer 1/3), robust statistics (Layer 2) and a trained Isolation Forest (Layer 4)."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from .config import (
    CONTAMINATION,
    FEATURE_SET,
    FOREST_SUBSAMPLE,
    FOREST_TREES,
    MAX_NEW_SHARE,
    MIN_PEERS,
    MIN_SIGNAL,
    PRICE_MODEL_PATH,
)
from .features import FEATURES, build_features
from .issues import issue, rwf
from .rules import detect_invalid_prices, detect_ladder_violations
from .statistics import CHANNEL_LABEL, detect_price_outliers

log = logging.getLogger(__name__)


@dataclass
class PriceModel:
    forest: IsolationForest
    threshold: float  # on the anomaly scale: -score_samples, higher = more unusual
    feature_set: str
    features: list[str]
    trained_at: str
    training_data: dict

    @property
    def compatible(self) -> bool:
        return self.feature_set == FEATURE_SET and self.features == FEATURES

    def score(self, X: np.ndarray) -> np.ndarray:
        """Isolation Forest anomaly score in (0, 1]; 0.5 is average, near 1 is easy to isolate."""
        return -self.forest.score_samples(X)

    def save(self, path=PRICE_MODEL_PATH) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(self, path, compress=3)


def train_price_model(df: pd.DataFrame, training_data: dict, seed: int = 42) -> PriceModel:
    ff = build_features(df)
    forest = IsolationForest(
        n_estimators=FOREST_TREES,
        max_samples=min(FOREST_SUBSAMPLE, len(ff.X)),
        contamination="auto",
        random_state=seed,
        n_jobs=-1,
    ).fit(ff.X)
    scores = -forest.score_samples(ff.X)
    return PriceModel(
        forest=forest,
        threshold=float(np.round(np.quantile(scores, 1 - CONTAMINATION), 4)),
        feature_set=FEATURE_SET,
        features=list(FEATURES),
        trained_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        training_data=training_data,
    )


_model: PriceModel | None = None
_model_error: str | None = None


def load_price_model(reload: bool = False) -> PriceModel | None:
    global _model, _model_error
    if _model is None or reload:
        _model, _model_error = None, None
        if not PRICE_MODEL_PATH.exists():
            _model_error = f"No trained model at {PRICE_MODEL_PATH.name}. Run: python train.py"
        else:
            try:
                m = joblib.load(PRICE_MODEL_PATH)
                if m.compatible:
                    _model = m
                else:
                    _model_error = "Saved model was trained on a different feature set. Run: python train.py"
            except Exception as exc:
                _model_error = f"Could not load model: {exc}"
        if _model_error:
            log.warning(_model_error)
    return _model


def model_error() -> str | None:
    return _model_error


def _forest_issues(df: pd.DataFrame, stat_issues: list[dict], model: PriceModel) -> tuple[list[dict], dict, list[str]]:
    ff = build_features(df)
    if not len(ff.X):
        return [], {"applied": False, "recordsScored": 0, "flagged": 0, "corroborated": 0, "newIssues": 0,
                    "note": "No priced rows to score."}, []
    scores = model.score(ff.X)
    thr = model.threshold
    trees = len(model.forest.estimators_)
    td = model.training_data
    trained_on = f"{td['rows']:,} rows from {td['source']} ({td['date']})"
    stat_by_record = {i["recordId"]: i for i in stat_issues if i["type"] == "PRICE_ANOMALY"}
    cap = max(1, round(len(scores) * MAX_NEW_SHARE))
    new: list[dict] = []
    flagged_ids: list[str] = []
    flagged = corroborated = 0
    for idx in np.argsort(-scores):
        s = float(scores[idx])
        if s < thr:
            break
        f = int(np.argmax(ff.signal[idx]))
        if ff.signal[idx, f] < MIN_SIGNAL:
            continue
        flagged += 1
        row = ff.frame.iloc[idx]
        flagged_ids.append(row["id"])
        label, reading = FEATURES[f], ff.display[idx][f]
        # The z-score reading is not plain language; the peer comparison says the same thing.
        plain_reading = ff.display[idx][0] if f == 1 else reading
        confidence = min(0.97, 0.7 + (s - thr) * 2)
        existing = stat_by_record.get(row["id"])
        if existing is not None:
            corroborated += 1
            existing["evidence"] += [
                {"label": "Isolation Forest", "value": f"{s:.3f} (review line {thr:.3f})"},
                {"label": "Model signal", "value": f"{label}: {reading}"},
            ]
            existing["method"] += ". Confirmed by Isolation Forest"
            existing["confidence"] = round(min(0.99, max(existing["confidence"], confidence)), 4)
            continue
        if len(new) >= cap:
            continue
        channel = CHANNEL_LABEL.get(row["channel"], row["channel"]).lower()
        can_suggest = int(row["peer_count"]) >= MIN_PEERS
        new.append(issue(
            row["id"], "PRICE_ANOMALY", "anomaly", "high" if s >= thr + 0.06 else "medium", confidence,
            f"{row['commodity'] or 'Product'}: {channel} price looks unusual",
            f"The AI model compared this {channel} price at {row['market'] or 'this market'} with the same product in "
            f"other markets, this market's and province's usual price levels, and the farm gate → wholesale → retail "
            f"order. It is among the {CONTAMINATION * 100:.1f}% most unusual prices. What stands out most: {plain_reading}.",
            [
                ("Observed", f"{rwf(row['price'])}/{row['unit'] or 'kg'}"),
                ("Isolation Forest", f"{s:.3f} (review line {thr:.3f})"),
                ("Strongest feature", f"{label}: {reading}"),
                ("Commodity peers", ff.display[idx][0]),
                ("Model", f"scikit-learn IsolationForest, {trees} trees trained on {trained_on}"),
            ],
            "Compare with the same product in other markets and check it with the market reporter. Correct it if the "
            "unit or price type was entered wrongly."
            if can_suggest else "Too few markets priced this product to suggest a value. Check the price with the market reporter.",
            "Isolation Forest on relative price features (Python AI API, Layer 4, saved model)",
            ("price", round(float(row["peer_median"]))) if can_suggest else None,
        ))
    report = {
        "applied": True,
        "origin": "trained",
        "trainedOn": trained_on,
        "trainedAt": model.trained_at,
        "recordsScored": int(len(scores)),
        "trees": trees,
        "subsample": int(model.forest.max_samples_),
        "threshold": thr,
        "flagged": flagged,
        "corroborated": corroborated,
        "newIssues": len(new),
        "note": f"Scored {len(scores):,} priced rows with a scikit-learn Isolation Forest ({trees} trees, trained on "
                f"{trained_on}). {flagged} passed the review line: {corroborated} confirm a robust z-score flag and "
                f"{len(new)} are new.",
    }
    return new, report, flagged_ids


def run_anomaly_engine(df: pd.DataFrame) -> tuple[list[dict], dict, list[str]]:
    """Returns (issues, Isolation Forest report, ids the forest flagged)."""
    stat = detect_price_outliers(df)
    rules = detect_invalid_prices(df) + detect_ladder_violations(df)
    model = load_price_model()
    if model is None:
        report = {"applied": False, "origin": "none", "trainedOn": "", "trainedAt": "", "recordsScored": 0, "trees": 0,
                  "subsample": 0, "threshold": 0, "flagged": 0, "corroborated": 0, "newIssues": 0,
                  "note": model_error() or "No model loaded."}
        return stat + rules, report, []
    forest, report, flagged_ids = _forest_issues(df, stat, model)
    return stat + rules + forest, report, flagged_ids
