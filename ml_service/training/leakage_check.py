"""Sanity check: features of a match must not change if its own (or later) results are altered."""
import numpy as np
from training.dataset import load_matches, build_feature_table, get_client, FEATURE_COLS

if __name__ == "__main__":
    m = load_matches(get_client())
    base = build_feature_table(m)
    fin = m[m.status == "finished"]
    cut = fin.match_date.iloc[len(fin) // 2]
    tampered = m.copy()
    mask = (tampered.match_date >= cut) & (tampered.status == "finished")
    tampered.loc[mask, "home_goals"] = tampered.loc[mask, "home_goals"] + 5
    alt = build_feature_table(tampered)
    before = base.match_date < cut.floor("D")
    same = np.allclose(base.loc[before, FEATURE_COLS].fillna(-1), alt.loc[before, FEATURE_COLS].fillna(-1))
    print("NO LEAKAGE" if same else "LEAKAGE DETECTED"); raise SystemExit(0 if same else 1)
