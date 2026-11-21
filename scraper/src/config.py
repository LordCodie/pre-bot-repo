"""Scraper configuration. Env file is chosen with ENV_FILE (default: .env)."""
import os
from urllib.parse import urlparse
from dotenv import load_dotenv

load_dotenv(os.getenv("ENV_FILE", ".env"))

APP_ENV = os.getenv("APP_ENV", "production")          # 'test' enforces local-only Supabase
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

HEADLESS = os.getenv("HEADLESS", "true").lower() == "true"
MIN_DELAY = float(os.getenv("MIN_DELAY", "2"))
MAX_DELAY = float(os.getenv("MAX_DELAY", "5"))
PAGE_TIMEOUT_MS = int(os.getenv("PAGE_TIMEOUT_MS", "30000"))
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "2"))
SOURCE_TIMEZONE = os.getenv("SOURCE_TIMEZONE", "UTC")   # tz of kickoff times on the site: verify!
SCRAPE_RESULTS_PAGE = os.getenv("SCRAPE_RESULTS_PAGE", "true").lower() == "true"
USER_AGENT = os.getenv(
    "USER_AGENT",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
)

BASE_URL = "https://www.soccerstats.com"
# URL templates: VERIFY these against the live site with src/inspect_page.py (dev step 1).
PAGE_URLS = {
    "latest":  BASE_URL + "/latest.asp?league={slug}",                 # recent results + fixtures
    "results": BASE_URL + "/results.asp?league={slug}&pmtype=bydate",
    "overall": BASE_URL + "/table.asp?league={slug}",
    "home":    BASE_URL + "/table.asp?league={slug}&tid=h",
    "away":    BASE_URL + "/table.asp?league={slug}&tid=a",
}

LEAGUES = [
    {"slug": "england", "name": "Premier League", "country": "England"},
    {"slug": "spain",   "name": "La Liga",        "country": "Spain"},
    {"slug": "italy",   "name": "Serie A",        "country": "Italy"},
    {"slug": "germany", "name": "Bundesliga",     "country": "Germany"},
    {"slug": "france",  "name": "Ligue 1",        "country": "France"},
]

# Variant -> canonical team name. Extend freely, or drop a JSON file at TEAM_ALIASES_FILE.
TEAM_ALIASES = {
    "man utd": "Manchester United", "man united": "Manchester United",
    "man city": "Manchester City", "spurs": "Tottenham Hotspur", "tottenham": "Tottenham Hotspur",
    "wolves": "Wolverhampton Wanderers", "newcastle": "Newcastle United",
    "west ham": "West Ham United", "brighton": "Brighton & Hove Albion",
    "nott'm forest": "Nottingham Forest", "nottm forest": "Nottingham Forest",
    "atletico madrid": "Atlético Madrid", "inter": "Inter Milan",
    "bayern": "Bayern Munich", "psg": "Paris Saint-Germain",
}
TEAM_ALIASES_FILE = os.getenv("TEAM_ALIASES_FILE", "team_aliases.json")


def league_source_url(slug: str) -> str:
    return PAGE_URLS["latest"].format(slug=slug)


def validate_env() -> None:
    """Fail fast on missing config and on any attempt to hit a non-local DB from test mode."""
    missing = [k for k in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY") if not os.getenv(k)]
    if missing:
        raise SystemExit(f"Missing required environment variables: {', '.join(missing)}")
    host = urlparse(SUPABASE_URL).hostname
    if APP_ENV == "test" and host not in {"localhost", "127.0.0.1", "host.docker.internal"}:
        raise SystemExit(f"APP_ENV=test but SUPABASE_URL host '{host}' is not local. Refusing to run.")
