"""Parse a league table (overall / home / away) into raw stat dicts.
Header-driven: columns are located by header text, so column order changes don't break it."""
from bs4 import BeautifulSoup

HEADER_MAP = {"GP": "gp", "W": "w", "D": "d", "L": "l", "GF": "gf", "GA": "ga", "GD": "gd",
              "PTS": "pts", "PPG": "ppg", "CS": "cs", "SR": "sr", "FORM": "form", "LAST 8": "form",
              "LAST 5": "form", "TEAM": "team"}
REQUIRED = {"GP", "W", "D", "L", "GF", "GA", "PTS"}


def _txt(el) -> str:
    return " ".join(el.get_text(" ", strip=True).split())


def parse_standings(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        for hi, hr in enumerate(rows):
            heads = [_txt(c).upper() for c in hr.find_all(["th", "td"], recursive=False)]
            if REQUIRED.issubset(set(heads)):
                return _read_rows(rows[hi + 1:], heads)
    return []


def _read_rows(rows, heads) -> list[dict]:
    idx = {HEADER_MAP[h]: i for i, h in enumerate(heads) if h in HEADER_MAP}
    out = []
    for tr in rows:
        cells = [_txt(c) for c in tr.find_all("td", recursive=False)]
        if len(cells) < len(heads) - 2 or "gp" not in idx or idx["gp"] >= len(cells):
            continue
        if "team" in idx and idx["team"] < len(cells):
            team = cells[idx["team"]]
        else:  # fall back to first alphabetic cell
            team = next((c for c in cells if any(ch.isalpha() for ch in c)), "")
        rec = {"team": team}
        for key, i in idx.items():
            if key != "team" and i < len(cells):
                rec[key] = cells[i]
        if rec.get("gp", "").isdigit():
            out.append(rec)
    return out
