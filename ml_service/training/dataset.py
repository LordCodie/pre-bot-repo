"""Supabase retrieval + leakage-free feature engineering.

Features for a match use ONLY matches from strictly earlier calendar days, so same-day results
(or the target match itself) can never leak in. Features are computed from the matches table,
which is the source of truth; team_stats snapshots are deliberately not used for training because
a snapshot taken after a match would include that match.
"""
import os
from collections import defaultdict
from urllib.parse import urlparse

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.getenv("ENV_FILE", ".env"))

LABELS = ["H", "D", "A"]                       # class order == model class index 0,1,2
LABEL_TO_IDX = {l: i for i, l in enumerate(LABELS)}
FEATURE_COLS = [
    "h_pts3", "h_pts5", "h_gf5", "h_ga5", "h_home_ppg", "h_home_gf", "h_home_ga",
    "a_pts3", "a_pts5", "a_gf5", "a_ga5", "a_away_ppg", "a_away_gf", "a_away_ga",
    "diff_pts5", "diff_gf5", "diff_ga5", "diff_gd5", "diff_venue_ppg", "diff_venue_gf", "diff_venue_ga",
]


def get_client():
    url, key = os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    host = urlparse(url).hostname
    if os.getenv("APP_ENV") == "test" and host not in {"localhost", "127.0.0.1", "host.docker.internal"}:
        raise RuntimeError(f"APP_ENV=test but Supabase host '{host}' is not local; refusing.")
    return create_client(url, key)


def fetch_all(client, table, columns, page=1000, **filters):
    rows, start = [], 0
    while True:
        q = client.table(table).select(columns).order("id")
        for k, v in filters.items():
            q = q.eq(k, v)
        data = q.range(start, start + page - 1).execute().data
        rows += data
        if len(data) < page:
            return rows
        start += page


def load_matches(client) -> pd.DataFrame:
    cols = "id,league_id,home_team_id,away_team_id,match_date,home_goals,away_goals,status"
    df = pd.DataFrame(fetch_all(client, "matches", cols))
    if df.empty:
        return df
    df["match_date"] = pd.to_datetime(df["match_date"], utc=True)
    return df.sort_values(["match_date", "id"]).reset_index(drop=True)


def _mean(vals):
    return float(np.mean(vals)) if len(vals) else np.nan


def _form(hist, n):
    last = hist[-n:]
    return (_mean([h[3] for h in last]), _mean([h[1] for h in last]), _mean([h[2] for h in last]))


def _venue(hist, is_home):
    sel = [h for h in hist if h[0] == is_home][-10:]
    return (_mean([h[3] for h in sel]), _mean([h[1] for h in sel]), _mean([h[2] for h in sel]))


def build_feature_table(matches: pd.DataFrame) -> pd.DataFrame:
    """One row per match (finished + scheduled) with FEATURE_COLS, plus id/match_date/status/label."""
    if matches.empty:
        return pd.DataFrame(columns=["id", "match_date", "status", "label", *FEATURE_COLS])
    hist = defaultdict(list)                 # team_id -> [(is_home, gf, ga, pts), ...] in time order
    rows = []
    days = matches["match_date"].dt.floor("D")
    for _, grp in matches.groupby(days, sort=True):
        for m in grp.itertuples(index=False):             # 1) features from history BEFORE this day
            hh, ah = hist[m.home_team_id], hist[m.away_team_id]
            hp3, _, _ = _form(hh, 3); hp5, hgf, hga = _form(hh, 5)
            ap3, _, _ = _form(ah, 3); ap5, agf, aga = _form(ah, 5)
            hv, hvgf, hvga = _venue(hh, True); av, avgf, avga = _venue(ah, False)
            label = None
            if m.status == "finished":
                label = "H" if m.home_goals > m.away_goals else ("D" if m.home_goals == m.away_goals else "A")
            rows.append({
                "id": m.id, "match_date": m.match_date, "status": m.status, "label": label,
                "h_pts3": hp3, "h_pts5": hp5, "h_gf5": hgf, "h_ga5": hga,
                "h_home_ppg": hv, "h_home_gf": hvgf, "h_home_ga": hvga,
                "a_pts3": ap3, "a_pts5": ap5, "a_gf5": agf, "a_ga5": aga,
                "a_away_ppg": av, "a_away_gf": avgf, "a_away_ga": avga,
                "diff_pts5": hp5 - ap5, "diff_gf5": hgf - agf, "diff_ga5": hga - aga,
                "diff_gd5": (hgf - hga) - (agf - aga),
                "diff_venue_ppg": hv - av, "diff_venue_gf": hvgf - avgf, "diff_venue_ga": hvga - avga,
            })
        for m in grp.itertuples(index=False):             # 2) only now add this day's results
            if m.status != "finished":
                continue
            hg, ag = int(m.home_goals), int(m.away_goals)
            hp = 3 if hg > ag else (1 if hg == ag else 0)
            hist[m.home_team_id].append((True, hg, ag, hp))
            hist[m.away_team_id].append((False, ag, hg, 3 - hp if hp != 1 else 1))
    return pd.DataFrame(rows)
