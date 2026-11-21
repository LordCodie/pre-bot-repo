"""Parse fixtures & results from a SoccerStats league page.

Layout-tolerant heuristic: scan table rows for a score cell ("2 - 1") or a kickoff-time cell
("17:30"); teams are the nearest text cells either side. Dates come from the row or from the
closest preceding date row. If the site's layout differs, adjust here only; verify with
`inspect_page.py` and the saved fixtures in tests/fixtures/.
"""
import re
from datetime import date, timedelta
from bs4 import BeautifulSoup

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
DATE_RE = re.compile(r"(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*", re.I)
SCORE_RE = re.compile(r"^(\d{1,2})\s*-\s*(\d{1,2})$")
TIME_RE = re.compile(r"^(\d{1,2}:\d{2})$")


def _txt(el) -> str:
    return " ".join(el.get_text(" ", strip=True).split())


def infer_date(day: int, month: int, today: date, finished: bool) -> date | None:
    """Pages omit the year: pick the year that places the date plausibly vs. today."""
    try:
        d = date(today.year, month, day)
    except ValueError:
        return None
    if finished and d > today + timedelta(days=1):
        d = date(today.year - 1, month, day)
    elif not finished and d < today - timedelta(days=45):
        d = date(today.year + 1, month, day)
    return d


def parse_matches(html: str, today: date | None = None) -> list[dict]:
    today = today or date.today()
    soup = BeautifulSoup(html, "lxml")
    out, seen, current = [], set(), None  # current = (day, month)
    for tr in soup.find_all("tr"):
        cells = [_txt(td) for td in tr.find_all("td", recursive=False)]
        cells = [c for c in cells if c]
        if not cells:
            continue
        marker = next((i for i, c in enumerate(cells)
                       if SCORE_RE.match(c) or TIME_RE.match(c)), None)
        row_date = next((DATE_RE.search(c) for c in cells if len(c) <= 20 and DATE_RE.search(c)), None)
        if row_date:
            current = (int(row_date.group(1)), MONTHS[row_date.group(2).lower()[:3]])
        if marker is None:
            continue
        before = [c for c in cells[:marker] if re.search(r"[A-Za-z]", c) and not DATE_RE.fullmatch(c)
                  and len(c) <= 40]
        after = [c for c in cells[marker + 1:] if re.search(r"[A-Za-z]", c) and len(c) <= 40]
        if not before or not after or current is None:
            continue
        sm = SCORE_RE.match(cells[marker])
        finished = bool(sm)
        d = infer_date(current[0], current[1], today, finished)
        if d is None:
            continue
        rec = {"home_team": before[-1], "away_team": after[0], "match_date": d,
               "status": "finished" if finished else "scheduled",
               "kickoff_time": None if finished else cells[marker],
               "home_goals": int(sm.group(1)) if sm else None,
               "away_goals": int(sm.group(2)) if sm else None}
        key = (rec["home_team"], rec["away_team"], d)
        if key not in seen:
            seen.add(key); out.append(rec)
    return out
