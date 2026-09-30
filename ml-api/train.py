"""Trains and evaluates the MINAGRI AI models on the real e-Soko snapshot.

    .venv/bin/python train.py            # train, evaluate, write models/
    .venv/bin/python train.py --no-st    # use the TF-IDF fallback instead of the Sentence Transformer

Outputs (models/):
  price_iforest.joblib       scikit-learn IsolationForest + review threshold
  matching_calibration.json  auto-accept / review thresholds calibrated for the active embedding backend
  model_card.json            training data, evaluation protocol and results
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np
import pandas as pd


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-st", action="store_true", help="skip the Sentence Transformer (TF-IDF fallback)")
    ap.add_argument("--rounds", type=int, default=8)
    ap.add_argument("--per-round", type=int, default=40)
    args = ap.parse_args()
    if args.no_st:
        os.environ["MINAGRI_USE_SENTENCE_TRANSFORMER"] = "0"

    from minagri_ai import anomaly, matching
    from minagri_ai.catalog import load_catalog
    from minagri_ai.config import (
        CONTAMINATION, DEFAULT_MATCHING, MATCHING_CALIBRATION_PATH, MODEL_CARD_PATH, PRICE_MODEL_PATH, SNAPSHOT_PATH,
    )
    from minagri_ai.features import FEATURES
    from minagri_ai.ingest import Table
    from minagri_ai.pipeline import analyze
    from minagri_ai.rules import detect_ladder_violations
    from minagri_ai.statistics import detect_price_outliers

    cat = load_catalog()
    snap = json.loads(SNAPSHOT_PATH.read_text())
    table = Table(snap["headers"], [dict(zip(snap["headers"], row)) for row in snap["rows"]])
    print(f"Snapshot {snap['date']}: {len(table.rows)} rows · catalog {len(cat.commodities)} commodities, {len(cat.markets)} markets")

    # ------------------------------------------------------------ matched records
    base = analyze(table, use_embedding=True)
    df = pd.DataFrame(base["records"]).rename(columns={"rowNumber": "row_number"})
    df = df[["id", "row_number", "date", "province", "market", "commodity", "unit", "channel", "price"]]
    df["price"] = pd.to_numeric(df["price"], errors="coerce")
    priced = df[(df["price"] > 0) & (df["channel"] != "") & (df["commodity"] != "")]

    # ------------------------------------------------------------ train Isolation Forest
    model = anomaly.train_price_model(df, {"source": "Rwanda e-Soko export", "date": snap["date"], "rows": int(len(priced))})
    model.save()
    anomaly.load_price_model(reload=True)
    train_scores = model.score(__import__("minagri_ai.features", fromlist=["build_features"]).build_features(df).X)
    print(f"Isolation Forest: {len(model.forest.estimators_)} trees, threshold {model.threshold} → {PRICE_MODEL_PATH.name}")

    def flags(frame: pd.DataFrame) -> dict[str, set[str]]:
        stat = detect_price_outliers(frame)
        ladder = detect_ladder_violations(frame)
        issues, _, forest_ids = anomaly.run_anomaly_engine(frame)
        return {
            "forest": set(forest_ids),
            "statistical": {i["recordId"] for i in stat},
            "ladder": {i["recordId"] for i in ladder},
            "hybrid": {i["recordId"] for i in issues},
        }

    baseline = {k: len(v) for k, v in flags(df).items()}
    print("Flags on the real snapshot:", baseline)

    # ------------------------------------------------------------ price evaluation (injected errors)
    rng = random.Random(42)
    injections = {
        "Extra zero (×10)": lambda p, row, grp: p * 10,
        "Missing zero (÷10)": lambda p, row, grp: p / 10,
        "Spike (+60%)": lambda p, row, grp: p * 1.6,
        "Ladder inversion": None,
    }
    tally = {k: defaultdict(int) for k in injections}
    untouched = untouched_forest = untouched_hybrid = 0
    groups = {k: g.index.tolist() for k, g in priced.groupby(["date", "market", "commodity"])}
    ladder_groups = [k for k, idx in groups.items() if {"farmgate", "retail"} <= set(priced.loc[idx, "channel"])]
    for _ in range(args.rounds):
        frame = df.copy()
        chosen: dict[tuple, str] = {}
        keys = list(groups)
        rng.shuffle(keys)
        types = list(injections)
        for n, key in enumerate(keys):
            if len(chosen) >= args.per_round:
                break
            kind = types[n % len(types)]
            if kind == "Ladder inversion":
                if key not in ladder_groups:
                    continue
                idx = groups[key]
                farm = next(i for i in idx if frame.at[i, "channel"] == "farmgate")
                retail = next(i for i in idx if frame.at[i, "channel"] == "retail")
                frame.at[retail, "price"] = round(frame.at[farm, "price"] * 0.7, 2)
            else:
                i = rng.choice(groups[key])
                frame.at[i, "price"] = round(injections[kind](frame.at[i, "price"], None, None), 2)
            chosen[key] = kind
        f = flags(frame)
        touched_ids = set()
        for key, kind in chosen.items():
            ids = set(frame.loc[groups[key], "id"])
            touched_ids |= ids
            tally[kind]["injected"] += 1
            for method in ("forest", "statistical", "ladder", "hybrid"):
                if ids & f[method]:
                    tally[kind][method] += 1
        clean_ids = set(priced["id"]) - touched_ids
        untouched += len(clean_ids)
        untouched_forest += len(clean_ids & f["forest"])
        untouched_hybrid += len(clean_ids & f["hybrid"])

    def pct(a, b):
        return round(100 * a / b, 1) if b else 0.0

    by_type = [
        {"type": k, "injected": t["injected"], "forestRecall": pct(t["forest"], t["injected"]),
         "statisticalRecall": pct(t["statistical"], t["injected"]), "ladderRuleRecall": pct(t["ladder"], t["injected"]),
         "hybridRecall": pct(t["hybrid"], t["injected"])}
        for k, t in tally.items()
    ]
    total = {m: sum(t[m] for t in tally.values()) for m in ("injected", "forest", "statistical", "ladder", "hybrid")}
    overall = {"forestRecall": pct(total["forest"], total["injected"]),
               "statisticalRecall": pct(total["statistical"], total["injected"]),
               "hybridRecall": pct(total["hybrid"], total["injected"])}
    flag_rate = {"forest": pct(untouched_forest, untouched), "hybrid": pct(untouched_hybrid, untouched)}
    print(pd.DataFrame(by_type).to_string(index=False))
    print("Overall", overall, "· flag rate on untouched rows", flag_rate)

    # ------------------------------------------------------------ matching evaluation + calibration
    out_of_catalog = [
        "Laptop", "Cement", "Diesel fuel", "Mobile phone", "Toothpaste", "Bicycle", "Petrol", "Roofing sheets",
        "School fees", "Airtime", "Paracetamol", "Printer paper", "Motorbike", "Solar panel", "Detergent",
        "Kerosene", "Bus ticket", "Nails", "Charcoal stove", "Umbrella",
    ]
    prng = random.Random(7)
    vowels = "aeiou"

    def drop(s):
        i = 1 + prng.randrange(max(1, len(s) - 2))
        return s[:i] + s[i + 1:]

    def swap(s):
        if len(s) < 4:
            return s
        i = 1 + prng.randrange(max(1, len(s) - 3))
        return s[:i] + s[i + 1] + s[i] + s[i + 2:]

    def vowel(s):
        idx = [i for i, c in enumerate(s) if c.lower() in vowels and i > 0]
        if not idx:
            return s + "a"
        i = prng.choice(idx)
        return s[:i] + vowels[(vowels.index(s[i].lower()) + 1) % 5] + s[i + 1:]

    def spacing(s):
        return f"  {s.upper().replace(' ', '  ')} "

    perturb = {"drop a letter": drop, "swap two letters": swap, "wrong vowel": vowel, "case and spacing": spacing}

    def status(score, agree, ambiguous, t):
        if score < t["review_min"]:
            return "unknown"
        if ambiguous:
            return "review"
        if score >= t["auto_accept"] and agree is not False:
            return "auto"
        return "review"

    # Hand-labelled phrasing variants a reporter might type (English plural/singular, synonyms, word order).
    semantic_variants = [
        ("Maize grain", {"Maize"}), ("Dry maize", {"Maize"}), ("Cooking banana", {"Banana"}),
        ("Dessert banana", {"Banan-fruit"}), ("Red onions", {"Onion-Red"}), ("Green beans", {"Green bean"}),
        ("Groundnuts", {"Groundnut"}), ("Peanuts", {"Groundnut"}), ("Sweet potato", {"Sweet-potatoes"}),
        ("Irish potatoes", {"Irish-potato"}), ("Tomatoes", {"Tomatos"}), ("Carrots", {"Carrot"}),
        ("Pineapples", {"Pineapple"}), ("Fresh milk", {"Milk-fresh"}), ("Cow milk", {"Milk-fresh"}),
        ("Palm oil", {"Palm-oil"}), ("Wheat flour", {"Wheat-flour"}), ("Soybeans", {"Soya-Bean"}),
        ("Pork", {"Porc meat"}), ("Chicken eggs", {"Egg"}), ("Aubergine", {"Eggplant"}), ("Chili pepper", {"Chilli"}),
        ("Hot pepper", {"Chilli"}), ("Beetroot", {"Betterave"}), ("Passion fruit", {"Passion-fruit"}),
        ("Rabbit meat", {"Meat - Rabbit"}), ("Mutton", {"Sheep meat"}), ("Bell pepper", {"Sweet pepper"}),
        ("Zucchini", {"Courgette"}), ("Tilapia fish", {"Fish - Tilapia"}), ("Cooking gas", {"Gaz"}),
        ("Urea", {"Uree"}), ("Pawpaw", {"Papaya"}), ("Tangerine", {"Mandarin"}), ("Mangoes", {"Mango"}),
        ("Avocados", {"Avocado"}), ("Fresh cassava", {"Cassava"}), ("Sorghum grain", {"Sorghum"}),
        ("Maize meal", {"Maize Flour", "Maize-flour"}), ("Cabbages", {"Cabbage"}),
    ]
    known = {c.name for c in cat.commodities}
    semantic_variants = [(q, a) for q, a in semantic_variants if a <= known]

    def status(score, agree, ambiguous, t):
        if score < t["review_min"]:
            return "unknown"
        if ambiguous:
            return "review"
        if score >= t["auto_accept"] and agree is not False:
            return "auto"
        return "review"

    def evaluate(eng, cases, negatives, use_emb):
        res = eng.match_many([c[0] for c in cases] + negatives, use_embedding=use_emb)
        rows = []
        for inp, accepted in cases:
            r = res[inp]
            top = r.candidates[0] if r.candidates else None
            tied = {c.value for c in r.candidates if top and top.score - c.score < 0.02}
            correct = bool(tied & accepted)
            rows.append((1.0 if r.status == "exact" else (top.score if top else 0.0), r.models_agree,
                         r.status == "ambiguous", correct))
        negs = [res[n].candidates[0].score if res[n].candidates else 0.0 for n in negatives]
        return rows, negs

    def summarise(rows, negs, th):
        st = [status(r[0], r[1], r[2], th) for r in rows]
        n = len(rows)
        auto = [r for r, x in zip(rows, st) if x == "auto"]
        review = [r for r, x in zip(rows, st) if x == "review"]
        out = {
            "top1": pct(sum(r[3] for r in rows), n),
            "autoAccepted": pct(len(auto), n),
            "autoAcceptPrecision": pct(sum(r[3] for r in auto), len(auto)),
            "wrongAutoAccepts": int(sum(not r[3] for r in auto)),
            "sentToReview": pct(len(review), n),
            "reviewSuggestionCorrect": pct(sum(r[3] for r in review), len(review)),
            "reportedUnknown": pct(sum(x == "unknown" for x in st), n),
        }
        if negs:
            out["outOfCatalogGivenSuggestion"] = int(sum(v >= th["review_min"] for v in negs))
        return out

    def decisions(eng, cases, negatives, use_emb):
        """Scores the engine's own decisions (exact/auto = accepted, review/ambiguous/archived = review)."""
        res = eng.match_many([c[0] for c in cases] + negatives, use_embedding=use_emb)
        auto = review = unknown = auto_ok = review_ok = top_ok = 0
        for inp, accepted in cases:
            r = res[inp]
            lead = r.candidates[0].value if r.candidates else ""
            tied = {c.value for c in r.candidates if r.candidates and r.candidates[0].score - c.score < 0.02}
            ok = bool((tied | {lead}) & accepted)
            top_ok += ok
            if r.status in ("exact", "auto"):
                auto += 1
                auto_ok += r.value in accepted
            elif r.status == "unknown":
                unknown += 1
            else:
                review += 1
                review_ok += ok
        n = len(cases)
        out = {"top1": pct(top_ok, n), "autoAccepted": pct(auto, n), "autoAcceptPrecision": pct(auto_ok, auto),
               "wrongAutoAccepts": auto - auto_ok, "sentToReview": pct(review, n),
               "reviewSuggestionCorrect": pct(review_ok, review), "reportedUnknown": pct(unknown, n)}
        if negatives:
            out["outOfCatalogGivenSuggestion"] = sum(res[x].status not in ("unknown", "empty") for x in negatives)
        return out

    def first_clean_auto(rows_list, review_min, default):
        for a in (round(0.85 + 0.01 * k, 2) for k in range(14)):  # floor keeps a margin beyond the evaluation names
            th = {"review_min": review_min, "auto_accept": a}
            autos = [r for rows in rows_list for r in rows if status(r[0], r[1], r[2], th) == "auto"]
            if autos and all(r[3] for r in autos):
                return a
        return default

    backend = matching.embedder_status()["backend"]
    calibration: dict = {"backend": backend}
    matching_eval: dict = {}
    margins = [0.0, 0.02, 0.05, 0.08, 0.12, 0.2, 9.0]
    for kind in ("commodity", "market"):
        cases: list[tuple[str, set[str]]] = []
        if kind == "commodity":
            for c in cat.commodities:
                for name in dict.fromkeys(n for n in (c.name, c.local) if n):
                    cases.append((name, {c.name}))
                    cases += [(fn(name), {c.name}) for fn in perturb.values()]
        else:
            for m in cat.markets:
                accepted = {x.name for x in cat.markets if x.source.lower() == m.source.lower()}
                cases.append((m.source, accepted))
                cases += [(fn(m.source), accepted) for fn in perturb.values()]
        variants = semantic_variants if kind == "commodity" else []

        def engine_for(margin):
            cal = json.loads(json.dumps(DEFAULT_MATCHING))
            cal["veto_margin"] = margin
            return matching.MatchingEngine(kind, cat, calibration=cal)

        # 1. review line: just above the best-scoring out-of-catalog name
        base_rows, negs = evaluate(engine_for(0.05), cases, out_of_catalog, True)
        review_min = round(min(0.8, max(0.4, max(negs) + 0.02)), 2)
        # semantic line: above every out-of-catalog name, and only where rescues are right more often than wrong
        neg_res = engine_for(0.05).match_many(out_of_catalog, use_embedding=True)
        neg_emb = [r.embedding_top.score for r in neg_res.values() if r.embedding_top]
        floor = max(0.75, max(neg_emb, default=0.0) + 0.02)
        probe_cal = json.loads(json.dumps(DEFAULT_MATCHING))
        probe_cal[kind]["review_min"] = review_min
        probe = matching.MatchingEngine(kind, cat, calibration=probe_cal)
        pool = cases + (semantic_variants if kind == "commodity" else [])
        pres = probe.match_many([c[0] for c in pool], use_embedding=True)
        rescuable = [(pres[q].embedding_top.score, pres[q].embedding_top.value in acc)
                     for q, acc in pool if pres[q].status == "unknown" and pres[q].embedding_top]
        embedding_suggest, best_net = None, 0
        for line in (round(0.75 + 0.01 * k, 2) for k in range(23)):
            if line < floor:
                continue
            hits = [ok for sc, ok in rescuable if sc >= line]
            net = sum(hits) - (len(hits) - sum(hits))
            if net > best_net:
                embedding_suggest, best_net = line, net
        semantic_note = {"floorFromOutOfCatalog": round(floor, 2), "unknownCasesConsidered": len(rescuable),
                         "netCorrectRescues": best_net}

        # 2. embedding veto margin: fewest review items without adding a wrong auto-accept on either test set
        sweep = []
        for margin in margins:
            eng = engine_for(margin)
            rows, _ = evaluate(eng, cases, [], True)
            vrows = evaluate(eng, variants, [], True)[0] if variants else []
            a = first_clean_auto([rows, vrows], review_min, DEFAULT_MATCHING[kind]["auto_accept"])
            th = {"review_min": review_min, "auto_accept": a}
            m_sum, v_sum = summarise(rows, [], th), summarise(vrows, [], th) if vrows else None
            wrong = m_sum["wrongAutoAccepts"] + (v_sum["wrongAutoAccepts"] if v_sum else 0)
            review_load = m_sum["sentToReview"]
            sweep.append({"margin": margin, "autoAccept": a, "wrongAutoAccepts": wrong, "misspellingsToReview": review_load,
                          "variantsAutoAccepted": v_sum["autoAccepted"] if v_sum else None})
        best = min(sweep, key=lambda r: (r["wrongAutoAccepts"], r["misspellingsToReview"], -r["margin"]))
        margin = best["margin"]
        t = {"auto_accept": best["autoAccept"], "review_min": review_min, "embedding_suggest": embedding_suggest}
        calibration[kind] = t
        calibration.setdefault("veto_margin_by_kind", {})[kind] = margin

        final_cal = json.loads(json.dumps(DEFAULT_MATCHING))
        final_cal[kind] = t
        final_cal["veto_margin"] = margin
        eng = matching.MatchingEngine(kind, cat, calibration=final_cal)
        report = {"cases": len(cases), "outOfCatalogNames": len(out_of_catalog), "thresholds": t, "vetoMargin": margin,
                  "maxOutOfCatalogScore": round(max(negs), 4), "maxOutOfCatalogEmbedding": round(max(neg_emb, default=0), 4),
                  "marginSweep": sweep, "semanticSuggestion": semantic_note}
        for mode, use_emb in (("rapidfuzzOnly", False), ("withEmbeddings", True)):
            report[mode] = decisions(eng, cases, out_of_catalog, use_emb)
            if variants:
                report[f"{mode}Variants"] = decisions(eng, variants, [], use_emb)
        if variants:
            report["variantCases"] = len(variants)
        matching_eval[kind] = report
        print(f"\n{kind}: thresholds {t}, veto margin {margin}")
        print(pd.DataFrame(sweep).to_string(index=False))
        cols = [k for k in ("rapidfuzzOnly", "withEmbeddings", "rapidfuzzOnlyVariants", "withEmbeddingsVariants") if k in report]
        print(pd.DataFrame({k: report[k] for k in cols}).to_string())

    calibration["calibratedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    MATCHING_CALIBRATION_PATH.write_text(json.dumps(calibration, indent=2) + "\n")

    card = {
        "generatedAt": calibration["calibratedAt"],
        "runtime": {"python": sys.version.split()[0], "sklearn": __import__("sklearn").__version__,
                    "rapidfuzz": __import__("rapidfuzz").__version__},
        "data": {"source": "Rwanda e-Soko export", "date": snap["date"], "rows": len(table.rows), "pricedRows": int(len(priced)),
                 "commodities": len(cat.commodities), "markets": len(cat.markets)},
        "anomalyEngine": {
            "layers": ["Rules (non-positive price)", "Robust z-score + IQR per commodity × channel",
                       "Farm gate ≤ wholesale ≤ retail ladder", "Isolation Forest on relative price features"],
            "isolationForest": {
                "library": "scikit-learn IsolationForest", "trees": len(model.forest.estimators_),
                "maxSamples": int(model.forest.max_samples_), "features": FEATURES, "contamination": CONTAMINATION,
                "threshold": model.threshold,
                "trainingScores": {q: round(float(np.quantile(train_scores, v)), 4) for q, v in
                                   (("median", 0.5), ("p90", 0.9), ("p975", 0.975), ("max", 1.0))},
            },
            "baselineFlagsOnSnapshot": baseline,
            "evaluation": {
                "protocol": f"{args.rounds} rounds × {args.per_round} errors injected into copies of the real snapshot, one per "
                            "market-commodity price set. A detection counts when any row of that set is flagged.",
                "byType": by_type, "overall": overall, "untouchedFlagRate": flag_rate,
            },
        },
        "matchingEngine": {
            "pipeline": ["Normalisation", "Exact name / alias lookup", "RapidFuzz ranking",
                         f"{calibration['backend']} embeddings as a second opinion when RapidFuzz < 0.92"],
            "embeddingBackend": calibration["backend"],
            "calibration": {k: calibration[k] for k in ("commodity", "market", "veto_margin_by_kind")},
            "evaluation": {
                "protocol": "Every catalog name (English + Kinyarwanda for commodities, e-Soko spelling for markets) plus four "
                            f"misspellings each, and {len(out_of_catalog)} names in neither registry.",
                **matching_eval,
            },
        },
    }
    MODEL_CARD_PATH.write_text(json.dumps(card, indent=2, ensure_ascii=False) + "\n")
    print(f"\nWrote {PRICE_MODEL_PATH.name}, {MATCHING_CALIBRATION_PATH.name}, {MODEL_CARD_PATH.name}")


if __name__ == "__main__":
    main()
