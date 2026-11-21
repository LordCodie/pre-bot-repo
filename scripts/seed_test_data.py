"""Seed the LOCAL Supabase with clearly-labelled SYNTHETIC data (league source_url 'test://synthetic').
These are NOT real matches or results. Deterministic (fixed seed). Refuses non-local DBs.
  ENV_FILE=.env.test python scripts/seed_test_data.py [--reset]"""
import os, sys, random
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.getenv("ENV_FILE", ".env.test"))
URL, KEY = os.getenv("SUPABASE_URL", ""), os.getenv("SUPABASE_SERVICE_KEY", "")
if os.getenv("APP_ENV") != "test" or urlparse(URL).hostname not in {"localhost", "127.0.0.1", "host.docker.internal"}:
    sys.exit("Refusing to seed: APP_ENV must be 'test' and SUPABASE_URL must be local.")
db = create_client(URL, KEY)
SRC = "test://synthetic"

if "--reset" in sys.argv:
    db.table("leagues").delete().eq("source_url", SRC).execute()   # cascades to teams/matches/stats/predictions
    print("reset synthetic league")

rng = random.Random(42)
league = db.table("leagues").upsert({"name": "SYNTHETIC Test League", "country": "Testland", "source_url": SRC},
                                    on_conflict="source_url").execute().data[0]["id"]
names = [f"Test FC {i:02d}" for i in range(1, 17)]
db.table("teams").upsert([{"league_id": league, "name": n, "normalized_name": n} for n in names],
                         on_conflict="league_id,normalized_name").execute()
ids = {r["normalized_name"]: r["id"] for r in
       db.table("teams").select("id,normalized_name").eq("league_id", league).execute().data}
strength = {n: rng.gauss(0, 0.45) for n in names}

def pairings():
    t = names[:]; rng.shuffle(t); return [(t[i], t[i + 1]) for i in range(0, len(t), 2)]

def poisson(lam):
    import math; L, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= L: return k
        k += 1

today = datetime.now(timezone.utc).replace(hour=15, minute=0, second=0, microsecond=0)
rows, ROUNDS_PAST, ROUNDS_FUTURE = [], 52, 2
for rnd in range(-ROUNDS_PAST, ROUNDS_FUTURE):
    when = today + timedelta(days=7 * rnd + 3)      # weekly; past rounds finished, future ones scheduled
    for h, a in pairings():
        row = {"league_id": league, "match_date": when.isoformat(), "home_team_id": ids[h],
               "away_team_id": ids[a], "home_goals": None, "away_goals": None, "status": "scheduled"}
        if when < today:
            row.update(status="finished", home_goals=poisson(2.718 ** (0.25 + strength[h] - 0.5 * strength[a])),
                       away_goals=poisson(2.718 ** (strength[a] - 0.5 * strength[h])))
        rows.append(row)
for i in range(0, len(rows), 200):
    db.table("matches").upsert(rows[i:i + 200], on_conflict="league_id,match_date,home_team_id,away_team_id").execute()
print(f"seeded league {league}: {len(names)} teams, {len(rows)} matches "
      f"({sum(r['status']=='finished' for r in rows)} finished, {sum(r['status']=='scheduled' for r in rows)} scheduled)")
