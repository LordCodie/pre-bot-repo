"""Playwright browser management."""
import logging
import random
import time
from playwright.sync_api import sync_playwright, Error as PWError

import config

log = logging.getLogger("scraper.browser")


class Browser:
    def __enter__(self):
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=config.HEADLESS)
        self._ctx = self._browser.new_context(user_agent=config.USER_AGENT, locale="en-GB")
        self._last_request = 0.0
        return self

    def __exit__(self, *exc):
        self._ctx.close(); self._browser.close(); self._pw.stop()

    def _polite_wait(self):
        wait = random.uniform(config.MIN_DELAY, config.MAX_DELAY) - (time.time() - self._last_request)
        if wait > 0:
            time.sleep(wait)

    def get_html(self, url: str, wait_selector: str = "table") -> str:
        """Navigate, wait for content, return page.content(). Retries with back-off."""
        last_err = None
        for attempt in range(1, config.MAX_RETRIES + 2):
            self._polite_wait()
            page = self._ctx.new_page()
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=config.PAGE_TIMEOUT_MS)
                page.wait_for_selector(wait_selector, timeout=config.PAGE_TIMEOUT_MS)
                html = page.content()
                self._last_request = time.time()
                return html
            except PWError as e:
                last_err = e
                log.warning("Attempt %d failed for %s: %s", attempt, url, str(e).splitlines()[0])
                time.sleep(2 * attempt)
            finally:
                self._last_request = time.time()
                page.close()
        raise RuntimeError(f"Failed to load {url}: {last_err}")
