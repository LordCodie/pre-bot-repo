#!/usr/bin/env bash
# Full local test sequence. Requires: Supabase CLI + Docker, Python 3.11+, Node 18+.
# Usage: cp .env.test.example .env.test  (fill SUPABASE_SERVICE_KEY)  &&  scripts/run_e2e.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
[ -f .env.test ] || { echo "Create .env.test from .env.test.example first"; exit 1; }
export ENV_FILE="$ROOT/.env.test"; set -a; source .env.test; set +a
[ "$APP_ENV" = "test" ] || { echo "APP_ENV must be test"; exit 1; }

echo "1) local Supabase + migrations (db reset wipes the LOCAL db only)"
supabase start >/dev/null 2>&1 || true
supabase db reset
echo "2) seed synthetic data";            python scripts/seed_test_data.py --reset
echo "3) scraper offline run x2 (idempotency)"
FIX=$(mktemp -d); F=scraper/tests/fixtures
for k in latest results; do cp $F/synthetic_fixtures.html $FIX/england_$k.html; done
for k in overall home away; do cp $F/synthetic_standings.html $FIX/england_$k.html; done
count() { curl -s -I -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Prefer: count=exact" "$SUPABASE_URL/rest/v1/$1?select=id" | tr -d '\r' | awk -F/ '/content-range/{print $2}'; }
(cd scraper && python src/main.py --offline "$FIX" --leagues england)
A="$(count matches)/$(count teams)/$(count team_stats)"
(cd scraper && python src/main.py --offline "$FIX" --leagues england)
B="$(count matches)/$(count teams)/$(count team_stats)"
[ "$A" = "$B" ] && echo "   idempotent: $A" || { echo "   DUPLICATES: $A vs $B"; exit 1; }
echo "4) leakage check + training + batch predictions"
(cd ml_service && python -m training.leakage_check && python -m training.train)
echo "5) start FastAPI + Express"
(cd ml_service && uvicorn app.main:app --port 8000 >/tmp/ml.log 2>&1 & echo $! >/tmp/ml.pid)
(cd backend && node server.js >/tmp/be.log 2>&1 & echo $! >/tmp/be.pid)
trap 'kill $(cat /tmp/ml.pid /tmp/be.pid) 2>/dev/null || true' EXIT
for i in $(seq 1 30); do curl -sf localhost:8000/health >/dev/null && curl -sf localhost:$PORT/api/health >/dev/null && break; sleep 1; done
echo "6) API checks";                     python scripts/e2e_check.py
echo "7) ML-down failure handling"
kill $(cat /tmp/ml.pid); sleep 1
CODE=$(curl -s -o /dev/null -w '%{http_code}' "localhost:$PORT/api/predictions/1?live=true"); echo "   live prediction with ML down -> HTTP $CODE (cache 200 or graceful 503)"
echo "ALL CHECKS DONE. Open Supabase Studio (http://127.0.0.1:54323) and the React app manually for UI checks."
