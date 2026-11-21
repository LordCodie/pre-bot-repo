import sys
from datetime import date
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import os; os.environ.setdefault("TEAM_ALIASES_FILE", "none.json")
from parsers.fixtures import parse_matches
from parsers.standings import parse_standings
from normalizer import normalize_match, normalize_standing, normalize_team

FX = Path(__file__).parent / "fixtures"
TODAY = date(2026, 11, 21)


def test_matches():
    ms = parse_matches((FX / "synthetic_fixtures.html").read_text(), TODAY)
    assert len(ms) == 3
    assert ms[0]["status"] == "finished" and (ms[0]["home_goals"], ms[0]["away_goals"]) == (2, 1)
    assert ms[2]["status"] == "scheduled" and ms[2]["kickoff_time"] == "17:30"
    assert ms[2]["match_date"] == date(2026, 11, 29)


def test_normalize_match_rejects_bad():
    base = {"home_team": "A", "away_team": "A", "match_date": TODAY, "status": "scheduled"}
    assert normalize_match(base) is None  # same team
    assert normalize_match({**base, "away_team": "B", "status": "finished"}) is None  # no score


def test_standings():
    rows = parse_standings((FX / "synthetic_standings.html").read_text())
    s = normalize_standing(rows[0])
    assert (s["team"], s["gp"], s["gd"], s["ppg"]) == ("Test Utd", 10, 12, 2.3)


def test_alias():
    assert normalize_team("Man Utd") == "Manchester United"
