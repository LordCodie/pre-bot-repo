`synthetic_*.html` are hand-written samples that mimic the layout the parsers assume.
They contain INVENTED teams/scores for parser unit tests only.
Save real pages for routine offline runs with:
  python src/inspect_page.py england latest --save tests/fixtures/england_latest.html
(also: results, overall, home, away) and run:  python src/main.py --offline tests/fixtures --leagues england
