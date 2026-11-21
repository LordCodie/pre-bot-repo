"""Predict all scheduled matches and upsert into `predictions` (keyed by match_id + model_version,
so predictions from other model versions are preserved).  python -m training.batch_predict"""
import os

import joblib
from dotenv import load_dotenv

load_dotenv(os.getenv("ENV_FILE", ".env"))
from app.predictor import Predictor  # noqa: E402
from training.dataset import FEATURE_COLS, build_feature_table, get_client, load_matches  # noqa: E402


def predict_and_upsert(bundle: dict, client=None) -> int:
    client = client or get_client()
    p = Predictor(); p.bundle = bundle
    table = build_feature_table(load_matches(client))
    sched = table[table.status == "scheduled"]
    if sched.empty:
        return 0
    results = p.predict_frame(sched[FEATURE_COLS], sched.id.tolist())
    rows = [{k: r[k] for k in ("match_id", "model_version", "home_win_prob", "draw_prob",
                               "away_win_prob", "predicted_outcome")} for r in results]
    total = 0
    for i in range(0, len(rows), 200):
        res = client.table("predictions").upsert(rows[i:i + 200], on_conflict="match_id,model_version").execute()
        total += len(res.data)
    return total


if __name__ == "__main__":
    b = joblib.load(os.getenv("MODEL_PATH", "artifacts/model.joblib"))
    print(f"upserted {predict_and_upsert(b)} predictions with {b['version']}")
