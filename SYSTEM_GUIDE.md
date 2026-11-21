# Football Match Prediction Platform — Complete System Guide

How the system fits together, how to run and test **each part on its own**, how to **connect them all**, and what to do when something breaks.

> **Read this first — four things that will bite you** (all found by inspecting your repo and running the pieces):
>
> 1. **The frontend runs on port `8080`, not `5173`.** The Lovable Vite config forces 8080. The backend only accepts browser requests from origins listed in `CORS_ORIGINS`, and `.env.test.example` lists `5173`. If you don't change it, every browser request is rejected with `403 cors_forbidden`. Use `CORS_ORIGINS=http://localhost:8080,http://127.0.0.1:8080`.
> 2. **`frontend/vitest.config.ts` points at a file that doesn't exist.** It says `./src/test/setup.ts` but the file is `src/tests/setup.ts` (plural). Change that one line or `npm test` fails. (After the fix, the existing test passes.)
> 3. **Plain `npm install` fails in `frontend/`** (`Cannot read properties of null (reading 'edgesOut')`). Use `npm install --legacy-peer-deps` (verified working), or use `bun install` since the project ships a `bun.lock`.
> 4. **`supabase init` must be run once** before `supabase start` / `supabase db reset`. The repo has migrations but no `supabase/config.toml`. `scripts/run_e2e.sh` hides the `supabase start` error and then fails at `db reset` if you skip this.
>
> Also: the SoccerStats **URLs and HTML parsers have never been run against the live site** (see [§13](#13-known-limitations--whats-verified)). Expect to adjust them.

---

## Table of contents

1. [What the system is](#1-what-the-system-is)
2. [Prerequisites](#2-prerequisites)
3. [Repository layout](#3-repository-layout)
4. [Configuration & environment variables](#4-configuration--environment-variables)
5. [Step 0 — The database (Supabase)](#5-step-0--the-database-supabase)
6. [Running each component on its own](#6-running-each-component-on-its-own)
7. [Connecting everything together](#7-connecting-everything-together)
8. [Full manual run (copy-paste sequence)](#8-full-manual-run-copy-paste-sequence)
9. [The automated end-to-end script](#9-the-automated-end-to-end-script)
10. [What you should see in the UI](#10-what-you-should-see-in-the-ui)
11. [Day-to-day operations](#11-day-to-day-operations)
12. [Troubleshooting](#12-troubleshooting)
13. [Known limitations & what's verified](#13-known-limitations--whats-verified)
14. [API quick reference](#14-api-quick-reference)
15. [Security notes](#15-security-notes)

---

## 1. What the system is

A football (soccer) match prediction platform. Data is scraped from SoccerStats, stored in a database, used to train ML models, and shown in a web UI as **home win / draw / away win probabilities**.

### The five parts

| Part | Folder | Tech | Default port | Job |
|---|---|---|---|---|
| **Database** | `supabase/` | Supabase (PostgreSQL) | API `54321`, DB `54322`, Studio `54323` (local) | Single shared store: leagues, teams, matches, team stats, predictions, scrape logs |
| **Scraper** | `scraper/` | Python + Playwright | none (a script, not a server) | Visits SoccerStats, extracts fixtures/results/standings, cleans them, **writes to the DB** |
| **ML service** | `ml_service/` | Python + FastAPI + scikit-learn/XGBoost/LightGBM | `8000` | Builds features from stored matches, trains models, **writes predictions to the DB**, serves `/predict` |
| **Backend API** | `backend/` | Node.js + Express | `5000` | The *only* thing the frontend talks to. Reads the DB, calls the ML service, enforces validation/CORS/rate limits |
| **Frontend** | `frontend/` | React (TanStack Start + Vite), built with Lovable | `8080` | The UI: fixtures, results, accuracy |

### How data flows

```
                       ┌──────────────────────────────┐
   soccerstats.com ───▶│  SCRAPER  (python, on demand │
                       │  or scheduled)               │
                       └──────────────┬───────────────┘
                                      │ writes leagues / teams / matches /
                                      │ team_stats / scrape_logs
                                      ▼
                       ┌──────────────────────────────┐
                       │   SUPABASE (PostgreSQL)      │◀──────────────┐
                       └───────┬──────────────┬───────┘               │
          reads matches        │              │ reads all tables      │ writes predictions
          (training/inference) │              │ (+ writes predictions │ (batch after training)
                               ▼              │  on refresh / live)   │
                       ┌───────────────┐      │                       │
                       │  ML SERVICE   │◀─────┼───── HTTP ────┐       │
                       │  FastAPI :8000│      │ /predict      │       │
                       └───────────────┘      ▼               │       │
                                       ┌───────────────┐      │       │
                                       │ BACKEND       │──────┘       │
                                       │ Express :5000 │──────────────┘
                                       └──────┬────────┘
                                              │ HTTP /api/*  (JSON, CORS-checked)
                                              ▼
                                       ┌───────────────┐
                                       │ FRONTEND      │  ← your browser
                                       │ :8080         │
                                       └───────────────┘
```

### Who connects to whom (the "wiring")

| From | To | How | Config that controls it |
|---|---|---|---|
| Scraper | Supabase | Supabase Python client, service-role key | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| ML service | Supabase | same | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| Backend | Supabase | `@supabase/supabase-js`, service-role key | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| Backend | ML service | HTTP `fetch` to `/predict`, `/predict/batch`, `/health`, `/retrain` | `ML_SERVICE_URL`, `ML_TIMEOUT_MS`, `ML_ADMIN_KEY` |
| Frontend | Backend | browser `fetch` to `/api/...` | `VITE_API_URL` (frontend) + `CORS_ORIGINS` (backend) |
| Frontend | Supabase | **never** (by design) | — |

**Key idea:** the services never call the scraper. The scraper and ML training are *batch jobs* that fill the database; the backend and ML API are *servers* that read it.

### Match lifecycle (useful for understanding the data)

1. Scraper saves an upcoming fixture as `status = 'scheduled'`.
2. ML training/batch step predicts every scheduled match → rows in `predictions` (one per match per model version; older versions are kept).
3. After the game, the next scrape flips it to `status = 'finished'` with goals (a DB trigger stops a stale page from flipping it back).
4. The **accuracy** figures compare finished results against predictions that were stored **before kickoff**. Predictions created after the fact are deliberately not counted.

---

## 2. Prerequisites

| Tool | Version | Needed for | Check |
|---|---|---|---|
| Node.js | **22** recommended (≥ 20.19; backend alone needs ≥ 18) | backend, frontend | `node --version` |
| npm | comes with Node | backend, frontend | `npm --version` |
| Python | **3.11+** | scraper, ML service, seed script | `python3 --version` (Windows: `py --version`) |
| Docker Desktop (or Podman) | recent, **running** | local Supabase | `docker ps` |
| Supabase CLI | recent | local Supabase | `supabase --version` |
| curl | any | trying the APIs | `curl --version` |
| (optional) bun | recent | alternative frontend installer | `bun --version` |

Installing the Supabase CLI: macOS `brew install supabase/tap/supabase`; Windows `scoop install supabase` (after adding the Supabase scoop bucket); or skip installing and prefix every command with `npx` (e.g. `npx supabase start`).

> **Windows users:** easiest path is **WSL2** (Ubuntu) — all bash commands and `scripts/run_e2e.sh` then work as written. Native PowerShell equivalents are given where they differ.

No Docker? Use a hosted Supabase project instead — see [§5, Path B](#path-b--hosted-supabase-project-no-docker).

---

## 3. Repository layout

```
pre-bot-repo/
├── README.md                    short overview (older; this guide supersedes it)
├── .env.test.example            template for the shared TEST environment file
├── supabase/migrations/         the database schema (SQL)
├── scraper/
│   ├── src/
│   │   ├── main.py              entry point: python src/main.py
│   │   ├── config.py            URLs, leagues, delays, env loading, test-mode guard
│   │   ├── browser.py           Playwright wrapper (polite delays, retries)
│   │   ├── parsers/fixtures.py  matches + results parser
│   │   ├── parsers/standings.py league table parser (overall/home/away)
│   │   ├── normalizer.py        cleaning, team-name aliases, validation
│   │   ├── db.py                idempotent upserts into Supabase
│   │   └── inspect_page.py      dev tool: save/inspect a live page
│   ├── tests/                   parser unit tests + SYNTHETIC html fixtures
│   ├── team_aliases.json        extra team-name mappings (optional)
│   └── requirements*.txt
├── ml_service/
│   ├── app/                     FastAPI service (main.py, predictor.py, schemas.py)
│   ├── training/                dataset.py (features), train.py, batch_predict.py, leakage_check.py
│   ├── artifacts/               saved models land here (gitignored)
│   └── requirements.txt
├── backend/
│   ├── server.js                entry point
│   └── src/                     config/, routes/, controllers/, services/, middleware/
├── frontend/
│   └── src/                     routes/ (index, results, accuracy), api/ (client, endpoints, types, queries), components/
└── scripts/
    ├── seed_test_data.py        fills the LOCAL test DB with SYNTHETIC data
    ├── e2e_check.py             checks the running ML + backend APIs
    └── run_e2e.sh               runs the whole test sequence
```

---

## 4. Configuration & environment variables

### 4.1 The two modes

| | **Test mode** (what you want while developing) | **Production-like** |
|---|---|---|
| `APP_ENV` | `test` | unset or anything else |
| Database | local Supabase (Docker) | hosted Supabase |
| Safety | every service **refuses to start** if `SUPABASE_URL` (or `ML_SERVICE_URL` for the backend) isn't `localhost` / `127.0.0.1` / `host.docker.internal` | no guard |
| Seed script | allowed | **refuses** |
| Model file | `artifacts/model_test.joblib` | `artifacts/model.joblib` |

The guard exists so you can never accidentally write test data into your real database.

### 4.2 One shared env file for the whole test stack

Create **`.env.test` in the repo root** (copy from `.env.test.example`) and use this content:

```bash
# ───── .env.test (repo root, gitignored) ─────
APP_ENV=test
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_KEY=PASTE_service_role_key_FROM_supabase_status

# ML service
MODEL_PATH=artifacts/model_test.joblib
ML_ADMIN_KEY=test-ml-admin
MIN_TRAIN_ROWS=300

# Backend
PORT=5000
ML_SERVICE_URL=http://localhost:8000
ML_TIMEOUT_MS=8000
CORS_ORIGINS=http://localhost:8080,http://127.0.0.1:8080     # <-- NOTE 8080 (frontend port), not 5173
ADMIN_API_KEY=test-admin

# Scraper
HEADLESS=true
MIN_DELAY=2
MAX_DELAY=5
SOURCE_TIMEZONE=UTC
```

Every Python/Node component reads the file named by the **`ENV_FILE`** environment variable (default is `.env` in the component's own folder). Point `ENV_FILE` at the shared file using an **absolute path** so it works from any folder.

```bash
# macOS / Linux / WSL — run once in EACH terminal, from the repo root
export ENV_FILE="$(pwd)/.env.test"
```
```powershell
# Windows PowerShell — run once in EACH terminal, from the repo root
$env:ENV_FILE = "$PWD\.env.test"
```

The **frontend** is separate (Vite doesn't use `ENV_FILE`): create `frontend/.env.local`:

```bash
VITE_API_URL=http://localhost:5000
```
Restart the frontend dev server after changing it (Vite reads it at startup).

### 4.3 Variable reference

| Variable | Used by | Meaning |
|---|---|---|
| `APP_ENV` | all | `test` turns on the local-only guard |
| `ENV_FILE` | scraper, ML, backend, seed | which env file to load (absolute path recommended) |
| `SUPABASE_URL` | scraper, ML, backend, seed | Supabase API URL |
| `SUPABASE_SERVICE_KEY` | scraper, ML, backend, seed | service-role key. **Server-side only — never in the frontend** |
| `MODEL_PATH` | ML | where the active model file is saved/loaded (a `.json` metadata file and a versioned `<version>.joblib` copy are written next to it) |
| `MIN_TRAIN_ROWS` | ML | refuse to train with fewer usable finished matches (default 300) |
| `ML_ADMIN_KEY` | ML **and** backend | shared secret for `POST /retrain`. Must be identical in both |
| `ML_SERVICE_URL` | backend (and `e2e_check.py`) | where FastAPI lives |
| `ML_TIMEOUT_MS` | backend | give up on the ML service after this long (default 8000) |
| `PORT` | backend | Express port (default 5000) |
| `CORS_ORIGINS` | backend | comma-separated browser origins allowed to call the API. Must exactly match what's in the browser address bar (`localhost` ≠ `127.0.0.1`) |
| `ADMIN_API_KEY` | backend | secret for `POST /api/predictions/refresh` and `POST /api/admin/retrain` (sent as header `x-api-key`) |
| `RATE_LIMIT_PER_MIN` | backend | per-IP request cap (default 120) |
| `HEADLESS` | scraper | `false` = watch the browser window |
| `MIN_DELAY` / `MAX_DELAY` | scraper | polite random pause (seconds) between page loads |
| `SOURCE_TIMEZONE` | scraper | timezone of kickoff times shown on SoccerStats (**verify**; default UTC) |
| `SCRAPE_RESULTS_PAGE` | scraper | also scrape the full results page (default true) |
| `VITE_API_URL` | frontend | backend base URL |

---

## 5. Step 0 — The database (Supabase)

Everything else depends on the database, so do this first.

### Path A — Local Supabase with Docker (recommended)

```bash
# from the repo root; Docker must be running
supabase init          # ONCE. Creates supabase/config.toml. Answer "N" to editor-settings prompts.
supabase start         # first run downloads images (a few minutes). Leaves the stack running.
supabase status        # prints URLs and keys
```

From `supabase status` copy:

- **API URL** (`http://127.0.0.1:54321`) → `SUPABASE_URL`
- **service_role key** (newer CLI versions label it "Secret key") → `SUPABASE_SERVICE_KEY`. Tip: `supabase status -o env` prints them as `KEY=value` lines.
- **Studio URL** (`http://127.0.0.1:54323`) — a web UI to browse tables and run SQL.

Create the tables:

```bash
supabase db reset      # wipes the LOCAL database and applies supabase/migrations/*.sql
```

Verify in Studio → Table Editor: `leagues`, `teams`, `matches`, `team_stats`, `predictions`, `scrape_logs` should exist (and Database → Views should show four `v_…` views).

Other commands: `supabase stop` (shut down), `supabase db reset` (wipe + re-apply any time).

### Path B — Hosted Supabase project (no Docker)

1. Create a **new, separate, free** project at supabase.com (never your real/production one).
2. SQL Editor → paste the contents of `supabase/migrations/20261121000000_init_schema.sql` → Run.
3. Project Settings → API: copy the **Project URL** and the **service_role** (legacy) or **secret** key. If a new-format key gives authentication errors in the Python client, use the legacy `service_role` JWT key.
4. Put them in your env file and **do not set `APP_ENV=test`** (the guard would refuse a non-local URL). Consequently the synthetic seed script is also unavailable — your data will come from the scraper only.

> The schema SQL has not been executed by me against a real Postgres — if `supabase db reset` reports an error, send me the message.

---

## 6. Running each component on its own

Each component can be tested without the others, in the order below. **Always run commands from inside the component's folder** unless stated otherwise (the Python code looks for `.env`, `team_aliases.json` and `artifacts/` relative to the current directory).

### Python environment (scraper + ML + seed script)

One shared virtual environment at the repo root is simplest:

```bash
# repo root
python3 -m venv .venv
source .venv/bin/activate                  # Windows PowerShell: .\.venv\Scripts\Activate.ps1
pip install -r scraper/requirements.txt -r scraper/requirements-dev.txt -r ml_service/requirements.txt
playwright install chromium                # downloads the browser the scraper drives
```
On bare Linux you may also need `playwright install-deps`. Keep the venv **activated** in every Python terminal (the scripts call `python`).

---

### 6.1 Scraper (`scraper/`)

**What it does:** loads 5 league pages (England, Spain, Italy, Germany, France — configurable in `src/config.py`), parses fixtures, results and league tables, normalizes names/dates, upserts into Supabase, writes a row per league into `scrape_logs`. Re-running never creates duplicates.

**Needs:** nothing for tests/dry-run; Supabase + keys for real runs.

#### (a) Unit tests — no network, no DB
```bash
cd scraper
python -m pytest -q tests
# expect: 4 passed
```
These run on **synthetic** HTML (invented teams) — they prove the code works, not that it matches the real site.

#### (b) Offline dry-run — parse saved HTML, print, write nothing
Offline mode wants files named `{league}_{kind}.html` where kind ∈ `latest, results, overall, home, away`. Make them from the sample fixtures:

```bash
# macOS / Linux / WSL
mkdir -p /tmp/fx && for k in latest results; do cp tests/fixtures/synthetic_fixtures.html /tmp/fx/england_$k.html; done
for k in overall home away; do cp tests/fixtures/synthetic_standings.html /tmp/fx/england_$k.html; done
python src/main.py --dry-run --offline /tmp/fx --leagues england
```
```powershell
# Windows PowerShell
mkdir $env:TEMP\fx -Force | Out-Null
"latest","results" | % { Copy-Item tests\fixtures\synthetic_fixtures.html "$env:TEMP\fx\england_$_.html" }
"overall","home","away" | % { Copy-Item tests\fixtures\synthetic_standings.html "$env:TEMP\fx\england_$_.html" }
python src\main.py --dry-run --offline $env:TEMP\fx --leagues england
```
Expected output (verified): `parsed 6 raw rows -> 3 valid matches, 2 team stat rows`, followed by the parsed matches (two `finished` with scores, one `scheduled` with `kickoff 17:30`) and two team-stat dictionaries.

#### (c) Inspect the REAL site — **do this before trusting any live run**
```bash
python src/inspect_page.py england latest --save tests/fixtures/england_latest.html
```
This opens the real page headlessly, prints a summary of every `<table>`, and saves the HTML. Repeat for `results`, `overall`, `home`, `away` (saving each as `england_<kind>.html`). Then:

```bash
python src/main.py --dry-run --offline tests/fixtures --leagues england
```
If it prints `parsed 0 raw rows` or garbage, the URL templates in `src/config.py → PAGE_URLS` and/or the parsers in `src/parsers/` need adjusting to the real HTML. This is the most likely place to need work. Set `HEADLESS=false` in the env file to watch the browser.

#### (d) Live dry-run (real site, nothing written)
```bash
python src/main.py --dry-run --leagues england
```
Polite delays of 2–5 s between page loads mean ~1–2 minutes per league.

#### (e) Real run (writes to the database)
Needs Supabase running, schema applied, and `ENV_FILE` exported (see §4.2).
```bash
python src/main.py                     # all configured leagues
python src/main.py --leagues england   # just one
```
**Verify:** Studio → `scrape_logs` (one row per league: `success` / `partial` / `failed`, `rows_upserted`, `error_message`), then `matches`, `teams`, `team_stats`. **Run it a second time** — row counts in `matches`/`teams` must not grow (only `scrape_logs` gets new rows).

Flags: `--leagues england,spain`, `--dry-run`, `--offline DIR`. Scheduling: see [§11](#11-day-to-day-operations).

---

### 6.2 ML service (`ml_service/`)

**What it does:** two separate programs sharing the same feature code.

- **Offline training** (`training/`): reads finished matches, builds leak-free features (only results from *earlier days* feed each match's features), compares 4 models (logistic regression, random forest, XGBoost, LightGBM) on a chronological 70/15/15 split, picks the best by validation log-loss, calibrates it, saves it, then predicts every scheduled match and upserts into `predictions`.
- **Online API** (`app/`): FastAPI that loads the saved model once at startup and answers `/predict`.

**Needs:** Supabase with data (≥ 300 usable finished matches by default) for training/prediction. The API alone starts without a database.

All commands from `ml_service/` with the venv active and `ENV_FILE` exported:

#### (a) Check there is no data leakage
```bash
cd ml_service
python -m training.leakage_check     # prints NO LEAKAGE (exit 0) or LEAKAGE DETECTED (exit 1)
```
It alters results from the middle of the dataset onward and confirms earlier matches' features don't change.

#### (b) Train
```bash
python -m training.train
```
Prints split sizes, per-model validation metrics, the selected model, test metrics, then `saved artifacts/model_test.joblib (<name>_v1_<date>)` and `upserted N predictions`. Files created in `artifacts/`: the active model (`model_test.joblib` + `model_test.json` metadata) and a versioned copy (`lgbm_v1_YYYYMMDD.joblib`).

- `python -m training.train --skip-predict` trains and saves without touching the `predictions` table.
- `python -m training.batch_predict` re-predicts all scheduled matches using the saved model.
- Error `Only N usable finished matches; need >= 300` → you need more data (seed or scrape more).
- Same-day retrains overwrite the same version name (`<model>_v1_<date>`); predictions from *other* model versions are preserved.

> The first time you see numbers, remember: models trained on the **synthetic** seed data are meaningless for real football. They exist to prove the plumbing works.

#### (c) Start the API
```bash
uvicorn app.main:app --port 8000          # add --reload while editing code
```
**The model is loaded once at startup** — if you train *after* starting the API, restart it (or call `/retrain`).

#### (d) Try it
```bash
curl localhost:8000/health
# {"status":"ok","model_loaded":true,"model_version":"lgbm_v1_20261121","retrain_state":"idle"}

curl -X POST localhost:8000/predict -H 'content-type: application/json' -d '{"match_id": 1}'
curl -X POST localhost:8000/predict/batch -H 'content-type: application/json' -d '{"match_ids":[1,2,3]}'
curl -X POST localhost:8000/predict/batch -H 'content-type: application/json' -d '{}'      # all scheduled matches
```
`/predict` also accepts `{"features": {"h_pts5": 1.8, ...}}` instead of `match_id`. Interactive docs: http://localhost:8000/docs.

Verified behaviours without a model: `/health` → `model_loaded:false`; `/predict` with `{}` → `422 validation_error`; `/predict` with `match_id` → `503 model_unavailable`.

Retrain via the API (background job, needs the admin key):
```bash
curl -X POST localhost:8000/retrain -H "X-Admin-Key: test-ml-admin"      # 202; watch /health retrain_state
```

---

### 6.3 Backend (`backend/`)

**What it does:** the only API the frontend uses. Validates input, reads Supabase, calls the ML service, applies CORS, rate limiting (120/min/IP), consistent error JSON.

**Needs:** Node, and `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ML_SERVICE_URL` set (it exits immediately and tells you which are missing). It does **not** need the ML service to start; prediction endpoints degrade gracefully.

#### (a) Install & unit tests — no DB, no ML
```bash
cd backend
npm install
npm test          # expect: 6 passing (health, 404, bad id, bad pagination, bad date, auth required)
```

#### (b) Start
```bash
# from repo root, ENV_FILE exported
cd backend && npm start        # or: npm run dev  (auto-restart on change)
```
Expected: `API listening on :5000 (TEST mode)` then `Supabase connectivity OK`. (A `[warn] Supabase connectivity check failed` line means the DB isn't reachable/keys are wrong; the server still runs.)

#### (c) Try the endpoints
```bash
curl localhost:5000/api/health
curl "localhost:5000/api/health?deep=true"                 # also checks database + ML service
curl localhost:5000/api/leagues
curl "localhost:5000/api/matches/upcoming?limit=5"
curl "localhost:5000/api/matches/upcoming?league=1&window=30&search=Test"
curl localhost:5000/api/matches/recent
curl localhost:5000/api/matches/1
curl localhost:5000/api/teams/1/stats
curl localhost:5000/api/predictions/1
curl "localhost:5000/api/predictions/1?live=true"          # ask the ML service for a fresh one
curl localhost:5000/api/accuracy
curl localhost:5000/api/status/scraper
```
Admin routes (need the secret header):
```bash
curl -X POST localhost:5000/api/predictions/refresh -H "x-api-key: test-admin"
curl -X POST localhost:5000/api/admin/retrain       -H "x-api-key: test-admin"
```
Check CORS the way a browser does:
```bash
curl -i -H "Origin: http://localhost:8080" localhost:5000/api/leagues      # allowed
curl -i -H "Origin: http://localhost:5173" localhost:5000/api/leagues      # 403 cors_forbidden unless listed
```

---

### 6.4 Frontend (`frontend/`)

**What it is:** React app (TanStack Start/Router + React Query + Tailwind + shadcn/ui components), generated with Lovable. It talks only to `VITE_API_URL`.

**Pages that exist now:** `/` (fixtures with filters, search, pagination, probability bars), `/results` (recent results with predicted vs actual), `/accuracy` (accuracy per model/league), plus a data-freshness notice. **There are currently no match-detail or team pages** (`/matches/:id`, `/teams/:id`) even though the backend endpoints for them exist; the project's `roadmap.md` shows that work unfinished.

#### Install
```bash
cd frontend
npm install --legacy-peer-deps        # plain "npm install" fails; this works
#   or, if you have bun:  bun install   (project ships bun.lock — I haven't tested bun myself)
```

#### Fix the test config (one line)
In `frontend/vitest.config.ts` change
```ts
setupFiles: ["./src/test/setup.ts"],
```
to
```ts
setupFiles: ["./src/tests/setup.ts"],
```

#### Configure the backend URL
```bash
echo "VITE_API_URL=http://localhost:5000" > .env.local          # PowerShell: Set-Content .env.local "VITE_API_URL=http://localhost:5000"
```

#### Test, run, build
```bash
npm test                 # vitest; expect 1 passing (routing test)
npm run dev              # → http://localhost:8080   (port is forced by the Lovable config)
npm run build            # production build (not exercised by me)
npm run lint             # eslint
```
Open **http://localhost:8080**. With the backend **off**, you should see friendly "cannot reach the football data server" states rather than a blank page — a good standalone test of the error handling.

If your terminal can't bind IPv6 (`EAFNOSUPPORT: address family not supported :::8080`) run `npx vite dev --host 127.0.0.1` instead (that error occurred only in my sandbox; most machines are fine).

---

## 7. Connecting everything together

The wiring is just configuration. Checklist:

| # | Connection | What must be true | How to verify |
|---|---|---|---|
| 1 | DB exists | schema applied; Supabase running | Studio shows 6 tables |
| 2 | Scraper/ML/Backend → DB | same `SUPABASE_URL` + service-role key in the env file all three read | each program starts without `Missing required…`; backend log says `Supabase connectivity OK` |
| 3 | Data exists | seed script **or** a real scrape | Studio → `matches` has rows (both `finished` and `scheduled`) |
| 4 | Model exists | `python -m training.train` completed | `ml_service/artifacts/model_test.joblib` exists; `/health` shows `model_loaded:true` |
| 5 | Backend → ML | `ML_SERVICE_URL=http://localhost:8000` and FastAPI running; `ML_ADMIN_KEY` equal in both | `curl "localhost:5000/api/health?deep=true"` → `"ml_service":"up"` |
| 6 | Frontend → Backend | `VITE_API_URL=http://localhost:5000` in `frontend/.env.local`; backend `CORS_ORIGINS` contains the frontend's exact origin (`http://localhost:8080`) | open the UI; browser DevTools → Network shows `200` responses to `localhost:5000` |

**Startup order**

1. Supabase (+ schema)
2. Data: seed or scraper
3. Train the model (writes predictions)
4. ML API (`:8000`) — restart it after any training
5. Backend (`:5000`)
6. Frontend (`:8080`)

The backend and frontend tolerate things being down (they show errors/empty states), but you'll get empty pages until 1–4 are done.

---

## 8. Full manual run (copy-paste sequence)

Uses the **local test stack with synthetic data** — the fastest way to see everything working. You need 4–5 terminals. In every terminal start from the repo root and set `ENV_FILE` (§4.2); Python terminals need the venv active.

**One-time setup**
```bash
supabase init                                   # once
supabase start && supabase status               # copy API URL + service_role key into .env.test
cp .env.test.example .env.test                  # then edit: key + CORS_ORIGINS (see §4.2)
python3 -m venv .venv && source .venv/bin/activate
pip install -r scraper/requirements.txt -r scraper/requirements-dev.txt -r ml_service/requirements.txt
playwright install chromium
(cd backend && npm install)
(cd frontend && npm install --legacy-peer-deps)       # + fix vitest.config.ts line, + frontend/.env.local (§6.4)
```

**Terminal 1 — data + model (one-off)**
```bash
export ENV_FILE="$(pwd)/.env.test"
supabase db reset                               # clean local DB
python scripts/seed_test_data.py --reset        # 16 SYNTHETIC teams, 432 matches (416 finished in 52 past rounds, 16 scheduled in 2 future rounds)
cd ml_service
python -m training.leakage_check
python -m training.train                        # trains, saves model_test.joblib, writes predictions
```

**Terminal 2 — ML API**
```bash
export ENV_FILE="$(pwd)/.env.test"; source .venv/bin/activate
cd ml_service && uvicorn app.main:app --port 8000
```

**Terminal 3 — backend**
```bash
export ENV_FILE="$(pwd)/.env.test"
cd backend && npm start
```

**Terminal 4 — frontend**
```bash
cd frontend && npm run dev                      # open http://localhost:8080
```

**Terminal 5 — check it**
```bash
export ENV_FILE="$(pwd)/.env.test"
python scripts/e2e_check.py                     # prints PASS/FAIL lines; needs ML + backend running
```

To use **real data** instead of synthetic: skip the seed step, run the scraper (§6.1 c→e) with real fixtures verified, then train.

---

## 9. The automated end-to-end script

`scripts/run_e2e.sh` runs the complete test sequence in one go:

1. start local Supabase and `supabase db reset`
2. seed synthetic data
3. run the scraper **offline** twice on the synthetic fixtures and confirm row counts are identical (idempotency)
4. leakage check + training + batch predictions
5. start FastAPI and Express in the background
6. run `scripts/e2e_check.py` (≈ 20 PASS/FAIL checks: health, predictions valid and sum to 1, validation errors, 401 without key, refresh with key, all read endpoints)
7. stop the ML service and check how the backend behaves when it's gone

```bash
cp .env.test.example .env.test       # edit key + CORS_ORIGINS
source .venv/bin/activate            # the script calls plain `python`
supabase init                        # once! (the script does not do this)
scripts/run_e2e.sh
```
Notes:
- Needs a bash shell (Linux, macOS, WSL2, Git Bash), Docker, the Supabase CLI and `curl`.
- It **wipes the local database** (`db reset`). Fine for test; never point it at anything real (the `APP_ENV=test` guard enforces local-only).
- It stops its servers when it finishes, and it doesn't start the frontend. Use §8 for a UI session.
- I could not run this script end-to-end (no Docker in my sandbox). Its individual pieces were verified separately; if a step fails, the failing command's output is printed — send it to me.

---

## 10. What you should see in the UI

With the synthetic stack from §8 (based on reading the frontend code — I have not viewed it in a browser against live data):

| Page | Expect |
|---|---|
| **`/` Fixtures** | the 16 scheduled matches (2 future rounds × 8) with a three-segment probability bar (home / draw / away %) per match, predicted outcome highlighted, league filter ("SYNTHETIC Test League"), date picker, search box, pagination |
| **`/results`** | recent finished matches with scores. "Predicted vs actual" is empty/"no prediction" for these — the seeded history was never predicted *before* kickoff |
| **`/accuracy`** | **empty state** at first. By design only predictions stored before kickoff on matches that have since finished are counted |
| Freshness notice | likely shows "no successful scrape" (the synthetic seed doesn't write `scrape_logs`) |

**To see the accuracy page populated (local synthetic DB only)** — pretend some predicted matches have been played. Run in Studio's SQL editor (http://127.0.0.1:54323) or `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres`:
```sql
-- TEST DATA ONLY: marks 5 predicted synthetic matches as finished 2-1
update matches set status = 'finished', home_goals = 2, away_goals = 1
where id in (select id from matches where status = 'scheduled' order by match_date limit 5);
```
Refresh `/results` and `/accuracy` — 5 predictions now count. Never do this on real data.

With **real scraped data**, accuracy fills in naturally over time: predict before kickoff → scrape after the game → compare.

---

## 11. Day-to-day operations

**Typical cycle (production-like):** scrape → (re)train → predictions refreshed → UI shows them.

| Task | Command |
|---|---|
| Scrape everything | `cd scraper && python src/main.py` |
| Schedule scraping 3×/day (cron) | `0 6,12,18 * * * cd /path/to/scraper && /path/to/.venv/bin/python src/main.py >> scrape.log 2>&1` (or GitHub Actions / Task Scheduler; the scraper has no built-in scheduler by design) |
| Retrain + re-predict | `cd ml_service && python -m training.train` (then restart uvicorn), **or** `POST /api/admin/retrain` with `x-api-key` (the ML API hot-reloads the new model) |
| Re-predict upcoming with the current model | `POST /api/predictions/refresh` (header `x-api-key: <ADMIN_API_KEY>`, optional body `{"window": 14}`), or `python -m training.batch_predict` |
| Check scrape health | `GET /api/status/scraper` or the freshness banner |
| Add a team-name alias | edit `scraper/team_aliases.json`, e.g. `{"man utd": "Manchester United"}` (keys lower-case) |
| Add a league | add an entry to `LEAGUES` in `scraper/src/config.py` (`slug` = the SoccerStats league key) |
| Reset the whole test DB | `supabase db reset` |

Model versions look like `lgbm_v1_20261121` = best model type + `v1` + training date. Old versions' predictions stay in the table, which is what makes per-version accuracy comparison possible. Please keep the scraper polite (the 2–5 s delays are deliberate) and check SoccerStats' terms of use.

---

## 12. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Browser console: CORS error / API returns `403 cors_forbidden` | frontend origin not in `CORS_ORIGINS` (usually `5173` vs `8080`, or `localhost` vs `127.0.0.1`) | set `CORS_ORIGINS=http://localhost:8080,http://127.0.0.1:8080`, **restart backend** |
| UI says "cannot reach the football data server" | backend not running, wrong `VITE_API_URL`, or dev server not restarted after changing it | start backend; check `frontend/.env.local`; restart `npm run dev` |
| Backend: `database_error` / `503` on every data route | Supabase down or wrong URL/key | `supabase status`; check env file; look for `[supabase]` lines in the backend log |
| Backend: `Missing required environment variables…` | `ENV_FILE` not exported in that terminal | `export ENV_FILE="$(pwd)/.env.test"` from repo root |
| `APP_ENV=test but … is not local. Refusing to start/run` | the safety guard doing its job | use a local URL, or remove `APP_ENV=test` if you really mean a hosted dev DB |
| `/health` shows `model_loaded:false` | no model file at `MODEL_PATH`, or you trained after starting the API | `python -m training.train`, then restart uvicorn |
| `503 model_unavailable` from `/predict` | same as above | same |
| `Only N usable finished matches; need >= 300` | not enough data | seed (`scripts/seed_test_data.py`) or scrape more history |
| `ModuleNotFoundError: training` / `app` | ran from the wrong folder or without `-m` | `cd ml_service` and use `python -m training.train` / `uvicorn app.main:app` |
| `ModuleNotFoundError: supabase` etc. | venv not active / deps not installed | activate `.venv`; re-run the `pip install` line |
| `Executable doesn't exist … playwright` | browser not downloaded | `playwright install chromium` |
| Scraper: `parsed 0 raw rows` / empty output on live site | URL templates or parsers don't match the real HTML | §6.1 (c): save real pages, inspect, adjust `config.py` / `parsers/` |
| Scraper `status: failed` in `scrape_logs` | see `error_message` | usually page timeout (site slow/blocked) or DB error; retry, raise `PAGE_TIMEOUT_MS` |
| Same match appears twice | kickoff time shifted a lot / date changed by >1 day | rare; delete the stale row in Studio and re-scrape |
| `supabase db reset`: "config.toml not found" | `supabase init` never run | `supabase init` |
| `supabase start` fails | Docker not running / port clash | start Docker; `supabase stop` then retry |
| Python auth error with a new-style Supabase key | client/key format mismatch | use the legacy `service_role` JWT key |
| `npm install` in frontend: `edgesOut` error | npm resolver bug with this lockfile/overrides | `npm install --legacy-peer-deps` or `bun install` |
| `npm test` in frontend: `Cannot find module …/src/test/setup.ts` | typo in `vitest.config.ts` | change to `./src/tests/setup.ts` |
| `EAFNOSUPPORT … :::8080` | machine without IPv6 | `npx vite dev --host 127.0.0.1` |
| `429 rate_limited` | >120 requests/min from one IP | wait, or raise `RATE_LIMIT_PER_MIN` in dev |
| `401 unauthorized` on refresh/retrain | missing/wrong `x-api-key` (backend) or key mismatch (`ML_ADMIN_KEY` differs between backend and ML env) | send `x-api-key: <ADMIN_API_KEY>`; use the same `.env.test` for both |
| Port already in use | another process | change `PORT` (backend) / `--port` (uvicorn) and update `VITE_API_URL` / `ML_SERVICE_URL` / `CORS_ORIGINS` accordingly |
| `run_e2e.sh`: `python: command not found` | venv not active (or only `python3` exists) | `source .venv/bin/activate` |
| `/results` shows no "predicted" outcomes | no prediction existed before kickoff | expected for seeded history; see §10 |

Where to look for logs: backend and ML API print to their terminal; scraper prints to its terminal and writes `scrape_logs`; Supabase logs via `supabase status` / Docker Desktop; browser DevTools → Network/Console for the frontend.

---

## 13. Known limitations & what's verified

**Verified by running them (in my sandbox, Nov 2026):**
- Scraper parser/normalizer unit tests (4 pass) and the offline dry-run on synthetic HTML.
- Backend route tests (6 pass); startup validation; the `APP_ENV=test` non-local refusal; CORS block for an unlisted origin and pass for a listed one.
- ML feature engineering leakage test (on synthetic in-memory data), model training/calibration code path, probability rounding (sums to 1), and FastAPI start-up/validation/error behaviour without a model.
- Frontend: `npm install --legacy-peer-deps`, dev server on port 8080, and the existing test (after the one-line config fix).

**NOT verified — treat as "probably works, may need fixing":**
- **SoccerStats scraping.** URL templates and HTML parsers were written without access to the site and are only tested on invented fixtures. Home/away standings URLs (`&tid=h`, `&tid=a`) are guesses. Kickoff timezone is unknown.
- **The SQL migration** was not executed against Postgres.
- **The full pipeline against a real Supabase** (upserts, views, RLS), `scripts/run_e2e.sh`, and training on real data.
- **The frontend against a live backend**, in a real browser (layout, mobile view, data shapes). Its TypeScript types were written to the documented API contract; any mismatch would surface as an error state.
- **Production build/deploy** of any component, and `bun` installs.

**Functional gaps:**
- Frontend has no match-detail or team pages yet (backend endpoints exist).
- No user login (not needed by the current endpoints; admin routes use a shared secret header meant for scripts, **not** for browsers).
- No built-in scheduler; no Dockerfiles for the app services.
- Model quality on real data is unknown; football outcomes are inherently noisy — treat probabilities as estimates, not guarantees.

---

## 14. API quick reference

**Backend (`:5000`)** — success: `{ "data": …, "meta"?: { page, limit, total, total_pages } }`; errors: `{ "error": { "code", "message" } }`.

| Method & path | Query / body | Returns |
|---|---|---|
| `GET /api/health` | `deep=true` | status/timestamp (+ db and ML status) — *bare object, no `data` wrapper* |
| `GET /api/matches/upcoming` | `league`, `date` (YYYY-MM-DD), `window` (1–60), `search`, `page`, `limit` (≤100) | scheduled matches + stored prediction |
| `GET /api/matches/recent` | `league`, `page`, `limit` | finished matches + predicted vs actual |
| `GET /api/matches/:id` | — | full match, both teams' stats and form, prediction history |
| `GET /api/leagues` | — | `[{id,name,country}]` |
| `GET /api/teams/:id/stats` (also `/api/teams/:id`) | — | team, scraped snapshot, form, home/away records |
| `GET /api/predictions/:matchId` | `live=true` | stored (or fresh) prediction + `source: database/live/cache` |
| `GET /api/accuracy` | — | overall and per-league accuracy, Brier score, log-loss per model version |
| `GET /api/status/scraper` | — | latest scrape per source, last success, recent errors |
| `POST /api/predictions/refresh` 🔒 | header `x-api-key`; body `{"window":14}` | re-predict upcoming via ML and store |
| `POST /api/admin/retrain` 🔒 | header `x-api-key` | triggers ML retrain (202) |

**ML service (`:8000`)**

| Method & path | Body | Returns |
|---|---|---|
| `GET /health` | — | `{status, model_loaded, model_version, retrain_state}` |
| `POST /predict` | `{"match_id": n}` **or** `{"features": {…}}` | `{match_id, home_win_prob, draw_prob, away_win_prob, predicted_outcome (H/D/A), model_version}` |
| `POST /predict/batch` | `{"match_ids":[…]}` or `{}` for all scheduled | `{predictions:[…], missing_match_ids:[…]}` |
| `POST /retrain` 🔒 | header `X-Admin-Key` | 202 accepted (runs in background) |

Probabilities are numbers 0–1 that sum to 1. Outcomes: `H` home win, `D` draw, `A` away win.

---

## 15. Security notes

- The Supabase **service-role key bypasses all database security.** It belongs only in the scraper, ML service and backend environments. Never put it in the frontend, never commit it. (`.gitignore` already excludes `.env*` except the `*.example` files.)
- The frontend only ever needs `VITE_API_URL`. Anything prefixed `VITE_` is shipped to every visitor's browser — never put a secret there.
- Choose long random values for `ADMIN_API_KEY` and `ML_ADMIN_KEY` in any non-test environment, and call the admin routes only from scripts/servers you control.
- Database access for browsers is read-only by row-level-security policy, and `scrape_logs` has no public access at all.
- Keep `APP_ENV=test` for development so the services refuse to touch non-local databases.
