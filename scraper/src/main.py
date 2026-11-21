"""Scraping orchestration.  python src/main.py [--leagues england,spain] [--dry-run]
                                              [--offline tests/fixtures]"""
import argparse
import logging
import sys
from datetime import date
from pathlib import Path

import config
from normalizer import normalize_match, normalize_standing
from parsers.fixtures import parse_matches
from parsers.standings import parse_standings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("scraper")


class Fetcher:
    """Live (Playwright) or offline (saved HTML named {slug}_{kind}.html) page source."""
    def __init__(self, browser=None, offline_dir=None):
        self.browser, self.offline_dir = browser, offline_dir

    def get(self, slug: str, kind: str) -> str:
        if self.offline_dir:
            return (Path(self.offline_dir) / f"{slug}_{kind}.html").read_text(encoding="utf-8")
        return self.browser.get_html(config.PAGE_URLS[kind].format(slug=slug))


def scrape_matches(fetcher, slug, today, errors):
    raw = []
    kinds = ["latest"] + (["results"] if config.SCRAPE_RESULTS_PAGE else [])
    for kind in kinds:
        try:
            raw += parse_matches(fetcher.get(slug, kind), today)
        except Exception as e:                       # one page failing must not stop the league
            errors.append(f"{kind} page: {e}")
    seen, out = set(), []
    for r in raw:
        m = normalize_match(r)
        if m is None:
            continue
        key = (m["home"], m["away"], m["match_date"])
        if key not in seen:
            seen.add(key); out.append(m)
    return raw, out


def scrape_stats(fetcher, slug, errors):
    """Merge overall + home + away tables into one snapshot per team."""
    merged: dict[str, dict] = {}
    for scope in ("overall", "home", "away"):
        try:
            for raw in parse_standings(fetcher.get(slug, scope)):
                s = normalize_standing(raw)
                if not s:
                    continue
                m = merged.setdefault(s["team"], {"raw": s["team_raw"]})
                if scope == "overall":
                    m.update({"gp": s["gp"], "w": s["w"], "d": s["d"], "l": s["l"], "gf": s["gf"],
                              "ga": s["ga"], "pts": s["pts"], "ppg": s["ppg"], "cs": s["cs"],
                              "sr": s["sr"], "form": s["form"]})
                else:
                    m[f"{scope}_ppg"] = s["ppg"]
        except Exception as e:
            errors.append(f"{scope} table: {e}")
    return merged


def run_league(db, fetcher, league, today, dry_run):
    slug, url = league["slug"], config.league_source_url(league["slug"])
    errors: list[str] = []
    raw, matches = scrape_matches(fetcher, slug, today, errors)
    stats = scrape_stats(fetcher, slug, errors)
    log.info("[%s] parsed %d raw rows -> %d valid matches, %d team stat rows",
             slug, len(raw), len(matches), len(stats))
    if dry_run:
        for m in matches[:10]: print(m)
        for t, s in list(stats.items())[:5]: print(t, s)
        return
    league_id, upserted = None, 0
    try:
        league_id = db.upsert_league(league["name"], league["country"], url)
        names = {m["home"]: m["home_raw"] for m in matches} | {m["away"]: m["away_raw"] for m in matches}
        names |= {t: s["raw"] for t, s in stats.items()}
        team_ids = db.upsert_teams(league_id, names)
        rows = [{"league_id": league_id, "match_date": m["match_date"],
                 "home_team_id": team_ids[m["home"]], "away_team_id": team_ids[m["away"]],
                 "home_goals": m["home_goals"], "away_goals": m["away_goals"],
                 "status": m["status"], "kickoff_known": m["kickoff_known"]} for m in matches]
        upserted += db.upsert_matches(league_id, rows)
        stat_rows = [{"team_id": team_ids[t], "as_of_date": today.isoformat(),
                      "games_played": s.get("gp"), "wins": s.get("w"), "draws": s.get("d"),
                      "losses": s.get("l"), "goals_for": s.get("gf"), "goals_against": s.get("ga"),
                      "home_ppg": s.get("home_ppg"), "away_ppg": s.get("away_ppg"),
                      "form_last5": s.get("form"), "points": s.get("pts"), "ppg": s.get("ppg"),
                      "clean_sheets": s.get("cs"), "scoring_rate": s.get("sr")}
                     for t, s in stats.items() if t in team_ids]
        upserted += db.upsert_team_stats(stat_rows)
    except Exception as e:
        log.exception("[%s] database stage failed", slug)
        errors.append(f"database: {e}")
    if not errors:
        status = "success"
    else:
        status = "partial" if upserted > 0 else "failed"
    db.log_scrape(league_id, url, status, upserted, "; ".join(errors))
    log.info("[%s] %s, upserted=%d errors=%d", slug, status, upserted, len(errors))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--leagues", help="comma-separated slugs (default: all configured)")
    ap.add_argument("--dry-run", action="store_true", help="parse and print; no DB writes")
    ap.add_argument("--offline", metavar="DIR", help="read saved HTML fixtures instead of the web")
    args = ap.parse_args()

    leagues = [l for l in config.LEAGUES
               if not args.leagues or l["slug"] in args.leagues.split(",")]
    db = None
    if not args.dry_run:
        from db import Database
        db = Database()          # validates env, incl. test-mode local-DB guard
    today = date.today()

    def go(fetcher):
        for league in leagues:
            try:
                run_league(db, fetcher, league, today, args.dry_run)
            except Exception:
                log.exception("[%s] failed", league["slug"])

    if args.offline:
        go(Fetcher(offline_dir=args.offline))
    else:
        from browser import Browser
        with Browser() as b:
            go(Fetcher(browser=b))
    return 0


if __name__ == "__main__":
    sys.exit(main())
