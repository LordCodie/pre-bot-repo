"""Offline training: python -m training.train [--skip-predict]
Reads MODEL_PATH (e.g. artifacts/model.joblib, or artifacts/model_test.joblib in the test env)."""
import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from dotenv import load_dotenv
from lightgbm import LGBMClassifier
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import RandomForestClassifier
from sklearn.frozen import FrozenEstimator
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, log_loss, precision_recall_fscore_support
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.utils.class_weight import compute_sample_weight
from xgboost import XGBClassifier

load_dotenv(os.getenv("ENV_FILE", ".env"))
from training.dataset import FEATURE_COLS, LABELS, LABEL_TO_IDX, build_feature_table, get_client, load_matches  # noqa: E402

MIN_ROWS = int(os.getenv("MIN_TRAIN_ROWS", "300"))
SEED = 42


def candidates():
    return {
        "logreg": (make_pipeline(SimpleImputer(strategy="median"), StandardScaler(),
                                 LogisticRegression(max_iter=2000, class_weight="balanced")), False),
        "rf": (make_pipeline(SimpleImputer(strategy="median"),
                             RandomForestClassifier(n_estimators=300, min_samples_leaf=5, n_jobs=-1,
                                                    class_weight="balanced_subsample", random_state=SEED)), False),
        "xgb": (XGBClassifier(objective="multi:softprob", n_estimators=300, learning_rate=0.03,
                              max_depth=3, subsample=0.8, colsample_bytree=0.8,
                              eval_metric="mlogloss", random_state=SEED), True),
        "lgbm": (LGBMClassifier(n_estimators=300, learning_rate=0.03, num_leaves=15,
                                min_child_samples=20, class_weight="balanced",
                                random_state=SEED, verbose=-1), False),
    }


def evaluate(y, proba) -> dict:
    y = np.asarray(y); pred = proba.argmax(1)
    onehot = np.eye(3)[y]
    p, r, f, _ = precision_recall_fscore_support(y, pred, labels=[0, 1, 2], zero_division=0)
    return {"accuracy": float(accuracy_score(y, pred)),
            "log_loss": float(log_loss(y, proba, labels=[0, 1, 2])),
            "brier": float(((proba - onehot) ** 2).sum(1).mean()),
            "per_class": {LABELS[i]: {"precision": float(p[i]), "recall": float(r[i]), "f1": float(f[i])}
                          for i in range(3)}}


def chrono_split(df, train=0.70, val=0.15):
    df = df.sort_values("match_date").reset_index(drop=True)
    a, b = int(len(df) * train), int(len(df) * (train + val))
    return df.iloc[:a], df.iloc[a:b], df.iloc[b:]


def run(skip_predict: bool = False) -> dict:
    model_path = Path(os.getenv("MODEL_PATH", "artifacts/model.joblib"))
    client = get_client()
    table = build_feature_table(load_matches(client))
    data = table[(table.status == "finished")].dropna(subset=["h_pts5", "a_pts5"])  # need some history
    if len(data) < MIN_ROWS:
        raise RuntimeError(f"Only {len(data)} usable finished matches; need >= {MIN_ROWS}")
    tr, va, te = chrono_split(data)
    assert tr.match_date.max() <= va.match_date.min() and va.match_date.max() <= te.match_date.min()
    X = lambda d: d[FEATURE_COLS].astype(float)
    Y = lambda d: d["label"].map(LABEL_TO_IDX).to_numpy()
    print(f"rows train/val/test = {len(tr)}/{len(va)}/{len(te)}  "
          f"({tr.match_date.min():%Y-%m-%d} → {te.match_date.max():%Y-%m-%d})")

    results, fitted = {}, {}
    for name, (model, needs_sw) in candidates().items():
        if needs_sw:
            model.fit(X(tr), Y(tr), sample_weight=compute_sample_weight("balanced", Y(tr)))
        else:
            model.fit(X(tr), Y(tr))
        results[name] = evaluate(Y(va), model.predict_proba(X(va)))
        fitted[name] = model
        print(f"{name:7s} val: acc={results[name]['accuracy']:.3f} "
              f"logloss={results[name]['log_loss']:.4f} brier={results[name]['brier']:.4f}")

    best = min(results, key=lambda n: results[n]["log_loss"])          # selection on validation only
    model, calibrated = fitted[best], False
    if len(va) >= 150:                                                  # calibrate on validation data
        model = CalibratedClassifierCV(FrozenEstimator(fitted[best]), method="sigmoid").fit(X(va), Y(va))
        calibrated = True
    test_metrics = evaluate(Y(te), model.predict_proba(X(te)))
    test_uncal = evaluate(Y(te), fitted[best].predict_proba(X(te)))
    print(f"selected={best} calibrated={calibrated}\n test: {json.dumps(test_metrics, indent=1)}")

    version = f"{best}_v1_{datetime.now(timezone.utc):%Y%m%d}"
    meta = {"version": version, "selected": best, "calibrated": calibrated,
            "trained_at": datetime.now(timezone.utc).isoformat(), "feature_cols": FEATURE_COLS,
            "rows": {"train": len(tr), "val": len(va), "test": len(te)},
            "validation": results, "test": test_metrics, "test_uncalibrated": test_uncal}
    bundle = {"model": model, "feature_cols": FEATURE_COLS, "classes": LABELS,
              "version": version, "metadata": meta}
    model_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, model_path.parent / f"{version}.joblib")        # versioned copy
    joblib.dump(bundle, model_path)                                     # active model
    model_path.with_suffix(".json").write_text(json.dumps(meta, indent=2))
    print(f"saved {model_path} ({version})")

    if not skip_predict:
        from training.batch_predict import predict_and_upsert
        n = predict_and_upsert(bundle, client)
        print(f"upserted {n} predictions")
    return meta


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-predict", action="store_true")
    run(ap.parse_args().skip_predict)
