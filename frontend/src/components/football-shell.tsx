import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, BarChart3, CalendarDays, CircleDot, Trophy } from "lucide-react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { scraperStatusQueryOptions } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { QueryBoundary } from "@/components/football-ui";
import { formatKickoff } from "@/lib/football-format";
import { cn } from "@/lib/utils";

const FIXTURE_HOME_SEARCH = {
  date: undefined,
  league: undefined,
  window: 14,
  search: undefined,
  page: 1,
};

export function AppHydrationGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => setReady(true), []);

  if (!ready) {
    return (
      <div className="mx-auto min-h-screen max-w-6xl px-4 py-12" role="status">
        <div className="football-skeleton h-12 w-48 rounded-md" aria-hidden="true" />
        <div className="football-skeleton mt-10 h-72 rounded-md" aria-hidden="true" />
        <span className="sr-only">Loading football data</span>
      </div>
    );
  }

  return children;
}

function FreshnessBanner() {
  const { data } = useSuspenseQuery(scraperStatusQueryOptions());
  const latest = [...data.latest_per_source].sort(
    (left, right) => Date.parse(right.ran_at) - Date.parse(left.ran_at),
  )[0];
  const lastSuccess = data.last_successful_update;
  const lastSuccessTime = lastSuccess ? Date.parse(lastSuccess.ran_at) : Number.NaN;
  const stale = !Number.isFinite(lastSuccessTime) || Date.now() - lastSuccessTime > 24 * 60 * 60 * 1000;
  const latestFailed = latest?.status === "failed" || latest?.status === "partial";
  const needsAttention = latestFailed || stale;

  let statusText = "No successful data update recorded";
  if (lastSuccess) {
    statusText = `Updated ${formatKickoff(lastSuccess.ran_at)} · ${lastSuccess.rows_upserted} rows`;
  }
  if (latestFailed) statusText = `Latest scrape ${latest.status} · ${statusText}`;
  else if (stale && lastSuccess) statusText = `Data may be stale · ${statusText}`;

  return (
    <div
      className={cn(
        "flex min-h-9 items-center gap-2 px-4 text-xs font-medium",
        needsAttention ? "bg-warning/20 text-foreground" : "bg-success/10 text-success",
      )}
      role="status"
    >
      {needsAttention ? (
        <Activity className="size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <span className="size-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
      )}
      <span className="truncate">{statusText}</span>
    </div>
  );
}

function FreshnessNotice() {
  return (
    <QueryBoundary compact loadingRows={1}>
      <FreshnessBanner />
    </QueryBoundary>
  );
}

export function FootballAppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const linkClass = (active: boolean) =>
    cn(
      "inline-flex min-h-10 items-center gap-2 border-b-2 px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
      active
        ? "border-accent text-primary-foreground"
        : "border-transparent text-primary-foreground/75 hover:border-primary-foreground/40 hover:text-primary-foreground",
    );

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-5 gap-y-2 px-4 py-3 sm:px-6">
          <Link
            to="/"
            search={FIXTURE_HOME_SEARCH}
            className="inline-flex items-center gap-2 rounded-sm font-display text-2xl font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Touchline home"
          >
            <CircleDot className="size-6" aria-hidden="true" />
            <span>Touchline</span>
          </Link>
          <nav aria-label="Main navigation" className="max-w-full overflow-x-auto">
            <ul className="flex min-w-max items-center gap-1">
              <li>
                <Link
                  to="/"
                  search={FIXTURE_HOME_SEARCH}
                  aria-current={pathname === "/" ? "page" : undefined}
                  className={linkClass(pathname === "/")}
                >
                  <CalendarDays className="size-4" aria-hidden="true" />
                  Fixtures
                </Link>
              </li>
              <li>
                <Link
                  to="/results"
                  aria-current={pathname.startsWith("/results") ? "page" : undefined}
                  className={linkClass(pathname.startsWith("/results"))}
                >
                  <Trophy className="size-4" aria-hidden="true" />
                  Results
                </Link>
              </li>
              <li>
                <Link
                  to="/accuracy"
                  aria-current={pathname.startsWith("/accuracy") ? "page" : undefined}
                  className={linkClass(pathname.startsWith("/accuracy"))}
                >
                  <BarChart3 className="size-4" aria-hidden="true" />
                  Accuracy
                </Link>
              </li>
            </ul>
          </nav>
          <Link
            to="/accuracy"
            className="hidden items-center gap-1.5 text-xs text-primary-foreground/80 sm:flex"
          >
            <Activity className="size-3.5" aria-hidden="true" />
            Model record
          </Link>
        </div>
        <FreshnessNotice />
      </header>

      <main className="data-surface mx-auto w-full max-w-6xl flex-1 px-4 py-7 sm:px-6 sm:py-10">
        {children}
      </main>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:px-6">
          <span>Football data · model performance</span>
          <Link to="/accuracy" className="rounded-sm underline-offset-4 hover:underline">
            Historical metrics are not a guarantee of future results
          </Link>
          <Button asChild size="icon" variant="ghost" aria-label="View model accuracy">
            <Link to="/accuracy">
              <BarChart3 aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </footer>
    </div>
  );
}