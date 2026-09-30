"""e-biciro Python AI API (Flask).

Run:  .venv/bin/python app.py            (http://127.0.0.1:5001)
      .venv/bin/gunicorn -w 1 -b 0.0.0.0:5001 app:app   (production)
Docs: http://127.0.0.1:5001/api/docs      (spec at /api/openapi.json)
"""

from __future__ import annotations

import json
import logging
import os
import threading

import numpy as np
import pandas as pd
from flask import Flask, jsonify, request
from flask.json.provider import DefaultJSONProvider
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from minagri_ai.anomaly import load_price_model, model_error, run_anomaly_engine
from minagri_ai.catalog import load_catalog
from minagri_ai.config import MODEL_CARD_PATH
from minagri_ai.ingest import json_to_table, merge_tables, read_upload
from minagri_ai.matching import embedder_status, engine, get_embedder
from minagri_ai.openapi import build_spec, swagger_html
from minagri_ai.pipeline import analyze

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("minagri-api")

MAX_UPLOAD_MB = int(os.environ.get("MINAGRI_MAX_UPLOAD_MB", "25"))
ALLOWED_ORIGINS = os.environ.get("MINAGRI_CORS_ORIGINS", "*")


class NumpyJSONProvider(DefaultJSONProvider):
    sort_keys = False

    @staticmethod
    def default(o):
        if isinstance(o, np.generic):
            return o.item()
        if isinstance(o, np.ndarray):
            return o.tolist()
        return DefaultJSONProvider.default(o)


def create_app() -> Flask:
    app = Flask(__name__)
    app.json = NumpyJSONProvider(app)
    app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024
    CORS(app, resources={r"/api/*": {"origins": ALLOWED_ORIGINS.split(",") if ALLOWED_ORIGINS != "*" else "*"}})

    load_catalog()
    load_price_model()
    if os.environ.get("MINAGRI_WARMUP", "1") != "0":
        threading.Thread(target=_warm_up, daemon=True).start()

    @app.errorhandler(ValueError)
    def bad_input(exc: ValueError):
        return jsonify(error="invalid_input", message=str(exc)), 400

    @app.errorhandler(HTTPException)
    def http_error(exc: HTTPException):
        return jsonify(error=exc.name.lower().replace(" ", "_"), message=exc.description), exc.code

    @app.errorhandler(Exception)
    def crash(exc: Exception):
        log.exception("Unhandled error")
        return jsonify(error="internal_error", message=f"{type(exc).__name__}: {exc}"), 500

    @app.get("/api/health")
    def health():
        model = load_price_model()
        cat = load_catalog()
        return jsonify(
            status="ok" if model else "degraded",
            catalog={"source": cat.source, "commodities": len(cat.commodities), "markets": len(cat.markets)},
            priceModel={
                "loaded": model is not None,
                "error": model_error(),
                "trainedAt": model.trained_at if model else None,
                "trainingData": model.training_data if model else None,
                "threshold": model.threshold if model else None,
                "trees": len(model.forest.estimators_) if model else 0,
            },
            matching=embedder_status() if _embedder_ready.is_set() else {"backend": "loading"},
        )

    @app.get("/api/openapi.json")
    def openapi_spec():
        return jsonify(build_spec(request.host_url.rstrip("/")))

    @app.get("/api/docs")
    def api_docs():
        return app.response_class(swagger_html("/api/openapi.json"), mimetype="text/html")

    @app.get("/api/models")
    def model_card():
        if not MODEL_CARD_PATH.exists():
            return jsonify(error="not_trained", message="Run python train.py to train the models."), 404
        return app.response_class(MODEL_CARD_PATH.read_text(), mimetype="application/json")

    @app.post("/api/models/reload")
    def reload_models():
        model = load_price_model(reload=True)
        return jsonify(loaded=model is not None, error=model_error())

    @app.post("/api/analyze")
    def analyze_route():
        """Multipart upload (one or more CSV / e-Soko JSON files) or a JSON body."""
        use_embedding = request.args.get("embeddings", "1") != "0"
        files = request.files.getlist("files") + request.files.getlist("file")
        if files:
            table = merge_tables([read_upload(f.read(), f.filename or "upload") for f in files])
            name = ", ".join(f.filename or "upload" for f in files)
        else:
            body = request.get_json(silent=True)
            if body is None:
                raise ValueError("Send CSV/JSON files as multipart field 'files', or a JSON body.")
            table = json_to_table(body)
            name = body.get("datasetName", "JSON body") if isinstance(body, dict) else "JSON body"
        if not table.rows:
            raise ValueError("The dataset has no rows.")
        result = analyze(table, use_embedding=use_embedding)
        result["datasetName"] = name
        log.info("Analysed %s: %d rows, %d issues in %d ms", name, len(result["records"]), len(result["issues"]),
                 result["elapsedMs"])
        return jsonify(result)

    @app.post("/api/match")
    def match_route():
        body = request.get_json(force=True)
        kind = body.get("kind")
        names = body.get("names")
        if kind not in ("commodity", "market") or not isinstance(names, list):
            raise ValueError('Body must be {"kind": "commodity" | "market", "names": [...]}.')
        results = engine(kind).match_many([str(n) for n in names], body.get("embeddings", True))
        return jsonify(kind=kind, thresholds=engine(kind).thresholds, results=[results[str(n)].to_dict() for n in names])

    @app.post("/api/anomalies")
    def anomalies_route():
        body = request.get_json(force=True)
        recs = body.get("records") if isinstance(body, dict) else None
        if not isinstance(recs, list) or not recs:
            raise ValueError('Body must be {"records": [{"id", "date", "market", "commodity", "channel", "price", ...}]}.')
        df = pd.DataFrame(recs)
        for col, default in (("province", ""), ("unit", ""), ("date", ""), ("market", ""), ("rowNumber", 0)):
            if col not in df:
                df[col] = default
        df = df.rename(columns={"rowNumber": "row_number"}).fillna({"province": "", "unit": "", "market": "", "date": ""})
        df["price"] = pd.to_numeric(df["price"], errors="coerce")
        issues, report, _ = run_anomaly_engine(df)
        return jsonify(issues=issues, isolationForest=report)

    return app


_embedder_ready = threading.Event()


def _warm_up() -> None:
    try:
        get_embedder()
        engine("commodity").match("warm up")
        engine("market").match("warm up")
    except Exception:
        log.exception("Warm-up failed")
    finally:
        _embedder_ready.set()
        log.info("Matching engine ready: %s", json.dumps(embedder_status()))


app = create_app()

if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "5001")), debug=False)
