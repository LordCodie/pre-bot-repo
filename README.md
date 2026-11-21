# Football Match Prediction Platform (backend components; frontend not included)

| Folder | What | Run |
|---|---|---|
| `supabase/migrations/` | Schema, indexes, triggers, views, RLS (per db spec) | `supabase db reset` (local) or paste into SQL editor |
| `scraper/` | Playwright scraper → Supabase | `pip install -r requirements.txt && playwright install chromium && python src/main.py` |
| `ml_service/` | Features, training, FastAPI | `python -m training.train` then `uvicorn app.main:app --port 8000` |
| `backend/` | Express API gateway | `npm install && npm start` |
| `scripts/` + `.env.test.example` | Local isolated test environment | `scripts/run_e2e.sh` |

Production: copy each `.env.example` to `.env`. Tests: `cp .env.test.example .env.test` (local Supabase only; every service refuses non-local URLs when `APP_ENV=test`).

## Before first live scrape (important)
The SoccerStats URL templates (`scraper/src/config.py → PAGE_URLS`) and HTML parsers were written without access to the live site and are only unit-tested on **synthetic** fixtures. Do dev-step 1 first:
`python src/inspect_page.py england latest --save tests/fixtures/england_latest.html`, check the parsers against the real HTML, adjust, then run `python src/main.py --dry-run --leagues england`. Also confirm `SOURCE_TIMEZONE` for kickoff times.

## Order of operations
schema → scraper (`--dry-run`, then live, then run twice to confirm no duplicates) → `python -m training.leakage_check` → `python -m training.train` → FastAPI → Express.
Schedule the scraper with cron/GitHub Actions (e.g. `0 6,12,18 * * * cd scraper && python src/main.py`); retrain with `POST /api/admin/retrain`.
