"""Dev step 1: save a page's HTML (and print table summaries) so selectors can be verified
and so fixtures can be stored for offline tests.
Usage: python src/inspect_page.py england latest [--save tests/fixtures/england_latest.html]"""
import sys
from bs4 import BeautifulSoup
import config
from browser import Browser

if __name__ == "__main__":
    slug, kind = sys.argv[1], sys.argv[2]
    with Browser() as b:
        html = b.get_html(config.PAGE_URLS[kind].format(slug=slug))
    if "--save" in sys.argv:
        path = sys.argv[sys.argv.index("--save") + 1]
        open(path, "w", encoding="utf-8").write(html); print("saved", path)
    soup = BeautifulSoup(html, "lxml")
    for i, t in enumerate(soup.find_all("table")):
        rows = t.find_all("tr", recursive=True)
        print(f"table[{i}] id={t.get('id')} class={t.get('class')} rows={len(rows)}",
              "|", " ".join(rows[0].get_text(' ', strip=True).split())[:100] if rows else "")
