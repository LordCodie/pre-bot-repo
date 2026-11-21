"""Supabase access: idempotent upserts keyed on the schema's unique constraints."""
import logging
from datetime import datetime, timedelta, timezone
from supabase import create_client

import config

log = logging.getLogger("scraper.db")
CHUNK = 200


def _chunks(rows, n=CHUNK):
    for i in range(0, len(rows), n):
        yield rows[i:i + n]


def _dt(s: str) -> datetime:
    return datetime.fromisoformat(s)


class Database:
    def __init__(self):
        config.validate_env()
        self.client = create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY)

    def upsert_league(self, name: str, country: str, source_url: str) -> int:
        res = (self.client.table("leagues")
               .upsert({"name": name, "country": country, "source_url": source_url},
                       on_conflict="source_url").execute())
        return res.data[0]["id"]

    def upsert_teams(self, league_id: int, teams: dict[str, str]) -> dict[str, int]:
        """teams: normalized_name -> original name. Returns normalized_name -> id."""
        if not teams:
            return {}
        rows = [{"league_id": league_id, "name": raw, "normalized_name": norm}
                for norm, raw in teams.items()]
        self.client.table("teams").upsert(rows, on_conflict="league_id,normalized_name").execute()
        res = (self.client.table("teams").select("id,normalized_name")
               .eq("league_id", league_id).execute())
        return {r["normalized_name"]: r["id"] for r in res.data}

    def _existing_matches(self, league_id: int, rows: list[dict]) -> dict:
        lo = min(_dt(r["match_date"]) for r in rows) - timedelta(days=2)
        hi = max(_dt(r["match_date"]) for r in rows) + timedelta(days=2)
        res = (self.client.table("matches").select("id,match_date,home_team_id,away_team_id")
               .eq("league_id", league_id).gte("match_date", lo.isoformat())
               .lte("match_date", hi.isoformat()).execute())
        idx: dict = {}
        for r in res.data:
            idx.setdefault((r["home_team_id"], r["away_team_id"]), []).append(r)
        return idx

    def upsert_matches(self, league_id: int, rows: list[dict]) -> int:
        """Rows carry team ids + `kickoff_known`. Re-aligns with an existing row for the same pairing
        (+-1 day) so a scheduled match that finishes, or whose kickoff changes, is updated rather
        than duplicated."""
        if not rows:
            return 0
        existing = self._existing_matches(league_id, rows)
        final = []
        for r in rows:
            r = dict(r); known = r.pop("kickoff_known")
            for ex in existing.get((r["home_team_id"], r["away_team_id"]), []):
                if abs(_dt(ex["match_date"]) - _dt(r["match_date"])) <= timedelta(days=1) \
                        and _dt(ex["match_date"]) != _dt(r["match_date"]):
                    if known:   # kickoff moved: shift the existing row to the new timestamp
                        self.client.table("matches").update(
                            {"match_date": r["match_date"]}).eq("id", ex["id"]).execute()
                    else:       # no kickoff info: keep the existing timestamp
                        r["match_date"] = ex["match_date"]
                    break
            final.append(r)
        total = 0
        for chunk in _chunks(final):
            res = (self.client.table("matches")
                   .upsert(chunk, on_conflict="league_id,match_date,home_team_id,away_team_id").execute())
            total += len(res.data)
        return total

    def upsert_team_stats(self, rows: list[dict]) -> int:
        total = 0
        for chunk in _chunks(rows):
            res = self.client.table("team_stats").upsert(chunk, on_conflict="team_id,as_of_date").execute()
            total += len(res.data)
        return total

    def log_scrape(self, league_id, source_url, status, rows_upserted, error_message):
        try:
            self.client.table("scrape_logs").insert({
                "league_id": league_id, "source_url": source_url, "status": status,
                "rows_upserted": rows_upserted,
                "error_message": (error_message or None) and error_message[:2000],
                "ran_at": datetime.now(timezone.utc).isoformat()}).execute()
        except Exception:
            log.exception("Could not write scrape_logs")
