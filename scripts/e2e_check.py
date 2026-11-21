"""Service-level checks against RUNNING FastAPI + Express (stdlib only).
  python scripts/e2e_check.py   (ENV_FILE=.env.test or exported vars)"""
import json, os, sys, urllib.request, urllib.error

ML = os.getenv("ML_SERVICE_URL", "http://localhost:8000")
API = f"http://localhost:{os.getenv('PORT', '5000')}"
ok = True

def call(url, method="GET", body=None, headers=None):
    req = urllib.request.Request(url, method=method, headers={"Content-Type": "application/json", **(headers or {})},
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=15) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")

def check(name, cond, detail=""):
    global ok; ok &= bool(cond); print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if not cond else ""))

s, h = call(f"{ML}/health"); check("FastAPI /health model_loaded", s == 200 and h.get("model_loaded"), h)
s, up = call(f"{API}/api/matches/upcoming?limit=5"); check("Express upcoming 200", s == 200 and up.get("data"), up)
mid = up["data"][0]["id"] if s == 200 and up.get("data") else None
if mid:
    s, p = call(f"{ML}/predict", "POST", {"match_id": mid})
    probs = [p.get("home_win_prob", -1), p.get("draw_prob", -1), p.get("away_win_prob", -1)]
    check("FastAPI /predict probs valid", s == 200 and all(0 <= x <= 1 for x in probs) and abs(sum(probs) - 1) < 1e-4, p)
    s, d = call(f"{API}/api/matches/{mid}"); check("Express match details", s == 200 and "home" in d.get("data", {}), d)
    s, pr = call(f"{API}/api/predictions/{mid}"); check("Express prediction", s == 200 and pr["data"]["model_version"], pr)
    s, pr = call(f"{API}/api/predictions/{mid}?live=true"); check("Express live prediction", s == 200 and pr["data"]["source"] in ("live", "cache"), pr)
    tid = up["data"][0]["home_team_id"]
    s, t = call(f"{API}/api/teams/{tid}/stats"); check("Express team stats", s == 200 and "computed" in t.get("data", {}), t)
s, _ = call(f"{ML}/predict", "POST", {}); check("FastAPI rejects empty body (422)", s == 422)
s, _ = call(f"{ML}/predict", "POST", {"match_id": 999999999}); check("FastAPI unknown match (404)", s == 404)
s, _ = call(f"{API}/api/matches/abc"); check("Express invalid id (400)", s == 400)
s, _ = call(f"{API}/api/matches/upcoming?page=0"); check("Express invalid page (400)", s == 400)
s, _ = call(f"{API}/api/predictions/refresh", "POST"); check("Express refresh needs key (401)", s == 401)
s, r = call(f"{API}/api/predictions/refresh", "POST", {}, {"x-api-key": os.getenv("ADMIN_API_KEY", "")}); check("Express refresh with key", s == 200, r)
for path in ("/api/leagues", "/api/matches/recent", "/api/accuracy", "/api/status/scraper", "/api/health?deep=true"):
    s, b = call(API + path); check(f"Express {path}", s == 200, b)
s, b = call(f"{API}/api/health?deep=true"); check("deep health: ml up", b.get("ml_service") == "up", b)
sys.exit(0 if ok else 1)
