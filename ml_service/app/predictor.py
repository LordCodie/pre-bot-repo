"""Model loading + inference (no training logic here)."""
import time
import joblib
import numpy as np
import pandas as pd

from training.dataset import FEATURE_COLS, LABELS, build_feature_table, get_client, load_matches

FEATURE_CACHE_TTL = 300


class ModelNotLoaded(RuntimeError): ...
class MatchNotFound(LookupError): ...


def proba_to_results(proba: np.ndarray, version: str, match_ids=None) -> list[dict]:
    """Clip, renormalise, round to 6dp and fix rounding drift so probabilities sum to 1 (+-1e-6)."""
    out = []
    for i, row in enumerate(np.atleast_2d(proba)):
        p = np.clip(row.astype(float), 0, 1)
        p = np.round(p / p.sum(), 6)
        k = int(np.argmax(p))
        p[k] = round(p[k] + (1 - p.sum()), 6)
        out.append({"match_id": None if match_ids is None else int(match_ids[i]),
                    "home_win_prob": float(p[0]), "draw_prob": float(p[1]), "away_win_prob": float(p[2]),
                    "predicted_outcome": LABELS[k], "model_version": version})
    return out


class Predictor:
    def __init__(self):
        self.bundle = None
        self._cache = (0.0, None)

    @property
    def loaded(self) -> bool:
        return self.bundle is not None

    @property
    def version(self):
        return self.bundle["version"] if self.bundle else None

    def load(self, path: str):
        self.bundle = joblib.load(path)
        self._cache = (0.0, None)

    def _require(self):
        if not self.loaded:
            raise ModelNotLoaded("No trained model is loaded")

    def predict_frame(self, X: pd.DataFrame, match_ids=None) -> list[dict]:
        self._require()
        cols = self.bundle["feature_cols"]
        proba = self.bundle["model"].predict_proba(X.reindex(columns=cols).astype(float))
        return proba_to_results(proba, self.version, match_ids)

    def predict_features(self, features: dict) -> dict:
        return self.predict_frame(pd.DataFrame([features]))[0]

    def _table(self, refresh=False) -> pd.DataFrame:
        ts, table = self._cache
        if refresh or table is None or time.time() - ts > FEATURE_CACHE_TTL:
            table = build_feature_table(load_matches(get_client()))
            self._cache = (time.time(), table)
        return table

    def predict_matches(self, match_ids: list[int] | None):
        """match_ids None -> every scheduled match. Returns (results, missing_ids)."""
        self._require()
        table = self._table()
        sel = table[table.status == "scheduled"] if match_ids is None else table[table.id.isin(match_ids)]
        missing = [] if match_ids is None else sorted(set(match_ids) - set(sel.id))
        if sel.empty:
            return [], missing
        return self.predict_frame(sel[FEATURE_COLS], sel.id.tolist()), missing

    def predict_match(self, match_id: int) -> dict:
        res, _ = self.predict_matches([match_id])
        if not res:
            raise MatchNotFound(f"Match {match_id} not found")
        return res[0]
