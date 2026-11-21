"""Cleaning, name mapping, type conversion and validation."""
import json
import os
import re
import unicodedata
from datetime import datetime, date, time, timezone
from zoneinfo import ZoneInfo

import config

_aliases = {k.lower(): v for k, v in config.TEAM_ALIASES.items()}
if os.path.exists(config.TEAM_ALIASES_FILE):
    with open(config.TEAM_ALIASES_FILE, encoding="utf-8") as f:
        _aliases.update({k.lower(): v for k, v in json.load(f).items()})


def clean_text(s) -> str:
    if s is None:
        return ""
    s = unicodedata.normalize("NFKC", str(s)).replace("\xa0", " ")
    s = re.sub(r"[\x00-\x1f\x7f]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def normalize_team(name: str) -> str:
    n = clean_text(name)
    return _aliases.get(n.lower(), n)


def to_int(v):
    s = clean_text(v).replace("+", "")
    return int(s) if re.fullmatch(r"-?\d+", s) else None


def to_float(v):
    s = clean_text(v).replace("%", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def build_match_date(d: date, kickoff: str | None) -> tuple[str, bool]:
    """Return (ISO timestamp in UTC, kickoff_known). Missing kickoff -> 00:00 in source tz."""
    tz = ZoneInfo(config.SOURCE_TIMEZONE)
    known = bool(kickoff and re.fullmatch(r"\d{1,2}:\d{2}", kickoff))
    t = time(*map(int, kickoff.split(":"))) if known else time(0, 0)
    return datetime.combine(d, t, tzinfo=tz).astimezone(timezone.utc).isoformat(), known


def normalize_match(raw: dict) -> dict | None:
    """Validate a parsed match; return a DB-ready dict with team *names* (ids resolved later)."""
    home, away = normalize_team(raw.get("home_team")), normalize_team(raw.get("away_team"))
    if not home or not away or home == away or not isinstance(raw.get("match_date"), date):
        return None
    status = raw.get("status")
    hg, ag = raw.get("home_goals"), raw.get("away_goals")
    if status == "finished":
        if hg is None or ag is None or not (0 <= hg <= 30 and 0 <= ag <= 30):
            return None
    elif status == "scheduled":
        hg = ag = None
    else:
        return None
    md, known = build_match_date(raw["match_date"], raw.get("kickoff_time"))
    return {"home": home, "away": away, "home_raw": clean_text(raw["home_team"]),
            "away_raw": clean_text(raw["away_team"]), "match_date": md, "kickoff_known": known,
            "home_goals": hg, "away_goals": ag, "status": status}


def normalize_standing(raw: dict) -> dict | None:
    name = normalize_team(raw.get("team"))
    if not name:
        return None
    out = {"team": name, "team_raw": clean_text(raw["team"])}
    for k in ("gp", "w", "d", "l", "gf", "ga", "gd", "pts"):
        out[k] = to_int(raw.get(k))
    for k in ("ppg", "cs", "sr"):
        out[k] = to_float(raw.get(k))
    form = re.sub(r"[^WDLwdl]", "", clean_text(raw.get("form")))[-5:].upper()
    out["form"] = form or None
    if out["gp"] is None:
        return None
    return out
