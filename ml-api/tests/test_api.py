import io
import json

import pytest

from minagri_ai.config import RAW_DATA_DIR


@pytest.fixture(scope="module")
def client():
    from app import create_app

    return create_app().test_client()


def test_health_reports_trained_model(client):
    body = client.get("/api/health").get_json()
    assert body["priceModel"]["loaded"], body["priceModel"]["error"]
    assert body["catalog"]["markets"] == 67


def test_match_handles_misspellings_and_unknown_names(client):
    body = client.post("/api/match", json={"kind": "market", "names": ["Nyabugogo Mkt", "Karenje", "Laptop"]}).get_json()
    by_input = {r["input"]: r for r in body["results"]}
    assert by_input["Nyabugogo Mkt"]["value"] == "Nyabugogo"
    assert by_input["Karenje"]["value"] == "Karenge"
    assert by_input["Laptop"]["status"] == "unknown"


def test_raw_esoko_exports_reproduce_snapshot_coverage(client):
    files = ["esoko-farmgate.json", "esoko-wholesaler.json", "esoko-retailer.json"]
    if not all((RAW_DATA_DIR / f).exists() for f in files):
        pytest.skip("raw e-Soko exports not present")
    data = {"files": [(io.BytesIO((RAW_DATA_DIR / f).read_bytes()), f) for f in files]}
    body = client.post("/api/analyze", data=data, content_type="multipart/form-data").get_json()
    assert len(body["records"]) == 1096
    assert body["coverage"]["reportingMarkets"] == 11
    assert "Northern Province" in body["coverage"]["missingProvinces"]
    assert body["ml"]["isolationForest"]["applied"]
    assert any(i["title"].startswith("Commodity is archived") for i in body["issues"])


def test_injected_errors_are_flagged(client):
    csv = "\n".join([
        "date,market,commodity,price_type,unit,price",
        *[f"2026-09-28,{m},Irish-potato,retail,kg,{p}" for m, p in
          [("Nyabugogo", 600), ("Kimisagara", 620), ("Musanze", 580), ("Rubavu", 590), ("Huye", 610), ("Byumba", 6000)]],
        "2026-09-28,Musanze,Irish-potato,farmgate,kg,700",
    ])
    body = client.post("/api/analyze", data={"file": (io.BytesIO(csv.encode()), "prices.csv")},
                       content_type="multipart/form-data").get_json()
    rec_by_id = {r["id"]: r for r in body["records"]}
    flagged = {(rec_by_id[i["recordId"]]["market"], i["type"]) for i in body["issues"]}
    assert ("Byumba", "PRICE_ANOMALY") in flagged
    assert ("Musanze", "LADDER_VIOLATION") in flagged


def test_json_table_body_and_errors(client):
    ok = client.post("/api/analyze", json={"headers": ["market", "commodity", "price"],
                                            "rows": [{"market": "Nyabugogo", "commodity": "Beans", "price": "900"}]})
    assert ok.status_code == 200
    bad = client.post("/api/analyze", data=json.dumps({"nope": 1}), content_type="application/json")
    assert bad.status_code == 400


def test_openapi_spec_documents_every_route(client):
    spec = client.get("/api/openapi.json").get_json()
    routes = {
        (rule.rule, method.lower())
        for rule in client.application.url_map.iter_rules()
        if rule.rule.startswith("/api/") and rule.rule not in ("/api/openapi.json", "/api/docs")
        for method in rule.methods - {"HEAD", "OPTIONS"}
    }
    documented = {(path, method) for path, ops in spec["paths"].items() for method in ops}
    assert routes == documented

    assert set(_walk_refs(spec)) <= {f"#/components/schemas/{name}" for name in spec["components"]["schemas"]}

    docs = client.get("/api/docs")
    assert docs.status_code == 200 and b"/api/openapi.json" in docs.data


def _walk_refs(node):
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "$ref":
                yield value
            else:
                yield from _walk_refs(value)
    elif isinstance(node, list):
        for item in node:
            yield from _walk_refs(item)
