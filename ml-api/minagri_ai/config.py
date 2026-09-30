"""Paths and tunable constants shared by training and serving."""

from __future__ import annotations

import os
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = API_ROOT.parent

# The web app and the API read the same catalog and snapshot files.
DATA_DIR = Path(os.environ.get("MINAGRI_DATA_DIR", REPO_ROOT / "src" / "lib" / "minagri" / "data"))
CATALOG_PATH = DATA_DIR / "esoko-catalog.json"
SNAPSHOT_PATH = DATA_DIR / "esoko-snapshot.json"
RAW_DATA_DIR = REPO_ROOT / "data"

MODEL_DIR = Path(os.environ.get("MINAGRI_MODEL_DIR", API_ROOT / "models"))
PRICE_MODEL_PATH = MODEL_DIR / "price_iforest.joblib"
MATCHING_CALIBRATION_PATH = MODEL_DIR / "matching_calibration.json"
MODEL_CARD_PATH = MODEL_DIR / "model_card.json"
EMBEDDING_CACHE_DIR = MODEL_DIR / "embeddings"

EMBEDDING_MODEL = os.environ.get("MINAGRI_EMBEDDING_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
# Set to "0" to force the TF-IDF fallback (no model download).
USE_SENTENCE_TRANSFORMER = os.environ.get("MINAGRI_USE_SENTENCE_TRANSFORMER", "1") != "0"

# Isolation Forest
FOREST_TREES = 200
FOREST_SUBSAMPLE = 256
CONTAMINATION = 0.025
MIN_PEERS = 3
MIN_SIGNAL = 0.4
MAX_NEW_SHARE = 0.05
FEATURE_SET = "price-features-v2"

# Statistics layer
MIN_GROUP = 5
ROBUST_Z_LIMIT = 3.5
IQR_K = 1.5

# Matching defaults; train.py writes calibrated values to MATCHING_CALIBRATION_PATH.
DEFAULT_MATCHING = {
    "commodity": {"auto_accept": 0.90, "review_min": 0.55},
    "market": {"auto_accept": 0.88, "review_min": 0.50},
}
FUZZY_CONFIDENT = 0.92
# The embedding must prefer another candidate by at least this cosine margin to block auto-acceptance.
EMBEDDING_VETO_MARGIN = 0.05
TIE_MARGIN = 0.02
