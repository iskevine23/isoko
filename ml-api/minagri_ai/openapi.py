"""OpenAPI 3.1 description of the Flask API, served at /api/openapi.json and rendered at /api/docs."""

from __future__ import annotations

SWAGGER_UI_VERSION = "5.17.14"

ISSUE_TYPES = ["ENTITY_MATCH", "UNKNOWN_ENTITY", "PRICE_ANOMALY", "LADDER_VIOLATION", "INVALID_PRICE"]
MATCH_STATUSES = ["exact", "auto", "review", "ambiguous", "unknown", "archived", "empty"]
CHANNELS = ["farmgate", "wholesale", "retail", ""]


def _ref(name: str) -> dict:
    return {"$ref": f"#/components/schemas/{name}"}


def _json(schema: dict, example: dict | None = None) -> dict:
    body: dict = {"schema": schema}
    if example is not None:
        body["example"] = example
    return {"application/json": body}


def _error(description: str) -> dict:
    return {"description": description, "content": _json(_ref("Error"))}


FOREST_EXAMPLE = {
    "applied": True,
    "origin": "trained",
    "trainedOn": "1,096 rows from Rwanda e-Soko export (2026-09-28)",
    "trainedAt": "2026-09-30T12:10:30+00:00",
    "recordsScored": 2,
    "trees": 200,
    "subsample": 256,
    "threshold": 0.621,
    "flagged": 0,
    "corroborated": 0,
    "newIssues": 0,
    "note": "Scored 2 priced rows with a scikit-learn Isolation Forest (200 trees, ...). 0 passed the review line.",
}

LADDER_ISSUE_EXAMPLE = {
    "id": "py-1-3475e",
    "recordId": "a",
    "type": "LADDER_VIOLATION",
    "category": "conflict",
    "severity": "medium",
    "confidence": 0.875,
    "title": "Pricing ladder violation — Wholesale above Retail",
    "explanation": "For Beans at Kimironko, the wholesale price (1,500 RWF) is higher than the retail price (1,200 RWF). "
                   "The expected order is farm gate ≤ wholesale ≤ retail.",
    "evidence": [
        {"label": "Wholesale", "value": "1,500 RWF (row #0)"},
        {"label": "Retail", "value": "1,200 RWF (row #0)"},
        {"label": "Inversion", "value": "25.0%"},
    ],
    "recommendation": "Confirm which of the two prices was mis-recorded.",
    "method": "Contextual rule — farm gate ≤ wholesale ≤ retail (Layer 3)",
    "status": "open",
}

MATCH_EXAMPLE = {
    "input": "Irish potatos",
    "value": "Irish-potato",
    "score": 0.96,
    "status": "auto",
    "method": "RapidFuzz (edit distance and token similarity) against catalog names and aliases",
    "usedEmbedding": False,
    "modelsAgree": None,
    "embeddingTop": None,
    "candidates": [
        {"value": "Irish-potato", "score": 0.96, "reason": "RapidFuzz 96%"},
        {"value": "Irish- Potato - Peko", "score": 0.8, "reason": "RapidFuzz 80%"},
        {"value": "Irish Potato - Gashora", "score": 0.7879, "reason": "RapidFuzz 79%"},
    ],
}

SCHEMAS: dict = {
    "Error": {
        "type": "object",
        "required": ["error", "message"],
        "properties": {
            "error": {"type": "string", "description": "Machine-readable code, e.g. invalid_input, not_found, internal_error."},
            "message": {"type": "string"},
        },
        "example": {"error": "invalid_input", "message": "The dataset has no rows."},
    },
    "Evidence": {
        "type": "object",
        "required": ["label", "value"],
        "properties": {"label": {"type": "string"}, "value": {"type": "string"}},
    },
    "Issue": {
        "type": "object",
        "description": "One finding for the Review Center. Same shape as the web app's `Issue` type.",
        "required": ["id", "recordId", "type", "category", "severity", "confidence", "title", "explanation",
                     "evidence", "recommendation", "method", "status"],
        "properties": {
            "id": {"type": "string", "example": "py-12-a41f0"},
            "recordId": {"type": "string", "description": "Id of the record the finding is about (rec-N for /api/analyze)."},
            "type": {"type": "string", "enum": ISSUE_TYPES},
            "category": {"type": "string", "enum": ["match", "anomaly", "conflict", "completeness"]},
            "severity": {"type": "string", "enum": ["low", "medium", "high", "critical"]},
            "confidence": {"type": "number", "minimum": 0, "maximum": 0.99},
            "title": {"type": "string"},
            "explanation": {"type": "string"},
            "evidence": {"type": "array", "items": _ref("Evidence")},
            "recommendation": {"type": "string"},
            "method": {"type": "string", "description": "Which model or rule produced the finding."},
            "status": {"type": "string", "enum": ["open"]},
            "suggestion": {
                "type": "object",
                "description": "Proposed correction, present on matching findings that have a best candidate.",
                "properties": {
                    "field": {"type": "string", "enum": ["commodity", "market"]},
                    "value": {"type": ["string", "number"]},
                },
            },
        },
        "example": LADDER_ISSUE_EXAMPLE,
    },
    "MatchCandidate": {
        "type": "object",
        "properties": {
            "value": {"type": "string", "description": "Canonical catalog or registry name."},
            "score": {"type": "number", "minimum": 0, "maximum": 1},
            "reason": {"type": "string"},
        },
    },
    "MatchResult": {
        "type": "object",
        "description": (
            "Result of the matching engine for one name. RapidFuzz ranks candidates; the Sentence Transformer "
            "(or TF-IDF fallback) is consulted only when RapidFuzz scores below 0.92."
        ),
        "properties": {
            "input": {"type": "string"},
            "value": {"type": "string", "description": "Best canonical name, empty when nothing is close enough."},
            "score": {"type": "number", "minimum": 0, "maximum": 1},
            "status": {
                "type": "string",
                "enum": MATCH_STATUSES,
                "description": (
                    "exact: name or alias matched. auto: above auto_accept, applied without review. "
                    "review: between review_min and auto_accept, needs a person. ambiguous: two or more entries tie. "
                    "unknown: nothing above review_min. archived: an archived catalog product. empty: blank input."
                ),
            },
            "method": {"type": "string"},
            "usedEmbedding": {"type": "boolean"},
            "modelsAgree": {"type": ["boolean", "null"], "description": "Whether the embedding model picked the same entry."},
            "embeddingTop": {
                "oneOf": [
                    {"type": "null"},
                    {"type": "object", "properties": {"value": {"type": "string"}, "score": {"type": "number"}}},
                ],
            },
            "candidates": {"type": "array", "items": _ref("MatchCandidate")},
        },
        "example": MATCH_EXAMPLE,
    },
    "Thresholds": {
        "type": "object",
        "description": "Calibrated by train.py and stored in models/matching_calibration.json.",
        "properties": {
            "auto_accept": {"type": "number"},
            "review_min": {"type": "number"},
            "embedding_suggest": {"type": ["number", "null"]},
        },
    },
    "IsolationForestReport": {
        "type": "object",
        "properties": {
            "applied": {"type": "boolean"},
            "origin": {"type": "string", "enum": ["trained", "none"]},
            "trainedOn": {"type": "string"},
            "trainedAt": {"type": "string"},
            "recordsScored": {"type": "integer"},
            "trees": {"type": "integer"},
            "subsample": {"type": "integer"},
            "threshold": {"type": "number", "description": "Anomaly score at or above which a row is reviewed."},
            "flagged": {"type": "integer"},
            "corroborated": {"type": "integer", "description": "Flags that confirm an existing robust z-score finding."},
            "newIssues": {"type": "integer", "description": "Findings only the forest raised (capped at 5% of rows)."},
            "note": {"type": "string"},
        },
        "example": FOREST_EXAMPLE,
    },
    "PriceRecord": {
        "type": "object",
        "description": "One price observation for /api/anomalies. Names should already be canonical.",
        "required": ["id", "commodity", "channel", "price"],
        "properties": {
            "id": {"type": "string"},
            "rowNumber": {"type": "integer"},
            "date": {"type": "string", "example": "2026-09-01"},
            "province": {"type": "string"},
            "market": {"type": "string"},
            "commodity": {"type": "string"},
            "unit": {"type": "string"},
            "channel": {"type": "string", "enum": CHANNELS},
            "price": {"type": ["number", "null"], "description": "Price in RWF."},
        },
    },
    "AnalyzedRecord": {
        "type": "object",
        "properties": {
            "id": {"type": "string", "example": "rec-1"},
            "rowNumber": {"type": "integer"},
            "date": {"type": "string"},
            "province": {"type": "string", "description": "Taken from the market registry when the market matched."},
            "district": {"type": "string"},
            "market": {"type": "string"},
            "commodity": {"type": "string"},
            "unit": {"type": "string"},
            "channel": {"type": "string", "enum": CHANNELS},
            "price": {"type": ["number", "null"]},
            "match": {
                "type": "object",
                "properties": {"commodity": _ref("MatchResult"), "market": _ref("MatchResult")},
            },
        },
    },
    "Coverage": {
        "type": "object",
        "properties": {
            "reportingMarkets": {"type": "integer"},
            "totalMarkets": {"type": "integer"},
            "provinces": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "markets": {"type": "integer"},
                        "reporting": {"type": "integer"},
                        "observations": {"type": "integer"},
                    },
                },
            },
            "missingProvinces": {"type": "array", "items": {"type": "string"}},
        },
    },
    "TableBody": {
        "type": "object",
        "description": "Rows as the web app sends them after reading a file.",
        "required": ["headers", "rows"],
        "properties": {
            "datasetName": {"type": "string"},
            "headers": {"type": "array", "items": {"type": "string"}},
            "rows": {
                "type": "array",
                "description": "One object per row, keyed by header. Columns are detected from common header names.",
                "items": {"type": "object", "additionalProperties": {"type": "string"}},
            },
        },
        "example": {
            "datasetName": "September retail prices",
            "headers": ["date", "district", "market", "commodity", "price_type", "unit", "price"],
            "rows": [
                {"date": "2026-09-01", "district": "Gasabo", "market": "Kimironko", "commodity": "Irish potatos",
                 "price_type": "retail", "unit": "kg", "price": "650"},
                {"date": "2026-09-01", "district": "Gasabo", "market": "Kimironko", "commodity": "Beans",
                 "price_type": "wholesale", "unit": "kg", "price": "1500"},
                {"date": "2026-09-01", "district": "Gasabo", "market": "Kimironko", "commodity": "Beans",
                 "price_type": "retail", "unit": "kg", "price": "1200"},
            ],
        },
    },
    "AnalyzeResult": {
        "type": "object",
        "properties": {
            "engine": {"type": "string", "const": "minagri-ai-python"},
            "datasetName": {"type": "string"},
            "analyzedAt": {"type": "string", "format": "date-time"},
            "elapsedMs": {"type": "integer"},
            "columns": {
                "type": "object",
                "additionalProperties": {"type": ["string", "null"]},
                "description": "Which uploaded header was used for each field (null when not found).",
            },
            "parseErrors": {"type": "array", "items": {"type": "string"}},
            "records": {"type": "array", "items": _ref("AnalyzedRecord")},
            "issues": {"type": "array", "items": _ref("Issue")},
            "coverage": _ref("Coverage"),
            "ml": {
                "type": "object",
                "properties": {
                    "isolationForest": _ref("IsolationForestReport"),
                    "entityEmbeddings": {
                        "type": "object",
                        "properties": {
                            "rowsCompared": {"type": "integer"},
                            "backend": {"type": "string"},
                            "note": {"type": "string"},
                        },
                    },
                },
            },
        },
    },
    "Health": {
        "type": "object",
        "properties": {
            "status": {"type": "string", "enum": ["ok", "degraded"], "description": "degraded when no price model is loaded."},
            "catalog": {
                "type": "object",
                "properties": {
                    "source": {"type": "string"},
                    "commodities": {"type": "integer"},
                    "markets": {"type": "integer"},
                },
            },
            "priceModel": {
                "type": "object",
                "properties": {
                    "loaded": {"type": "boolean"},
                    "error": {"type": ["string", "null"]},
                    "trainedAt": {"type": ["string", "null"]},
                    "trainingData": {"type": ["object", "null"]},
                    "threshold": {"type": ["number", "null"]},
                    "trees": {"type": "integer"},
                },
            },
            "matching": {
                "type": "object",
                "description": 'backend is "loading" while the embedding model warms up after start.',
                "properties": {
                    "backend": {"type": "string"},
                    "sentenceTransformer": {"type": "boolean"},
                    "fallbackReason": {"type": ["string", "null"]},
                },
            },
        },
        "example": {
            "status": "ok",
            "catalog": {"source": "Rwanda e-Soko export, 28 September 2026", "commodities": 133, "markets": 67},
            "priceModel": {
                "loaded": True,
                "error": None,
                "trainedAt": "2026-09-30T12:10:30+00:00",
                "trainingData": {"source": "Rwanda e-Soko export", "date": "2026-09-28", "rows": 1096},
                "threshold": 0.621,
                "trees": 200,
            },
            "matching": {
                "backend": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
                "sentenceTransformer": True,
                "fallbackReason": None,
            },
        },
    },
}

PATHS: dict = {
    "/api/health": {
        "get": {
            "tags": ["System"],
            "summary": "Service and model status",
            "operationId": "health",
            "responses": {"200": {"description": "Status of the catalog, price model and matching engine.",
                                  "content": _json(_ref("Health"))}},
        },
    },
    "/api/models": {
        "get": {
            "tags": ["System"],
            "summary": "Model card with measured accuracy",
            "description": "The JSON written by `python train.py`: training data, thresholds and evaluation results.",
            "operationId": "modelCard",
            "responses": {
                "200": {"description": "Model card.", "content": _json({"type": "object"})},
                "404": _error("The models have not been trained yet."),
            },
        },
    },
    "/api/models/reload": {
        "post": {
            "tags": ["System"],
            "summary": "Reload the trained price model from disk",
            "description": "Use after re-running `python train.py` without restarting the server.",
            "operationId": "reloadModels",
            "responses": {"200": {
                "description": "Whether the model loaded.",
                "content": _json(
                    {"type": "object", "properties": {"loaded": {"type": "boolean"}, "error": {"type": ["string", "null"]}}},
                    {"loaded": True, "error": None},
                ),
            }},
        },
    },
    "/api/analyze": {
        "post": {
            "tags": ["Analysis"],
            "summary": "Run both engines on a dataset",
            "description": (
                "Reads the upload, matches every commodity and market name against the e-Soko catalog, then runs "
                "the anomaly engine (price rules, robust z-score and IQR, pricing ladder, Isolation Forest). "
                "Returns standardised records and findings for the Review Center.\n\n"
                "Send either one or more files (CSV, or JSON including raw e-Soko exports) as multipart field "
                "`files` or `file`, or a JSON body. Excel files are rejected: export them as CSV first."
            ),
            "operationId": "analyze",
            "parameters": [{
                "name": "embeddings",
                "in": "query",
                "required": False,
                "description": "Set to 0 to skip the embedding model and use RapidFuzz only (faster).",
                "schema": {"type": "string", "enum": ["1", "0"], "default": "1"},
            }],
            "requestBody": {
                "required": True,
                "content": {
                    "multipart/form-data": {
                        "schema": {
                            "type": "object",
                            "properties": {
                                "files": {"type": "array", "items": {"type": "string", "format": "binary"}},
                            },
                        },
                        "encoding": {"files": {"contentType": "text/csv, application/json"}},
                    },
                    "application/json": {
                        "schema": {
                            "oneOf": [
                                _ref("TableBody"),
                                {"type": "array", "items": {"type": "object"},
                                 "description": "List of flat row objects, or a raw e-Soko export."},
                            ],
                        },
                        "example": SCHEMAS["TableBody"]["example"],
                    },
                },
            },
            "responses": {
                "200": {"description": "Standardised records and findings.", "content": _json(_ref("AnalyzeResult"))},
                "400": _error("No rows, unreadable file, or missing body."),
                "413": _error("Upload larger than MINAGRI_MAX_UPLOAD_MB (25 MB by default)."),
            },
        },
    },
    "/api/match": {
        "post": {
            "tags": ["Matching engine"],
            "summary": "Match commodity or market names to the e-Soko catalog",
            "operationId": "match",
            "requestBody": {
                "required": True,
                "content": _json(
                    {
                        "type": "object",
                        "required": ["kind", "names"],
                        "properties": {
                            "kind": {"type": "string", "enum": ["commodity", "market"]},
                            "names": {"type": "array", "items": {"type": "string"}},
                            "embeddings": {"type": "boolean", "default": True,
                                           "description": "false uses RapidFuzz only."},
                        },
                    },
                    {"kind": "commodity", "names": ["Irish potatos"]},
                ),
            },
            "responses": {
                "200": {
                    "description": "One result per input name, in the same order.",
                    "content": _json(
                        {
                            "type": "object",
                            "properties": {
                                "kind": {"type": "string"},
                                "thresholds": _ref("Thresholds"),
                                "results": {"type": "array", "items": _ref("MatchResult")},
                            },
                        },
                        {
                            "kind": "commodity",
                            "thresholds": {"auto_accept": 0.86, "review_min": 0.8, "embedding_suggest": None},
                            "results": [MATCH_EXAMPLE],
                        },
                    ),
                },
                "400": _error("kind is not commodity or market, or names is not a list."),
            },
        },
    },
    "/api/anomalies": {
        "post": {
            "tags": ["Anomaly engine"],
            "summary": "Run the anomaly engine on price records",
            "description": (
                "Runs the price rules, robust z-score and IQR per commodity and channel, the pricing ladder rule "
                "and the trained Isolation Forest. No name matching is done, so send canonical names."
            ),
            "operationId": "anomalies",
            "requestBody": {
                "required": True,
                "content": _json(
                    {
                        "type": "object",
                        "required": ["records"],
                        "properties": {"records": {"type": "array", "minItems": 1, "items": _ref("PriceRecord")}},
                    },
                    {"records": [
                        {"id": "a", "date": "2026-09-01", "market": "Kimironko", "commodity": "Beans",
                         "channel": "retail", "price": 1200},
                        {"id": "b", "date": "2026-09-01", "market": "Kimironko", "commodity": "Beans",
                         "channel": "wholesale", "price": 1500},
                    ]},
                ),
            },
            "responses": {
                "200": {
                    "description": "Findings and the Isolation Forest report.",
                    "content": _json(
                        {
                            "type": "object",
                            "properties": {
                                "issues": {"type": "array", "items": _ref("Issue")},
                                "isolationForest": _ref("IsolationForestReport"),
                            },
                        },
                        {"issues": [LADDER_ISSUE_EXAMPLE], "isolationForest": FOREST_EXAMPLE},
                    ),
                },
                "400": _error("records is missing or empty."),
            },
        },
    },
}


def build_spec(server_url: str) -> dict:
    return {
        "openapi": "3.1.0",
        "info": {
            "title": "e-biciro Python AI API",
            "version": "1.0.0",
            "description": (
                "Machine-learning services behind the e-biciro platform.\n\n"
                "- **Matching engine**: RapidFuzz plus a multilingual Sentence Transformer "
                "(TF-IDF fallback) map commodity and market names to the e-Soko catalog.\n"
                "- **Anomaly engine**: price rules, robust z-score and IQR, pricing ladder, and a scikit-learn "
                "Isolation Forest trained on the e-Soko snapshot.\n\n"
                "Errors always return `{error, message}` as JSON."
            ),
        },
        "servers": [{"url": server_url}],
        "tags": [
            {"name": "Analysis", "description": "Full pipeline used by the upload page."},
            {"name": "Matching engine"},
            {"name": "Anomaly engine"},
            {"name": "System"},
        ],
        "paths": PATHS,
        "components": {"schemas": SCHEMAS},
    }


def swagger_html(spec_url: str) -> str:
    cdn = f"https://unpkg.com/swagger-ui-dist@{SWAGGER_UI_VERSION}"
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>e-biciro Python AI API — docs</title>
  <link rel="stylesheet" href="{cdn}/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="{cdn}/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.ui = SwaggerUIBundle({{ url: "{spec_url}", dom_id: "#swagger-ui", deepLinking: true, tryItOutEnabled: true }});
  </script>
</body>
</html>"""
