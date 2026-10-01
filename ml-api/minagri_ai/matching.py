"""Matching engine: normalisation, exact lookup, RapidFuzz, then embeddings for uncertain names.

RapidFuzz ranks catalog candidates. When its best score is below
FUZZY_CONFIDENT, an embedding model (Sentence Transformer, or a character
TF-IDF model when the transformer is unavailable) gives an independent second
opinion: agreement raises confidence, disagreement blocks auto-acceptance so a
person decides.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
import unicodedata
from dataclasses import dataclass, field
from typing import Literal, Protocol

import numpy as np
from rapidfuzz import fuzz

from .catalog import Catalog, load_catalog
from .config import (
    DEFAULT_MATCHING,
    EMBEDDING_CACHE_DIR,
    EMBEDDING_MODEL,
    FUZZY_CONFIDENT,
    MATCHING_CALIBRATION_PATH,
    EMBEDDING_VETO_MARGIN,
    TIE_MARGIN,
    USE_SENTENCE_TRANSFORMER,
)

log = logging.getLogger(__name__)

Kind = Literal["commodity", "market"]
Status = Literal["exact", "auto", "review", "ambiguous", "unknown", "archived", "empty"]


def normalise(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-z0-9]+", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


# --------------------------------------------------------------------- embedders


class Embedder(Protocol):
    name: str

    def encode(self, texts: list[str]) -> np.ndarray: ...


class SentenceEmbedder:
    def __init__(self, model_name: str = EMBEDDING_MODEL):
        from sentence_transformers import SentenceTransformer

        self.name = model_name
        self._model = SentenceTransformer(model_name)
        self._lock = threading.Lock()

    def encode(self, texts: list[str]) -> np.ndarray:
        with self._lock:
            return np.asarray(self._model.encode(texts, normalize_embeddings=True, batch_size=64, show_progress_bar=False))


class TfidfEmbedder:
    """Character 2–4-gram TF-IDF fitted on the catalog names (used when the transformer cannot load)."""

    def __init__(self, corpus: list[str]):
        from sklearn.feature_extraction.text import TfidfVectorizer

        self.name = "tfidf-char-2-4"
        self._vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), lowercase=True, sublinear_tf=True)
        self._vec.fit([normalise(t) for t in corpus])

    def encode(self, texts: list[str]) -> np.ndarray:
        m = self._vec.transform([normalise(t) for t in texts]).toarray()
        norms = np.linalg.norm(m, axis=1, keepdims=True)
        return m / np.where(norms == 0, 1, norms)


_embedder: Embedder | None = None
_embedder_lock = threading.Lock()
_embedder_error: str | None = None


def get_embedder() -> Embedder:
    global _embedder, _embedder_error
    with _embedder_lock:
        if _embedder is None:
            if USE_SENTENCE_TRANSFORMER:
                try:
                    _embedder = SentenceEmbedder()
                except Exception as exc:  # no network, no weights, torch issue
                    _embedder_error = f"{type(exc).__name__}: {exc}"
                    log.warning("Sentence Transformer unavailable, using TF-IDF fallback: %s", _embedder_error)
            if _embedder is None:
                cat = load_catalog()
                corpus = [n for c in cat.commodities for n in (c.name, *c.aliases)] + [
                    n for m in cat.markets for n in (m.name, *m.aliases)
                ]
                _embedder = TfidfEmbedder(corpus)
        return _embedder


def embedder_status() -> dict:
    e = get_embedder()
    return {"backend": e.name, "sentenceTransformer": isinstance(e, SentenceEmbedder), "fallbackReason": _embedder_error}


# --------------------------------------------------------------------- engine


@dataclass
class Candidate:
    value: str
    score: float
    reason: str


@dataclass
class MatchResult:
    input: str
    value: str
    score: float
    status: Status
    method: str
    candidates: list[Candidate] = field(default_factory=list)
    used_embedding: bool = False
    models_agree: bool | None = None
    embedding_top: Candidate | None = None

    def to_dict(self) -> dict:
        return {
            "input": self.input,
            "value": self.value,
            "score": round(self.score, 4),
            "status": self.status,
            "method": self.method,
            "usedEmbedding": self.used_embedding,
            "modelsAgree": self.models_agree,
            "embeddingTop": {"value": self.embedding_top.value, "score": round(self.embedding_top.score, 4)}
            if self.embedding_top else None,
            "candidates": [{"value": c.value, "score": round(c.score, 4), "reason": c.reason} for c in self.candidates],
        }


def load_calibration(backend: str) -> dict:
    if MATCHING_CALIBRATION_PATH.exists():
        cal = json.loads(MATCHING_CALIBRATION_PATH.read_text())
        if cal.get("backend") == backend:
            return {k: cal[k] for k in ("commodity", "market", "veto_margin", "veto_margin_by_kind") if k in cal}
    return json.loads(json.dumps(DEFAULT_MATCHING))


def fuzzy_score(a: str, b: str) -> float:
    """0..1 similarity on normalised strings. Token-set is discounted so "maize" does not equal "maize flour"."""
    if not a or not b:
        return 0.0
    s = max(fuzz.ratio(a, b), fuzz.token_sort_ratio(a, b))
    if " " in a and " " in b:
        s = max(s, 0.95 * fuzz.token_set_ratio(a, b))
    return s / 100.0


class MatchingEngine:
    def __init__(self, kind: Kind, catalog: Catalog | None = None, embedder: Embedder | None = None,
                 calibration: dict | None = None):
        self.kind = kind
        self.catalog = catalog or load_catalog()
        entries = self.catalog.markets if kind == "market" else self.catalog.commodities
        self.canonicals = [e.name for e in entries]
        # one row per surface form (name or alias) -> canonical index
        self.forms: list[str] = []
        self.form_owner: list[int] = []
        for i, e in enumerate(entries):
            for form in (e.name, *e.aliases):
                self.forms.append(form)
                self.form_owner.append(i)
        self.norm_forms = [normalise(f) for f in self.forms]
        self.exact = {}
        for n, owner in zip(self.norm_forms, self.form_owner):
            self.exact.setdefault(n, set()).add(owner)
        self._embedder = embedder
        self._form_vectors: np.ndarray | None = None
        self._calibration = calibration

    # lazily resolved so the API starts fast and tests can inject embedders
    @property
    def embedder(self) -> Embedder:
        if self._embedder is None:
            self._embedder = get_embedder()
        return self._embedder

    @property
    def thresholds(self) -> dict:
        if self._calibration is None:
            self._calibration = load_calibration(self.embedder.name)
        return self._calibration[self.kind]

    @property
    def veto_margin(self) -> float:
        self.thresholds  # loads calibration
        by_kind = self._calibration.get("veto_margin_by_kind", {})
        return float(by_kind.get(self.kind, self._calibration.get("veto_margin", EMBEDDING_VETO_MARGIN)))

    def _vectors(self) -> np.ndarray:
        if self._form_vectors is None:
            key = hashlib.sha1(("\n".join(self.forms) + self.embedder.name).encode()).hexdigest()[:16]
            path = EMBEDDING_CACHE_DIR / f"{self.kind}-{key}.npy"
            if path.exists() and isinstance(self.embedder, SentenceEmbedder):
                self._form_vectors = np.load(path)
            else:
                self._form_vectors = self.embedder.encode(self.forms)
                if isinstance(self.embedder, SentenceEmbedder):
                    EMBEDDING_CACHE_DIR.mkdir(parents=True, exist_ok=True)
                    np.save(path, self._form_vectors)
        return self._form_vectors

    def _query_variants(self, raw: str) -> list[str]:
        q = normalise(raw)
        if self.kind == "market":
            stripped = normalise(re.sub(r"\b(market|mkt|isoko|marche)\b", " ", q))
            if stripped and stripped != q:
                return [q, stripped]
        return [q]

    def _fuzzy(self, query: str) -> np.ndarray:
        per_canonical = np.zeros(len(self.canonicals))
        for form, owner in zip(self.norm_forms, self.form_owner):
            s = fuzzy_score(query, form)
            if s > per_canonical[owner]:
                per_canonical[owner] = s
        return per_canonical

    def match_many(self, raws: list[str], use_embedding: bool = True) -> dict[str, MatchResult]:
        unique = list(dict.fromkeys(r for r in raws))
        results: dict[str, MatchResult] = {}
        pending: list[tuple[str, str, np.ndarray]] = []
        for raw in unique:
            if not raw.strip():
                results[raw] = MatchResult(raw, "", 0.0, "empty", "No value")
                continue
            variants = self._query_variants(raw)
            hit = next((self.exact[v] for v in variants if v in self.exact), None)
            if hit and len(hit) == 1:
                idx = next(iter(hit))
                results[raw] = MatchResult(raw, self.canonicals[idx], 1.0, "exact", "Exact catalog name or alias",
                                           [Candidate(self.canonicals[idx], 1.0, "exact")])
                continue
            if self.kind == "commodity":
                archived = self.catalog.archived_by_name(raw)
                if archived:
                    results[raw] = MatchResult(raw, archived.name, 1.0, "archived",
                                               "Exact lookup in the list of discontinued products")
                    continue
            query = variants[-1]
            scores = self._fuzzy(query) if not hit else np.where(np.isin(np.arange(len(self.canonicals)), list(hit)), 1.0, 0.0)
            pending.append((raw, query, scores))

        need_embedding = [(raw, q, s) for raw, q, s in pending if use_embedding and s.max() < FUZZY_CONFIDENT]
        emb_scores: dict[str, np.ndarray] = {}
        if need_embedding:
            vecs = self._vectors()
            qv = self.embedder.encode([q for _, q, _ in need_embedding])
            sims = qv @ vecs.T
            for (raw, _, _), row in zip(need_embedding, sims):
                per_canonical = np.full(len(self.canonicals), -1.0)
                np.maximum.at(per_canonical, self.form_owner, row)
                emb_scores[raw] = per_canonical

        for raw, _, fz in pending:
            results[raw] = self._decide(raw, fz, emb_scores.get(raw))
        return results

    def match(self, raw: str, use_embedding: bool = True) -> MatchResult:
        return self.match_many([raw], use_embedding)[raw]

    def _decide(self, raw: str, fz: np.ndarray, emb: np.ndarray | None) -> MatchResult:
        t = self.thresholds
        order = np.argsort(-fz)[:3]
        cands = [Candidate(self.canonicals[i], float(fz[i]), f"RapidFuzz {fz[i] * 100:.0f}%") for i in order]
        ambiguous = len(cands) > 1 and cands[0].score - cands[1].score < TIE_MARGIN and cands[0].score >= 0.5
        agree: bool | None = None
        method = "RapidFuzz (spelling and word-order similarity) against known names, including Kinyarwanda and French"
        if emb is not None:
            e_idx = int(np.argmax(emb))
            e_score = float(max(emb[e_idx], 0.0))
            lead = cands[0]
            clear_preference = float(emb[e_idx] - emb[order[0]]) >= self.veto_margin
            if e_idx == order[0]:
                agree = True
                lead.score = max(lead.score, 0.5 * lead.score + 0.5 * e_score)
                lead.reason += f" · {self.embedder.name} agrees ({e_score * 100:.0f}%)"
            elif not clear_preference:
                lead.reason += f" · {self.embedder.name} has no clear preference"
            else:
                agree = False
                lead.score = min(lead.score, t["auto_accept"] - 0.01)
                lead.reason += f' · {self.embedder.name} prefers "{self.canonicals[e_idx]}"'
                if all(c.value != self.canonicals[e_idx] for c in cands):
                    cands.append(Candidate(self.canonicals[e_idx], min(lead.score, 0.5 * float(fz[e_idx]) + 0.5 * e_score),
                                           f"{self.embedder.name} embedding {e_score * 100:.0f}%"))
            cands.sort(key=lambda c: -c.score)
            verdict = {True: "models agree", False: "models disagree", None: "no clear embedding preference"}[agree]
            method += f", checked by {self.embedder.name} embeddings ({verdict})"
        top = cands[0]
        e_top = None
        if emb is not None:
            e_idx = int(np.argmax(emb))
            e_top = Candidate(self.canonicals[e_idx], float(emb[e_idx]), f"{self.embedder.name} embedding {emb[e_idx] * 100:.0f}%")
        semantic_line = t.get("embedding_suggest")
        if top.score < t["review_min"] and e_top is not None and semantic_line is not None and e_top.score >= semantic_line:
            # RapidFuzz found nothing close; the embedding recognises the meaning (e.g. "Aubergine" → "Eggplant").
            lead = Candidate(e_top.value, min(e_top.score, t["auto_accept"] - 0.01),
                             f"Semantic match: {e_top.reason}; spelling similarity {fz[self.canonicals.index(e_top.value)] * 100:.0f}%")
            cands = [lead] + [c for c in cands if c.value != e_top.value][:2]
            return MatchResult(raw, lead.value, lead.score, "review",
                               f"Semantic match by {self.embedder.name} (RapidFuzz found no close spelling)", cands,
                               used_embedding=True, models_agree=agree, embedding_top=e_top)
        if top.score < t["review_min"]:
            status: Status = "unknown"
        elif ambiguous:
            status = "ambiguous"
        elif top.score >= t["auto_accept"]:
            status = "auto"
        else:
            status = "review"
        return MatchResult(raw, top.value if status != "unknown" else "", top.score, status, method, cands,
                           used_embedding=emb is not None, models_agree=agree, embedding_top=e_top)


_engines: dict[str, MatchingEngine] = {}


def engine(kind: Kind) -> MatchingEngine:
    if kind not in _engines:
        _engines[kind] = MatchingEngine(kind)
    return _engines[kind]
